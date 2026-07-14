const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const HelperRequest = require("../models/HelperRequest");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Room = require("../models/Room");
const optionalAuth = require("../middleware/optionalAuthMiddleware");
const { sendPushToUsers } = require("../services/push.service");

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

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketId = users[String(userId)];

  if (io && socketId) {
    io.to(socketId).emit("notification", notification);
  }
}

async function getCurrentUser(req) {
  const currentUserId = getUserId(req);
  if (!currentUserId) return null;

  return User.findById(currentUserId).select("_id fullname room_id").lean();
}

router.get("/", optionalAuth, async (req, res) => {
  try {
    const filter = {};

    if (req.query.mine === "true") {
      const currentUser = await getCurrentUser(req);
      if (currentUser?.room_id) {
        const roomId = await resolveRoomId(currentUser.room_id);
        if (!roomId) return res.json([]);
        filter.room_id = roomId;
      }
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

router.get("/:id", async (req, res) => {
  try {
    const request = await HelperRequest.findById(req.params.id)
      .populate("room_id")
      .populate("helper_id", "fullname photo phone gender experience status")
      .populate("requested_by", "fullname email phone")
      .lean();

    if (!request) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json(request);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", optionalAuth, async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req);
    const roomRef = req.body.room_id || currentUser?.room_id;
    const room_id = await resolveRoomId(roomRef);
    const {
      helper_id,
      type,
      note,
      gender_preferred = "No Preference",
    } = req.body;

    if (roomRef && !room_id) {
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

    const request = await HelperRequest.create({
      requested_by: currentUser?._id,
      room_id,
      helper_id,
      type,
      note,
      gender_preferred,
    });

    const populatedRequest = await HelperRequest.findById(request._id)
      .populate("room_id")
      .populate("helper_id", "fullname photo phone gender experience status")
      .populate("requested_by", "fullname email phone")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.emit("helper_request", populatedRequest);
    }

    const recipients = await User.find({ role: { $in: ["Admin", "Staff"] } })
      .select("_id")
      .lean();
    const recipientIds = recipients.map((user) => user._id);

    if (recipientIds.length) {
      const title = "New helper request";
      const message = `${type} helper request has been submitted.`;
      const notifications = await Notification.insertMany(
        recipientIds.map((userId) => ({
          user_id: userId,
          title,
          message,
          type: "Helper",
          data: {
            helper_request_id: String(populatedRequest._id),
            room_id: String(room_id),
            helper_id: helper_id ? String(helper_id) : "",
            request_type: type,
          },
        })),
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
            helper_id: helper_id ? String(helper_id) : "",
            request_type: type,
          },
        },
        { channelId: "helper_requests" },
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

router.put("/:id", async (req, res) => {
  try {
    const request = await HelperRequest.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true },
    )
      .populate("room_id")
      .populate("helper_id", "fullname photo phone gender experience status")
      .populate("requested_by", "fullname email phone");

    const io = req.app.get("io");
    if (io) {
      io.emit("helper_request", request);
    }

    res.json({
      success: true,
      message: "Request updated",
      data: request,
      request,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
