const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const DeviceToken = require("../models/DeviceToken");
const User = require("../models/User");
const Room = require("../models/Room");
const HelperRequest = require("../models/HelperRequest");
const Report = require("../models/Report");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");
const { recordAdminAudit } = require("../services/audit.service");

const RESIDENT_ROLES = ["Resident", "Citizen"];

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function getNotificationChannel(type) {
  if (type === "SOS" || type === "Emergency") return "urgent_alerts";
  if (type === "Helper") return "helper_requests";
  return "community_updates";
}

async function emitNotification(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketIds = users[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit("notification", notification);
  }
}

async function findResidentById(userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) return null;

  const resident = await User.findOne({
    _id: userId,
    role: { $in: RESIDENT_ROLES },
  })
    .select("_id fullname email phone room_id role")
    .lean();

  if (!resident) return null;

  const room = await Room.findOne({
    $or: [
      { resident_id: resident._id },
      ...(mongoose.Types.ObjectId.isValid(String(resident.room_id || ""))
        ? [{ _id: resident.room_id }]
        : []),
      ...(resident.room_id ? [{ room_name: String(resident.room_id) }] : []),
    ],
  })
    .select("_id room_name building floor")
    .lean();

  return {
    ...resident,
    room_number: room?.room_name || resident.room_id || null,
    room: room || null,
  };
}

async function listResidents() {
  const residents = await User.find({ role: { $in: RESIDENT_ROLES } })
    .select("_id fullname email phone room_id role")
    .sort({ fullname: 1 })
    .lean();

  const rooms = await Room.find({
    resident_id: { $in: residents.map((resident) => resident._id) },
  })
    .select("_id room_name building floor resident_id")
    .lean();
  const roomByResident = new Map(
    rooms.map((room) => [String(room.resident_id), room]),
  );

  return residents.map((resident) => {
    const room = roomByResident.get(String(resident._id)) || null;
    return {
      ...resident,
      room_number: room?.room_name || resident.room_id || null,
      room,
    };
  });
}

function getReferencedIds(notifications, key) {
  return Array.from(
    new Set(
      notifications
        .map((notification) => notification.data?.[key])
        .filter((value) => mongoose.Types.ObjectId.isValid(String(value || "")))
        .map(String),
    ),
  );
}

async function enrichNotificationSources(notifications) {
  const helperRequestIds = getReferencedIds(
    notifications,
    "helper_request_id",
  );
  const reportIds = getReferencedIds(notifications, "report_id");
  const [helperRequests, reports] = await Promise.all([
    HelperRequest.find({ _id: { $in: helperRequestIds } })
      .populate("room_id", "room_name building floor")
      .populate("requested_by", "fullname email phone room_id")
      .populate("helper_id", "fullname phone")
      .lean(),
    Report.find({ _id: { $in: reportIds } })
      .populate("user_id", "fullname email phone role room_id")
      .lean(),
  ]);
  const helperById = new Map(
    helperRequests.map((request) => [String(request._id), request]),
  );
  const reportById = new Map(
    reports.map((report) => [String(report._id), report]),
  );
  const reportUsers = reports.map((report) => report.user_id).filter(Boolean);
  const reportUserIds = reportUsers.map((user) => user._id);
  const roomObjectIds = reportUsers
    .map((user) => user.room_id)
    .filter((roomId) => mongoose.Types.ObjectId.isValid(String(roomId || "")));
  const roomNames = reportUsers
    .map((user) => String(user.room_id || "").trim())
    .filter((roomId) => roomId && !mongoose.Types.ObjectId.isValid(roomId));
  const roomFilters = [];

  if (reportUserIds.length) roomFilters.push({ resident_id: { $in: reportUserIds } });
  if (roomObjectIds.length) roomFilters.push({ _id: { $in: roomObjectIds } });
  if (roomNames.length) roomFilters.push({ room_name: { $in: roomNames } });

  const reportRooms = roomFilters.length
    ? await Room.find({ $or: roomFilters })
        .select("_id room_name building floor resident_id")
        .lean()
    : [];
  const roomByResident = new Map(
    reportRooms
      .filter((room) => room.resident_id)
      .map((room) => [String(room.resident_id), room]),
  );
  const roomByRef = new Map();

  reportRooms.forEach((room) => {
    roomByRef.set(String(room._id), room);
    roomByRef.set(String(room.room_name), room);
  });

  return notifications.map((notification) => {
    const data = { ...(notification.data || {}) };
    const helperRequest = helperById.get(String(data.helper_request_id || ""));
    const report = reportById.get(String(data.report_id || ""));

    if (helperRequest) {
      data.source = {
        kind: "helper_request",
        room_id: helperRequest.room_id?._id
          ? String(helperRequest.room_id._id)
          : String(helperRequest.room_id || ""),
        room_name: helperRequest.room_id?.room_name || data.room_name || null,
        building: helperRequest.room_id?.building || null,
        floor: helperRequest.room_id?.floor ?? null,
        resident_name: helperRequest.requested_by?.fullname || null,
        resident_phone: helperRequest.requested_by?.phone || null,
        request_type: helperRequest.type,
        preferred_gender: helperRequest.gender_preferred,
        helper_name: helperRequest.helper_id?.fullname || null,
        note: helperRequest.note || "",
        status: helperRequest.status,
      };
    } else if (report) {
      const resident = report.user_id;
      const room = resident
        ? roomByResident.get(String(resident._id)) ||
          roomByRef.get(String(resident.room_id || ""))
        : null;

      data.source = {
        kind: "resident_report",
        room_id: room?._id ? String(room._id) : null,
        room_name: room?.room_name || resident?.room_id || null,
        building: room?.building || null,
        floor: room?.floor ?? null,
        resident_name: resident?.fullname || null,
        resident_phone: resident?.phone || null,
        report_title: report.title,
        report_type: report.type,
        location: report.location,
        details: report.message,
        status: report.status,
      };
    }

    return { ...notification, data };
  });
}

router.get("/", protect, async (req, res) => {
  try {
    const filter = { user_id: getUserId(req) };

    const limit = Math.max(1, Number(req.query.limit || 100));
    const notifications = await Notification.find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();
    const enrichedNotifications = await enrichNotificationSources(notifications);

    res.status(200).json({ success: true, data: enrichedNotifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/unread-count", protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      user_id: getUserId(req),
      is_read: false,
    });
    return res.status(200).json({ success: true, count });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/mark-all-read", protect, async (req, res) => {
  try {
    const filter = { is_read: false, user_id: getUserId(req) };

    await Notification.updateMany(filter, { $set: { is_read: true } });
    res
      .status(200)
      .json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/:id/read", protect, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user_id: getUserId(req) },
      { $set: { is_read: true } },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/device-token", protect, async (req, res) => {
  try {
    const { token, platform = "unknown", device_id, app_version } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    const deviceToken = await DeviceToken.findOneAndUpdate(
      { token },
      {
        user_id: getUserId(req),
        token,
        platform,
        device_id,
        app_version,
        last_seen_at: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(200).json({ success: true, data: deviceToken });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/device-token", protect, async (req, res) => {
  try {
    const { token } = req.body;
    const currentUserId = getUserId(req);

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    await DeviceToken.deleteOne({ token, user_id: currentUserId });
    return res.status(200).json({ success: true, message: "Device removed" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/residents", protect, authorizeRoles("Admin"), async (req, res) => {
  try {
    const residents = await listResidents();
    res.status(200).json({ success: true, data: residents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/send", protect, authorizeRoles("Admin"), async (req, res) => {
  try {
    const {
      user_id,
      recipient_user_id,
      target,
      title,
      message,
      type = "General",
      data = {},
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "title and message are required",
      });
    }

    const sendToAllResidents =
      target === "all" ||
      target === "all_residents" ||
      user_id === "all" ||
      recipient_user_id === "all";

    const recipients = sendToAllResidents
      ? await listResidents()
      : [await findResidentById(recipient_user_id || user_id)].filter(Boolean);

    if (!recipients.length) {
      return res.status(sendToAllResidents ? 404 : 400).json({
        success: false,
        message: sendToAllResidents
          ? "No resident users found"
          : "Resident user not found",
      });
    }

    const notificationData = {
      ...data,
      sent_by: String(getUserId(req)),
      target: sendToAllResidents ? "all_residents" : "resident",
    };

    const notifications = await Notification.insertMany(
      recipients.map((user) => ({
        user_id: user._id,
        title,
        message,
        type,
        data: notificationData,
      })),
    );

    notifications.forEach((notification) => {
      emitNotification(req.app, notification.user_id, notification);
    });

    let pushDelivery;

    if (sendToAllResidents) {
      pushDelivery = await sendPushToUsers(
        recipients.map((user) => user._id),
        { title, message, type, data: notificationData },
        { channelId: getNotificationChannel(type) },
      );
    } else {
      const notification = notifications[0];
      pushDelivery = await sendPushToUser(
        notification.user_id,
        {
          title,
          message,
          type,
          data: notificationData,
          notification_id: String(notification._id),
        },
        { channelId: getNotificationChannel(type) },
      );
    }

    await recordAdminAudit({
      adminUserId: getUserId(req),
      action: "notification_sent",
      entityType: "Notification",
      entityId: notifications[0]?._id,
      metadata: {
        target: sendToAllResidents ? "all_residents" : "resident",
        recipientCount: notifications.length,
        type,
      },
    });

    res.status(201).json({
      success: true,
      message: "Notification sent",
      target: sendToAllResidents ? "all_residents" : "resident",
      sent_count: notifications.length,
      push_delivery: pushDelivery,
      data: sendToAllResidents ? notifications : notifications[0],
      notifications,
      noti: notifications[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/send-to-user", protect, authorizeRoles("Admin"), async (req, res) => {
  try {
    const { user_id, title, message, type = "General", data = {} } = req.body;

    if (!user_id || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "user_id, title and message are required",
      });
    }

    const resident = await findResidentById(user_id);
    if (!resident) {
      return res.status(400).json({
        success: false,
        message: "Resident user not found",
      });
    }

    const notification = await Notification.create({
      user_id: resident._id,
      title,
      message,
      type,
      data: {
        ...data,
        sent_by: String(getUserId(req)),
        target: "resident",
      },
    });

    await emitNotification(req.app, resident._id, notification);
    const pushDelivery = await sendPushToUser(
      resident._id,
      {
        title,
        message,
        type,
        data: notification.data,
        notification_id: String(notification._id),
      },
      { channelId: getNotificationChannel(type) },
    );

    await recordAdminAudit({
      adminUserId: getUserId(req),
      action: "notification_sent_to_user",
      entityType: "Notification",
      entityId: notification._id,
      metadata: { recipientUserId: String(resident._id), type },
    });

    res.status(201).json({
      success: true,
      message: "Notification sent",
      sent_count: 1,
      push_delivery: pushDelivery,
      data: notification,
      noti: notification,
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
      const adminNotification = await Notification.findOne({
        _id: req.params.id,
        user_id: adminId,
      });

      if (!adminNotification) {
        return res.status(404).json({ success: false, message: "Notification not found" });
      }

      if (adminNotification.action_status === "Submitted") {
        return res.status(200).json({
          success: true,
          message: "Already submitted",
          data: adminNotification,
        });
      }

      const data = adminNotification.data || {};
      let residentId = data.resident_id || null;
      let sourceLabel = "notification";

      if (data.helper_request_id) {
        const request = await HelperRequest.findById(data.helper_request_id);
        if (request) {
          residentId = request.requested_by || residentId;
          request.status = request.status === "Completed" ? "Completed" : "In Progress";
          request.submitted_at = new Date();
          request.submitted_by = adminId;
          await request.save();
          sourceLabel = "helper request";
        }
      } else if (data.report_id) {
        const report = await Report.findById(data.report_id);
        if (report) {
          residentId = report.user_id || residentId;
          report.status = report.status === "Resolved" ? "Resolved" : "In Progress";
          report.submitted_at = new Date();
          report.submitted_by = adminId;
          await report.save();
          sourceLabel = "report";
        }
      }

      const resident = await findResidentById(residentId);
      if (!resident) {
        return res.status(422).json({
          success: false,
          message: "The originating resident account could not be found",
        });
      }

      const title = sourceLabel === "report"
        ? "Report submitted"
        : sourceLabel === "helper request"
          ? "Helper request submitted"
          : "Notification submitted";
      const message = `Admin has acknowledged and submitted your ${sourceLabel}.`;
      const residentNotification = await Notification.create({
        user_id: resident._id,
        title,
        message,
        type: adminNotification.type === "Report" ? "Report" : adminNotification.type === "Helper" ? "Helper" : "General",
        data: {
          source_notification_id: String(adminNotification._id),
          report_id: data.report_id || "",
          helper_request_id: data.helper_request_id || "",
          submitted_by: String(adminId),
        },
      });

      adminNotification.action_status = "Submitted";
      adminNotification.actioned_at = new Date();
      adminNotification.actioned_by = adminId;
      adminNotification.is_read = true;
      await adminNotification.save();

      await emitNotification(req.app, resident._id, residentNotification);
      const pushDelivery = await sendPushToUser(
        resident._id,
        {
          title,
          message,
          type: residentNotification.type,
          data: residentNotification.data,
          notification_id: String(residentNotification._id),
        },
        { channelId: getNotificationChannel(residentNotification.type) },
      );

      await recordAdminAudit({
        adminUserId: adminId,
        action: "resident_request_submitted",
        entityType: sourceLabel === "report" ? "Report" : sourceLabel === "helper request" ? "HelperRequest" : "Notification",
        entityId: data.report_id || data.helper_request_id || adminNotification._id,
        metadata: { residentUserId: String(resident._id) },
      });

      return res.status(200).json({
        success: true,
        message: "Submitted and resident notified",
        data: adminNotification,
        resident_notification: residentNotification,
        push_delivery: pushDelivery,
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

module.exports = router;
