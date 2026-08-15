const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const User = require("../models/User");
const optionalAuth = require("../middleware/optionalAuthMiddleware");
const { sendPushToUsers } = require("../services/push.service");

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketIds = users[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit("notification", notification);
  }
}

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 50);
    const { type, q } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [{ title: regex }, { message: regex }];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Announcement.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
      Announcement.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("GET /announcements error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", optionalAuth, async (req, res) => {
  try {
    const { user_id, title, message, type } = req.body;

    if (!title || !message || !type) {
      return res.status(400).json({
        success: false,
        message: "title, message and type are required",
      });
    }

    const announcement = await Announcement.create({
      user_id: user_id || getUserId(req),
      title,
      message,
      type,
    });

    const io = req.app.get("io");

    if (io) {
      io.emit("announcement", announcement);
    }

    const users = await User.find().select("_id").lean();
    const notifications = await Notification.insertMany(
      users.map((user) => ({
        user_id: user._id,
        title,
        message,
        type: "Announcement",
        data: {
          announcement_id: String(announcement._id),
          announcement_type: type,
        },
      })),
    );

    notifications.forEach((notification) => {
      emitNotificationToUser(req.app, notification.user_id, notification);
    });

    await sendPushToUsers(
      users.map((user) => user._id),
      {
        title,
        message,
        type: "Announcement",
        data: {
          announcement_id: String(announcement._id),
          announcement_type: type,
        },
      },
      { channelId: "community_updates" },
    );

    res.status(201).json({
      success: true,
      message: "Announcement created",
      data: announcement,
      announcement,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
