const express = require("express");
const router = express.Router();
const Report = require("../models/Report");
const Notification = require("../models/Notification");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const { sendPushToUsers } = require("../services/push.service");

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketId = users[String(userId)];

  if (io && socketId) {
    io.to(socketId).emit("notification", notification);
  }
}

router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 50, type, status, q } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [{ title: regex }, { message: regex }, { location: regex }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Report.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("user_id", "fullname email phone role room_id")
        .lean(),
      Report.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error("GET /reports error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", protect, async (req, res) => {
  try {
    const currentUserId = getUserId(req);
    const { title, message, type, location } = req.body;

    if (!title || !message || !type || !location) {
      return res.status(400).json({
        success: false,
        message: "title, message, type and location are required",
      });
    }

    const report = await Report.create({
      title,
      message,
      type,
      location,
      user_id: currentUserId,
    });

    const populatedReport = await Report.findById(report._id)
      .populate("user_id", "fullname email phone role room_id")
      .lean();

    const io = req.app.get("io");

    if (io) {
      io.emit("report_update", populatedReport);
      io.emit("admin_report_created", populatedReport);
    }

    const recipients = await User.find({ role: { $in: ["Admin", "Staff"] } })
      .select("_id")
      .lean();
    const recipientIds = recipients.map((user) => user._id);

    if (recipientIds.length) {
      const notificationTitle = "New resident report";
      const notificationMessage = `${type} report submitted: ${title}`;
      const notifications = await Notification.insertMany(
        recipientIds.map((userId) => ({
          user_id: userId,
          title: notificationTitle,
          message: notificationMessage,
          type: "Report",
          data: {
            report_id: String(report._id),
            report_type: type,
            resident_id: String(currentUserId),
          },
        })),
      );

      notifications.forEach((notification) => {
        emitNotificationToUser(req.app, notification.user_id, notification);
      });

      await sendPushToUsers(
        recipientIds,
        {
          title: notificationTitle,
          message: notificationMessage,
          type: "Report",
          data: {
            report_id: String(report._id),
            report_type: type,
            resident_id: String(currentUserId),
          },
        },
        { channelId: "community_updates" },
      );
    }

    res.status(201).json({
      success: true,
      message: "Report submitted",
      data: populatedReport,
      report: populatedReport,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    }).populate("user_id", "fullname email phone role room_id");

    const io = req.app.get("io");

    if (io) {
      io.emit("report_update", report);
    }

    res.json({ message: "Report updated", report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
