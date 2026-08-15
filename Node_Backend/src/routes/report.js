const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Report = require("../models/Report");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Room = require("../models/Room");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { sendPushToUser, sendPushToUsers } = require("../services/push.service");
const { recordAdminAudit } = require("../services/audit.service");

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

async function findResidentRoom(user) {
  if (!user) return null;

  const roomRef = String(user.room_id || "").trim();
  const roomFilters = [{ resident_id: user._id }];

  if (roomRef) {
    if (mongoose.Types.ObjectId.isValid(roomRef)) {
      roomFilters.push({ _id: roomRef });
    }
    roomFilters.push({ room_name: roomRef });
  }

  return Room.findOne({ $or: roomFilters })
    .select("_id room_name building floor room_type status")
    .lean();
}

async function addSourceRoom(report) {
  if (!report) return report;

  const room = await findResidentRoom(report.user_id);
  return {
    ...report,
    source_room: room,
  };
}

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketIds = users[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit("notification", notification);
  }
}

router.get("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
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

    const enrichedItems = await Promise.all(items.map(addSourceRoom));

    return res.json({
      success: true,
      data: enrichedItems,
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
    const enrichedReport = await addSourceRoom(populatedReport);

    const io = req.app.get("io");

    if (io) {
      io.emit("report_update", enrichedReport);
      io.emit("admin_report_created", enrichedReport);
    }

    const recipients = await User.find({ role: { $in: ["Admin", "Staff"] } })
      .select("_id")
      .lean();
    const recipientIds = recipients.map((user) => user._id);

    if (recipientIds.length) {
      const notificationTitle = "New resident report";
      const roomName = enrichedReport.source_room?.room_name || location;
      const residentName = populatedReport.user_id?.fullname || "Resident";
      const notificationMessage = `${type} report from Room ${roomName} by ${residentName}: ${title}`;
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
            resident_name: residentName,
            room_id: enrichedReport.source_room?._id
              ? String(enrichedReport.source_room._id)
              : "",
            room_name: roomName,
            location,
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
            resident_name: residentName,
            room_id: enrichedReport.source_room?._id
              ? String(enrichedReport.source_room._id)
              : "",
            room_name: roomName,
            location,
          },
        },
        { channelId: "community_updates" },
      );
    }

    res.status(201).json({
      success: true,
      message: "Report submitted",
      data: enrichedReport,
      report: enrichedReport,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/mine", protect, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const filter = { user_id: getUserId(req) };
    if (req.query.status) filter.status = req.query.status;
    const [items, total] = await Promise.all([
      Report.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Report.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post(
  "/:id/submit",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    try {
      const adminId = getUserId(req);
      const report = await Report.findById(req.params.id);

      if (!report) {
        return res.status(404).json({ success: false, message: "Report not found" });
      }

      const alreadySubmitted = Boolean(report.submitted_at);

      if (!alreadySubmitted) {
        report.status = report.status === "Resolved" ? "Resolved" : "In Progress";
        report.submitted_at = new Date();
        report.submitted_by = adminId;
        await report.save();

        const notification = await Notification.create({
          user_id: report.user_id,
          title: "Report submitted",
          message: `Admin has acknowledged and submitted your report: ${report.title}`,
          type: "Report",
          data: {
            report_id: String(report._id),
            submitted_by: String(adminId),
          },
        });

        emitNotificationToUser(req.app, report.user_id, notification);
        await sendPushToUser(
          report.user_id,
          {
            title: notification.title,
            message: notification.message,
            type: "Report",
            data: notification.data,
            notification_id: String(notification._id),
          },
          { channelId: "community_updates" },
        );
      }

      await Notification.updateMany(
        {
          user_id: adminId,
          "data.report_id": String(report._id),
        },
        {
          $set: {
            action_status: "Submitted",
            actioned_at: report.submitted_at,
            actioned_by: adminId,
            is_read: true,
          },
        },
      );

      await recordAdminAudit({
        adminUserId: adminId,
        action: alreadySubmitted ? "report_submit_rechecked" : "report_submitted",
        entityType: "Report",
        entityId: report._id,
        metadata: { residentUserId: String(report.user_id), status: report.status },
      });

      const populated = await Report.findById(report._id)
        .populate("user_id", "fullname email phone role room_id")
        .lean();

      return res.status(200).json({
        success: true,
        message: alreadySubmitted
          ? "Report was already submitted"
          : "Report submitted and resident notified",
        data: await addSourceRoom(populated),
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
);

router.get("/:id", protect, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate("user_id", "fullname email phone role room_id")
      .lean();

    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    const currentUserId = String(getUserId(req));
    const isManager = ["Admin", "Staff"].includes(req.user.role);

    if (!isManager && String(report.user_id?._id) !== currentUserId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    return res.json({ success: true, data: await addSourceRoom(report) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put(
  "/:id",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
    try {
      const report = await Report.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
      }).populate("user_id", "fullname email phone role room_id");

      const io = req.app.get("io");

      if (io) {
        io.emit("report_update", report);
      }

      await recordAdminAudit({
        adminUserId: getUserId(req),
        action: "report_updated",
        entityType: "Report",
        entityId: report?._id || req.params.id,
        metadata: { status: report?.status || req.body.status || null },
      });

      res.json({ message: "Report updated", report });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
