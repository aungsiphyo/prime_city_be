const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const HelperRequest = require("../models/HelperRequest");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Room = require("../models/Room");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");
const { recordAdminAudit } = require("../services/audit.service");
const {
  getHelperPriceSnapshot,
} = require("../services/communityCatalog.service");

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

async function resolveRoomId(roomRef) {
  const normalizedRoomRef = String(roomRef || "").trim();

  if (!normalizedRoomRef) return null;
  if (isObjectId(normalizedRoomRef)) return normalizedRoomRef;

  const linkedRoom = await Room.findOne({ room_name: normalizedRoomRef })
    .select("_id")
    .lean();

  return linkedRoom ? String(linkedRoom._id) : null;
}

function emitToUser(app, userId, event, payload) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketIds = users[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit(
      event,
      payload
    );
  }
}

function emitNotificationToUser(app, userId, notification) {
  emitToUser(app, userId, "notification", notification);
}

async function getCurrentUser(req) {
  const currentUserId = getUserId(req);
  if (!currentUserId) return null;

  return User.findById(currentUserId)
    .select("_id fullname role room_id")
    .lean();
}

async function getLinkedRoomId(user) {
  if (!user) return null;

  const explicitRoomId = await resolveRoomId(user.room_id);
  if (explicitRoomId) return explicitRoomId;

  const linkedRoom = await Room.findOne({ resident_id: user._id })
    .select("_id")
    .lean();
  return linkedRoom ? String(linkedRoom._id) : null;
}

router.get("/", protect, async (req, res) => {
  try {
    const filter = {};
    const currentUser = await getCurrentUser(req);

    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }

    const isManager = ["Admin", "Staff"].includes(currentUser.role);
    const mustUseOwnScope = req.query.mine === "true" || !isManager;

    if (mustUseOwnScope) {
      filter.requested_by = currentUser._id;
    }

    const requests = await HelperRequest.find(filter)
      .sort({ created_at: -1 })
      .populate("room_id")
      .populate("helper_id", "fullname photo phone gender experience status")
      .populate("requested_by", "fullname email phone")
      .lean();

    res.json(requests);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", protect, async (req, res) => {
  try {
    const request = await HelperRequest.findById(req.params.id)
      .populate("room_id")
      .populate("helper_id", "fullname photo phone gender experience status")
      .populate("requested_by", "fullname email phone")
      .lean();

    if (!request) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const currentUser = await getCurrentUser(req);
    const isManager = ["Admin", "Staff"].includes(currentUser?.role);
    const ownsRequest =
      String(request.requested_by?._id || "") ===
      String(currentUser?._id || "");

    if (!isManager && !ownsRequest) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json(request);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", protect, async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req);
    const isManager = ["Admin", "Staff"].includes(currentUser?.role);
    const ownRoomId = await getLinkedRoomId(currentUser);
    const room_id = isManager
      ? await resolveRoomId(req.body.room_id || ownRoomId)
      : ownRoomId;
    const {
      helper_id,
      type,
      note,
      gender_preferred = "No Preference",
    } = req.body;

    if (req.body.room_id && !room_id) {
      return res.status(400).json({
        success: false,
        message: "Room not found for room_id",
      });
    }

    if (!room_id || !type) {
      return res.status(400).json({
        success: false,
        message: "room_id and type are required",
      });
    }

    const priceSnapshot = getHelperPriceSnapshot(type);
    if (!priceSnapshot) {
      return res.status(400).json({
        success: false,
        message: "Unsupported helper category",
      });
    }

    const request = await HelperRequest.create({
      requested_by: currentUser?._id,
      room_id,
      helper_id,
      type,
      note,
      gender_preferred,
      ...priceSnapshot,
    });

    const populatedRequest = await HelperRequest.findById(request._id)
      .populate("room_id")
      .populate("helper_id", "fullname photo phone gender experience status")
      .populate("requested_by", "fullname email phone")
      .lean();

    const recipients = await User.find({ role: { $in: ["Admin", "Staff"] } })
      .select("_id")
      .lean();
    const recipientIds = recipients.map((user) => user._id);

    recipientIds.forEach((userId) => {
      emitToUser(req.app, userId, "helper_request", populatedRequest);
    });

    if (recipientIds.length) {
      const title = "New helper request";
      const roomName =
        populatedRequest.room_id?.room_name || String(room_id || "Unknown");
      const residentName =
        populatedRequest.requested_by?.fullname ||
        currentUser?.fullname ||
        "Resident";
      const message = `${type} helper request from Room ${roomName} by ${residentName}.`;
      const notifications = await Notification.insertMany(
        recipientIds.map((userId) => ({
          user_id: userId,
          title,
          message,
          type: "Helper",
          data: {
            helper_request_id: String(populatedRequest._id),
            room_id: String(room_id),
            room_name: roomName,
            resident_id: String(currentUser._id),
            resident_name: residentName,
            helper_id: helper_id ? String(helper_id) : "",
            request_type: type,
            note: note || "",
          },
        }))
      );

      notifications.forEach((notification) => {
        emitNotificationToUser(req.app, notification.user_id, notification);
      });

      await sendPushToUsers(
        recipientIds,
        {
          title,
          message,
          type: "Helper",
          data: {
            helper_request_id: String(populatedRequest._id),
            room_id: String(room_id),
            room_name: roomName,
            resident_id: String(currentUser._id),
            resident_name: residentName,
            helper_id: helper_id ? String(helper_id) : "",
            request_type: type,
            note: note || "",
          },
        },
        { channelId: "helper_requests" }
      );
    }

    res.status(201).json({
      success: true,
      message: "Helper requested",
      data: populatedRequest,
      request: populatedRequest,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post(
  "/:id/submit",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    try {
      const adminId = getUserId(req);
      const request = await HelperRequest.findById(req.params.id)
        .populate("room_id")
        .populate("helper_id", "fullname photo phone gender experience status")
        .populate("requested_by", "fullname email phone role");

      if (!request) {
        return res.status(404).json({
          success: false,
          message: "Helper request not found",
        });
      }

      const residentId = request.requested_by?._id || request.requested_by;
      const resident = residentId
        ? await User.findById(residentId).select("_id role")
        : null;

      if (!resident || !["Resident", "Citizen"].includes(resident.role)) {
        return res.status(422).json({
          success: false,
          message: "The originating resident account could not be found",
        });
      }

      let alreadySubmitted = Boolean(request.submitted_at);
      if (!alreadySubmitted) {
        const submittedAt = new Date();
        const updateResult = await HelperRequest.updateOne(
          { _id: request._id, submitted_at: null },
          {
            $set: {
              status:
                request.status === "Completed" ? "Completed" : "In Progress",
              submitted_at: submittedAt,
              submitted_by: adminId,
            },
          }
        );
        alreadySubmitted = updateResult.modifiedCount === 0;

        if (!alreadySubmitted) {
          request.submitted_at = submittedAt;

          const roomName = request.room_id?.room_name || "Unknown";
          const helperName = request.helper_id?.fullname;
          const message = helperName
            ? `Admin has accepted your ${request.type} helper request for Room ${roomName}. Assigned helper: ${helperName}.`
            : `Admin has accepted your ${request.type} helper request for Room ${roomName}.`;
          const residentNotification = await Notification.create({
            user_id: resident._id,
            title: "Helper request submitted",
            message,
            type: "Helper",
            action_status: "Submitted",
            data: {
              helper_request_id: String(request._id),
              room_id: String(request.room_id?._id || request.room_id || ""),
              room_name: roomName,
              helper_id: request.helper_id?._id
                ? String(request.helper_id._id)
                : "",
              submitted_by: String(adminId),
            },
          });

          emitNotificationToUser(req.app, resident._id, residentNotification);
          await sendPushToUser(
            resident._id,
            {
              title: residentNotification.title,
              message: residentNotification.message,
              type: residentNotification.type,
              data: residentNotification.data,
              notification_id: String(residentNotification._id),
            },
            { channelId: "helper_requests" }
          );

          await Notification.updateMany(
            { "data.helper_request_id": String(request._id) },
            {
              $set: {
                action_status: "Submitted",
                actioned_at: request.submitted_at,
                actioned_by: adminId,
              },
            }
          );

          await recordAdminAudit({
            adminUserId: adminId,
            action: "helper_request_submitted",
            entityType: "HelperRequest",
            entityId: request._id,
            metadata: { residentUserId: String(resident._id) },
          });
        }
      }

      const populatedRequest = await HelperRequest.findById(request._id)
        .populate("room_id")
        .populate("helper_id", "fullname photo phone gender experience status")
        .populate("requested_by", "fullname email phone")
        .lean();
      const managers = await User.find({ role: { $in: ["Admin", "Staff"] } })
        .select("_id")
        .lean();

      [resident._id, ...managers.map((manager) => manager._id)].forEach(
        (userId) => {
          emitToUser(req.app, userId, "helper_request", populatedRequest);
        }
      );

      return res.status(200).json({
        success: true,
        message: alreadySubmitted
          ? "Helper request was already submitted"
          : "Helper request submitted and resident notified",
        data: populatedRequest,
        request: populatedRequest,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

router.put(
  "/:id",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    try {
      const request = await HelperRequest.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      )
        .populate("room_id")
        .populate("helper_id", "fullname photo phone gender experience status")
        .populate("requested_by", "fullname email phone");

      const managers = await User.find({ role: { $in: ["Admin", "Staff"] } })
        .select("_id")
        .lean();
      const residentId = request?.requested_by?._id || request?.requested_by;

      [residentId, ...managers.map((manager) => manager._id)]
        .filter(Boolean)
        .forEach((userId) => {
          emitToUser(req.app, userId, "helper_request", request);
        });

      res.json({
        success: true,
        message: "Request updated",
        data: request,
        request,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
