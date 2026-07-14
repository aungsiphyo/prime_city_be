const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const SosAlert = require("../models/SosAlert");
const User = require("../models/User");
const Room = require("../models/Room");
const Notification = require("../models/Notification");
const optionalAuth = require("../middleware/optionalAuthMiddleware");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");

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

// =========================
// GET /api/sos
// List SOS alerts
// Query:
// ?status=Pending
// ?q=fire
// ?page=1&limit=50
// =========================
router.get("/", async (req, res) => {
  try {
    const { status, q, page = 1, limit = 50 } = req.query;

    const filter = {};

    if (status) {
      filter.status = status;
    }

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
});

// =========================
// GET /api/sos/:id
// Get single SOS alert details
// =========================
router.get("/:id", async (req, res) => {
  try {
    const alert = await SosAlert.findById(req.params.id)
      .populate("resident_id", "fullname email phone role")
      .populate("room_id")
      .lean();

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
});

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
router.post("/", optionalAuth, async (req, res) => {
  try {
    let { resident_id, room_id, message, alert_type = "General" } = req.body;
    const { priority = "High" } = req.body;
    const currentUserId = getUserId(req);

    if (currentUserId && (!resident_id || !room_id)) {
      const currentUser = await User.findById(currentUserId)
        .select("_id room_id")
        .lean();
      resident_id = resident_id || currentUser?._id;
      room_id = room_id || currentUser?.room_id;
    }

    if (!resident_id || !room_id || !message) {
      return res.status(400).json({
        success: false,
        message: "resident_id, room_id and message are required",
      });
    }

    // Resolve room reference when a non-ObjectId (e.g., room name like "A222") is provided
    if (room_id && !mongoose.Types.ObjectId.isValid(String(room_id))) {
      const lookup = String(room_id || "").trim();
      const linkedRoom = await Room.findOne({
        $or: [{ room_name: lookup }, { room_id: lookup }],
      });
      if (linkedRoom) {
        room_id = String(linkedRoom._id);
      }
    }

    const sos = await SosAlert.create({
      resident_id,
      room_id,
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
      io.emit("sos_alert_created", populatedSos);
      io.emit("admin_sos_alert", populatedSos);
    }

    const responderUsers = await User.find({
      role: { $in: ["Admin", "Staff", "Security"] },
    })
      .select("_id")
      .lean();

    await notifyUsers(
      req.app,
      responderUsers.map((user) => user._id),
      {
        title: `SOS Alert: ${alert_type}`,
        message,
        type: "SOS",
        data: {
          sos_id: String(populatedSos._id),
          alert_type,
          priority,
          room_id: String(room_id),
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
router.post("/emergency", async (req, res) => {
  try {
    const {
      title = "Emergency SOS Alert",
      message = "Emergency alert from admin",
      level = "Critical",
    } = req.body;

    const io = req.app.get("io");

    if (!io) {
      return res.status(500).json({
        success: false,
        message: "Socket.IO not initialized",
      });
    }

    const emergencyData = {
      title,
      message,
      level,
      created_at: new Date(),
    };

    io.emit("emergency_sos", emergencyData);

    const users = await User.find().select("_id").lean();
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
});

// =========================
// PUT /api/sos/:id
// Update SOS alert status
// Body:
// {
//   "status": "Resolved"
// }
// =========================
router.put("/:id", async (req, res) => {
  try {
    const allowed = {};

    if (req.body.status) {
      allowed.status = req.body.status;

      if (req.body.status === "Resolved") {
        allowed.resolved_at = new Date();
      }
    }

    if (req.body.resolved_at) {
      allowed.resolved_at = req.body.resolved_at;
    }

    if (req.body.message) {
      allowed.message = req.body.message;
    }

    if (req.body.priority) {
      allowed.priority = req.body.priority;
    }

    const updated = await SosAlert.findByIdAndUpdate(req.params.id, allowed, {
      new: true,
      runValidators: true,
    })
      .populate("resident_id", "fullname email phone role")
      .populate("room_id");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "SOS alert not found",
      });
    }

    const io = req.app.get("io");

    if (io) {
      io.emit("sos_alert_updated", updated);
      io.emit("admin_sos_alert_updated", updated);
    }

    res.json({
      success: true,
      message: "SOS alert updated successfully",
      data: updated,
    });
  } catch (err) {
    console.error("PUT /api/sos/:id error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// =========================
// DELETE /api/sos/:id
// Delete SOS alert
// =========================
router.delete("/:id", async (req, res) => {
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

    res.json({
      success: true,
      message: "SOS alert deleted successfully",
    });
  } catch (err) {
    console.error("DELETE /api/sos/:id error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
