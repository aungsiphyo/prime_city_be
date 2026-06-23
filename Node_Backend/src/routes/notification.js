const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const DeviceToken = require("../models/DeviceToken");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");

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
  const socketId = users[String(userId)];

  if (io && socketId) {
    io.to(socketId).emit("notification", notification);
  }
}

async function findResidentById(userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) return null;

  return User.findOne({ _id: userId, role: "Citizen" })
    .select("_id fullname email phone room_id role")
    .lean();
}

async function listResidents() {
  return User.find({ role: "Citizen" })
    .select("_id fullname email phone room_id role")
    .sort({ fullname: 1 })
    .lean();
}

router.get("/", protect, async (req, res) => {
  try {
    const filter = { user_id: getUserId(req) };

    const limit = Math.max(1, Number(req.query.limit || 100));
    const notifications = await Notification.find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();

    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    if (sendToAllResidents) {
      await sendPushToUsers(
        recipients.map((user) => user._id),
        { title, message, type, data: notificationData },
        { channelId: getNotificationChannel(type) },
      );
    } else {
      const notification = notifications[0];
      await sendPushToUser(
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

    res.status(201).json({
      success: true,
      message: "Notification sent",
      target: sendToAllResidents ? "all_residents" : "resident",
      sent_count: notifications.length,
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
    await sendPushToUser(
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

    res.status(201).json({
      success: true,
      message: "Notification sent",
      data: notification,
      noti: notification,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
