const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const SosAlert = require("../models/SosAlert");
const User = require("../models/User");
const Room = require("../models/Room");
const Notification = require("../models/Notification");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { recordAdminAudit } = require("../services/audit.service");
const {
  RESIDENT_ROLES,
  broadcastApprovedSos,
  emitNotificationToUser,
} = require("../services/sosBroadcast.service");
const {
  REVIEWABLE_SOS_STATUSES,
  RESOLVABLE_SOS_STATUSES,
  canSendSosWithoutRoom,
  getSosStatusFilter,
} = require("../utils/sosPolicy");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");

const SOS_RESPONDER_ROLES = ["Admin", "Staff", "Security"];

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

async function resolveRoomReference(roomRef, residentId) {
  const normalizedRoomRef = String(roomRef || "").trim();

  if (isObjectId(residentId)) {
    const assignedRoom = await Room.findOne({ resident_id: residentId })
      .select("_id room_name")
      .lean();

    if (assignedRoom) {
      return {
        roomId: assignedRoom._id,
        roomLabel: assignedRoom.room_name,
      };
    }
  }

  if (!normalizedRoomRef) {
    return { roomId: null, roomLabel: null };
  }

  const roomQuery = isObjectId(normalizedRoomRef)
    ? { _id: normalizedRoomRef }
    : { room_name: normalizedRoomRef };
  const linkedRoom = await Room.findOne(roomQuery)
    .select("_id room_name")
    .lean();

  return {
    roomId: linkedRoom?._id || null,
    roomLabel: linkedRoom?.room_name || normalizedRoomRef,
  };
}

async function notifyUsers(app, userIds, payload, options = {}) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return;

  const notifications = await Notification.insertMany(
    ids.map((userId) => ({
      user_id: userId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      data: payload.data || {},
    })),
  );

  notifications.forEach((notification) => {
    emitNotificationToUser(app, notification.user_id, notification);
  });

  await sendPushToUsers(ids, payload, options);
}

function emitSosUpdate(app, alert) {
  const io = app.get("io");
  if (!io) return;

  io.to("sos_responders").emit("sos_alert_updated", alert);
  io.to("sos_responders").emit("admin_sos_alert_updated", alert);
}

async function getPopulatedSos(id) {
  return SosAlert.findById(id)
    .populate("resident_id", "fullname email phone role")
    .populate("room_id")
    .populate("approved_by", "fullname email role")
    .populate("rejected_by", "fullname email role")
    .populate("resolved_by", "fullname email role");
}

// =========================
// GET /api/sos
// List SOS alerts
// Query:
// ?status=Pending
// ?q=fire
// ?page=1&limit=50
// =========================
router.get(
  "/",
  protect,
  authorizeRoles(...SOS_RESPONDER_ROLES),
  async (req, res) => {
  try {
    const { status, q, page = 1, limit = 50 } = req.query;

    const filter = {};

    const statusFilter = getSosStatusFilter(status);
    if (statusFilter) filter.status = statusFilter;

    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [
        { message: regex },
        { alert_type: regex },
        { priority: regex },
      ];
    }

    const pageNumber = Math.max(Number(page), 1);
    const limitNumber = Math.max(Number(limit), 1);
    const skip = (pageNumber - 1) * limitNumber;

    const [alerts, total] = await Promise.all([
      SosAlert.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate("resident_id", "fullname email phone role")
        .populate("room_id")
        .lean(),
      SosAlert.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: alerts,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber),
      },
    });
  } catch (err) {
    console.error("GET /api/sos error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
  },
);

// =========================
// GET /api/sos/:id
// Get single SOS alert details
// =========================
router.get(
  "/:id",
  protect,
  authorizeRoles(...SOS_RESPONDER_ROLES),
  async (req, res) => {
  try {
    const alert = await getPopulatedSos(req.params.id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "SOS alert not found",
      });
    }

    res.json({
      success: true,
      data: alert,
    });
  } catch (err) {
    console.error("GET /api/sos/:id error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
  },
);

// =========================
// POST /api/sos
// User / resident submit SOS
// Body:
// {
//   "resident_id": "...",
//   "room_id": "...",
//   "message": "Need help",
//   "alert_type": "Medical",
//   "priority": "High"
// }
// =========================
router.post("/", protect, async (req, res) => {
  try {
    let { resident_id, room_id, message, alert_type = "General" } = req.body;
    const { priority = "High" } = req.body;
    const currentUserId = getUserId(req);
    let currentUser = null;

    if (currentUserId) {
      currentUser = await User.findById(currentUserId)
        .select("_id room_id role")
        .lean();

      if (!currentUser) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user was not found",
        });
      }

      // Authenticated SOS requests must always belong to the signed-in user.
      resident_id = currentUser._id;
      room_id = currentUser.room_id || room_id;
    }

    if (!resident_id || !message) {
      return res.status(400).json({
        success: false,
        message: "resident_id and message are required",
      });
    }

    if (!isObjectId(resident_id)) {
      return res.status(400).json({
        success: false,
        message: "resident_id must be a valid user id",
      });
    }

    const resolvedRoom = await resolveRoomReference(room_id, resident_id);
    room_id = resolvedRoom.roomId;
    const roomLabel = resolvedRoom.roomLabel;
    const roomIsOptional = canSendSosWithoutRoom(currentUser?.role);

    if (!roomLabel && !roomIsOptional) {
      return res.status(400).json({
        success: false,
        message: "A room location is required to send SOS",
      });
    }

    const sos = await SosAlert.create({
      resident_id,
      ...(room_id ? { room_id } : {}),
      room_label: roomLabel,
      source: "Mobile",
      message,
      alert_type,
      priority,
      status: "Pending",
      created_at: new Date(),
    });

    const populatedSos = await SosAlert.findById(sos._id)
      .populate("resident_id", "fullname email phone role")
      .populate("room_id")
      .lean();

    const io = req.app.get("io");

    if (io) {
      io.to("sos_responders").emit("sos_alert_created", populatedSos);
      io.to("sos_responders").emit("admin_sos_alert", populatedSos);
    }

    const responderUsers = await User.find({
      role: { $in: SOS_RESPONDER_ROLES },
    })
      .select("_id")
      .lean();

    await notifyUsers(
      req.app,
      responderUsers.map((user) => user._id),
      {
        title: `SOS Alert: ${alert_type}`,
        message: roomLabel ? `${message} Location: ${roomLabel}.` : message,
        type: "SOS",
        data: {
          sos_id: String(populatedSos._id),
          alert_type,
          priority,
          room_id: room_id ? String(room_id) : "",
          room_label: roomLabel || "",
          resident_id: String(resident_id),
        },
      },
      { channelId: "urgent_alerts", priority: "high", androidPriority: "high" },
    );

    const residentNotification = await Notification.create({
      user_id: resident_id,
      title: "SOS alert sent",
      message: "Security has been notified. Help is on the way.",
      type: "SOS",
      data: {
        sos_id: String(populatedSos._id),
        alert_type,
        priority,
      },
    });

    emitNotificationToUser(req.app, resident_id, residentNotification);
    await sendPushToUser(
      resident_id,
      {
        title: residentNotification.title,
        message: residentNotification.message,
        type: residentNotification.type,
        notification_id: String(residentNotification._id),
        data: residentNotification.data,
      },
      { channelId: "urgent_alerts", priority: "high", androidPriority: "high" },
    );

    res.status(201).json({
      success: true,
      message: "SOS alert submitted successfully",
      data: populatedSos,
    });
  } catch (err) {
    console.error("POST /api/sos error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// =========================
// POST /api/sos/emergency
// Admin trigger emergency to all users
// Body:
// {
//   "title": "Emergency SOS Alert",
//   "message": "Please evacuate",
//   "level": "Critical"
// }
// =========================
router.post(
  "/emergency",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
  try {
    const {
      title = "Emergency SOS Alert",
      message = "Emergency alert from admin",
      level = "Critical",
    } = req.body;

    const emergencyData = {
      title,
      message,
      level,
      created_at: new Date(),
    };

    const users = await User.find({ role: { $in: RESIDENT_ROLES } })
      .select("_id")
      .lean();
    await notifyUsers(
      req.app,
      users.map((user) => user._id),
      {
        title,
        message,
        type: "Emergency",
        data: {
          level,
          created_at: emergencyData.created_at.toISOString(),
        },
      },
      { channelId: "urgent_alerts", priority: "high", androidPriority: "high" },
    );

    res.json({
      success: true,
      message: "Emergency SOS sent to all connected users",
      data: emergencyData,
    });
  } catch (err) {
    console.error("POST /api/sos/emergency error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
  },
);

// =========================
// POST /api/sos/:id/approve
// Verify a pending SOS and broadcast it to resident mobile apps.
// =========================
router.post(
  "/:id/approve",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "SOS alert id is invalid",
        });
      }

      const approvedBy = getUserId(req);
      const approvedAt = new Date();
      const approved = await SosAlert.findOneAndUpdate(
        {
          _id: req.params.id,
          status: { $in: REVIEWABLE_SOS_STATUSES },
        },
        {
          $set: {
            status: "Approved",
            approved_at: approvedAt,
            approved_by: approvedBy,
            broadcast_status: "Processing",
          },
          $unset: {
            rejected_at: 1,
            rejected_by: 1,
            rejection_reason: 1,
            broadcast_error: 1,
          },
        },
        { new: true, runValidators: true },
      )
        .populate("resident_id", "fullname email phone role")
        .populate("room_id");

      if (!approved) {
        const existing = await getPopulatedSos(req.params.id);
        if (!existing) {
          return res.status(404).json({
            success: false,
            message: "SOS alert not found",
          });
        }

        if (existing.status === "Approved") {
          return res.status(200).json({
            success: true,
            already_approved: true,
            message: "SOS alert was already approved",
            data: existing,
            push_delivery: existing.push_delivery,
          });
        }

        return res.status(409).json({
          success: false,
          message: `Only a pending SOS alert can be approved; current status is ${existing.status}`,
          data: existing,
        });
      }

      let delivery = null;
      let deliveryError = null;

      try {
        delivery = await broadcastApprovedSos(
          req.app,
          approved,
          approvedBy,
          approvedAt,
        );
        approved.broadcast_status = delivery.broadcastStatus;
        approved.broadcasted_at = new Date();
        approved.broadcast_recipient_count = delivery.recipientCount;
        approved.push_delivery = delivery.pushDelivery;
        approved.broadcast_error =
          delivery.broadcastStatus === "Sent"
            ? undefined
            : delivery.pushDelivery?.reason ||
              delivery.pushDelivery?.error ||
              "Push delivery was incomplete";
      } catch (err) {
        deliveryError = err;
        approved.broadcast_status = "Failed";
        approved.broadcast_error = err.message;
      }

      await approved.save();
      const populated = await getPopulatedSos(approved._id);
      emitSosUpdate(req.app, populated);

      await recordAdminAudit({
        adminUserId: approvedBy,
        action: "sos_approved",
        entityType: "SosAlert",
        entityId: approved._id,
        metadata: {
          alertType: approved.alert_type,
          priority: approved.priority,
          source: approved.source,
          recipientCount: delivery?.recipientCount || 0,
          broadcastStatus: approved.broadcast_status,
        },
      });

      return res.status(200).json({
        success: true,
        message: deliveryError
          ? "SOS approved, but emergency delivery failed"
          : approved.broadcast_status === "Sent"
            ? "SOS approved and emergency alert sent"
            : "SOS approved and saved; push delivery was incomplete",
        data: populated,
        notification_delivery: {
          success: !deliveryError,
          count: delivery?.notificationCount || 0,
          recipient_count: delivery?.recipientCount || 0,
          error: deliveryError?.message,
        },
        push_delivery: delivery?.pushDelivery || null,
      });
    } catch (err) {
      console.error("POST /api/sos/:id/approve error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// =========================
// POST /api/sos/:id/reject
// Reject a pending SOS without broadcasting it to residents.
// =========================
router.post(
  "/:id/reject",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "SOS alert id is invalid",
        });
      }

      const rejectedBy = getUserId(req);
      const rejectedAt = new Date();
      const rejected = await SosAlert.findOneAndUpdate(
        {
          _id: req.params.id,
          status: { $in: REVIEWABLE_SOS_STATUSES },
        },
        {
          $set: {
            status: "Rejected",
            rejected_at: rejectedAt,
            rejected_by: rejectedBy,
            rejection_reason: String(req.body.reason || "").trim(),
            broadcast_status: "Not Sent",
          },
        },
        { new: true, runValidators: true },
      );

      if (!rejected) {
        const existing = await getPopulatedSos(req.params.id);
        if (!existing) {
          return res.status(404).json({
            success: false,
            message: "SOS alert not found",
          });
        }

        return res.status(409).json({
          success: false,
          message: `Only a pending SOS alert can be rejected; current status is ${existing.status}`,
          data: existing,
        });
      }

      const populated = await getPopulatedSos(rejected._id);
      emitSosUpdate(req.app, populated);
      await recordAdminAudit({
        adminUserId: rejectedBy,
        action: "sos_rejected",
        entityType: "SosAlert",
        entityId: rejected._id,
        metadata: {
          reason: rejected.rejection_reason,
          source: rejected.source,
        },
      });

      return res.status(200).json({
        success: true,
        message: "SOS alert rejected",
        data: populated,
      });
    } catch (err) {
      console.error("POST /api/sos/:id/reject error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// =========================
// POST /api/sos/:id/broadcast
// Retry delivery for an approved SOS without creating duplicate inbox records.
// =========================
router.post(
  "/:id/broadcast",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "SOS alert id is invalid",
        });
      }

      const alert = await getPopulatedSos(req.params.id);
      if (!alert) {
        return res.status(404).json({
          success: false,
          message: "SOS alert not found",
        });
      }
      if (alert.status !== "Approved") {
        return res.status(409).json({
          success: false,
          message: "Only an approved SOS alert can be broadcast",
          data: alert,
        });
      }

      alert.broadcast_status = "Processing";
      alert.broadcast_error = undefined;
      await alert.save();

      const approvedBy = alert.approved_by?._id || alert.approved_by;
      const approvedAt = alert.approved_at || new Date();
      const delivery = await broadcastApprovedSos(
        req.app,
        alert,
        approvedBy,
        approvedAt,
      );

      alert.broadcast_status = delivery.broadcastStatus;
      alert.broadcasted_at = new Date();
      alert.broadcast_recipient_count = delivery.recipientCount;
      alert.push_delivery = delivery.pushDelivery;
      alert.broadcast_error =
        delivery.broadcastStatus === "Sent"
          ? undefined
          : delivery.pushDelivery?.reason ||
            delivery.pushDelivery?.error ||
            "Push delivery was incomplete";
      await alert.save();

      const populated = await getPopulatedSos(alert._id);
      emitSosUpdate(req.app, populated);
      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: "sos_broadcast_retried",
        entityType: "SosAlert",
        entityId: alert._id,
        metadata: {
          recipientCount: delivery.recipientCount,
          broadcastStatus: delivery.broadcastStatus,
        },
      });

      return res.status(200).json({
        success: true,
        message:
          delivery.broadcastStatus === "Sent"
            ? "Emergency alert sent"
            : "Emergency inbox alert saved; push delivery was incomplete",
        data: populated,
        notification_delivery: {
          success: true,
          count: delivery.notificationCount,
          recipient_count: delivery.recipientCount,
        },
        push_delivery: delivery.pushDelivery,
      });
    } catch (err) {
      console.error("POST /api/sos/:id/broadcast error:", err);
      await SosAlert.findByIdAndUpdate(req.params.id, {
        $set: {
          broadcast_status: "Failed",
          broadcast_error: err.message,
        },
      }).catch(() => null);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// =========================
// PUT /api/sos/:id
// Update SOS alert status
// Body:
// {
//   "status": "Resolved"
// }
// =========================
router.put(
  "/:id",
  protect,
  authorizeRoles(...SOS_RESPONDER_ROLES),
  async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "SOS alert id is invalid",
        });
      }

      if (req.body.status && req.body.status !== "Resolved") {
        return res.status(400).json({
          success: false,
          message:
            "Use the approve or reject endpoint for review decisions; this endpoint only accepts Resolved",
        });
      }

      const allowed = {};
      if (req.body.message) allowed.message = req.body.message;
      if (req.body.priority) allowed.priority = req.body.priority;

      let updated;
      if (req.body.status === "Resolved") {
        updated = await SosAlert.findOneAndUpdate(
          {
            _id: req.params.id,
            status: { $in: RESOLVABLE_SOS_STATUSES },
          },
          {
            $set: {
              ...allowed,
              status: "Resolved",
              resolved_at: new Date(),
              resolved_by: getUserId(req),
            },
          },
          { new: true, runValidators: true },
        );

        if (!updated) {
          const existing = await getPopulatedSos(req.params.id);
          if (!existing) {
            return res.status(404).json({
              success: false,
              message: "SOS alert not found",
            });
          }
          if (existing.status === "Resolved") {
            return res.status(200).json({
              success: true,
              already_resolved: true,
              message: "SOS alert was already resolved",
              data: existing,
            });
          }
          return res.status(409).json({
            success: false,
            message: `Approve the SOS before resolving it; current status is ${existing.status}`,
            data: existing,
          });
        }
      } else {
        if (!Object.keys(allowed).length) {
          return res.status(400).json({
            success: false,
            message: "message, priority or status is required",
          });
        }
        updated = await SosAlert.findByIdAndUpdate(
          req.params.id,
          { $set: allowed },
          { new: true, runValidators: true },
        );
        if (!updated) {
          return res.status(404).json({
            success: false,
            message: "SOS alert not found",
          });
        }
      }

      const populated = await getPopulatedSos(updated._id);
      emitSosUpdate(req.app, populated);

      if (req.body.status === "Resolved") {
        await recordAdminAudit({
          adminUserId: getUserId(req),
          action: "sos_resolved",
          entityType: "SosAlert",
          entityId: updated._id,
          metadata: {
            source: updated.source,
            approvedBy: updated.approved_by
              ? String(updated.approved_by)
              : null,
          },
        });
      }

      return res.json({
        success: true,
        message:
          req.body.status === "Resolved"
            ? "SOS alert resolved"
            : "SOS alert updated successfully",
        data: populated,
      });
    } catch (err) {
      console.error("PUT /api/sos/:id error:", err);
      return res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// =========================
// DELETE /api/sos/:id
// Delete SOS alert
// =========================
router.delete(
  "/:id",
  protect,
  authorizeRoles("Admin"),
  async (req, res) => {
  try {
    const deleted = await SosAlert.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "SOS alert not found",
      });
    }

    const io = req.app.get("io");

    if (io) {
      io.emit("sos_alert_deleted", {
        id: req.params.id,
      });
    }

    return res.json({
      success: true,
      message: "SOS alert deleted successfully",
    });
  } catch (err) {
    console.error("DELETE /api/sos/:id error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
  },
);

module.exports = router;
