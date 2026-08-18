const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const Room = require("../models/Room");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const optionalAuth = require("../middleware/optionalAuthMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { resolveCurrentRoom } = require("../services/aiTools.service");
const { recordAdminAudit } = require("../services/audit.service");
const { sendPushToUsers } = require("../services/push.service");

function getUserId(req) {
  return req.user?.id || req.user?._id;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emitNotificationToUser(app, userId, notification) {
  const io = app.get("io");
  const users = app.get("onlineUsers") || {};
  const socketIds = users[String(userId)];

  if (io && socketIds) {
    io.to(Array.isArray(socketIds) ? socketIds : [socketIds]).emit("notification", notification);
  }
}

function legacyActiveFilter() {
  return { $or: [{ status: "Active" }, { status: { $exists: false } }] };
}

function validateAudience(body) {
  const audienceType = body.audience_type || "All Residents";
  const payload = {
    audience_type: audienceType,
    audience_building: "",
    audience_floor: null,
    audience_room_id: null,
  };

  if (audienceType === "Building") {
    payload.audience_building = String(body.audience_building || "").trim();
    if (!payload.audience_building) throw new Error("audience_building is required");
  } else if (audienceType === "Floor") {
    payload.audience_building = String(body.audience_building || "").trim();
    payload.audience_floor = Number(body.audience_floor);
    if (!Number.isInteger(payload.audience_floor)) {
      throw new Error("audience_floor must be an integer");
    }
  } else if (audienceType === "Room") {
    if (!body.audience_room_id) throw new Error("audience_room_id is required");
    payload.audience_room_id = body.audience_room_id;
  } else if (audienceType !== "All Residents") {
    throw new Error("Invalid audience_type");
  }

  return payload;
}

function buildAudienceRoomFilter(announcement) {
  if (announcement.audience_type === "Room") {
    return { _id: announcement.audience_room_id };
  }
  if (announcement.audience_type === "Building") {
    return { building: announcement.audience_building };
  }
  if (announcement.audience_type === "Floor") {
    return {
      floor: announcement.audience_floor,
      ...(announcement.audience_building
        ? { building: announcement.audience_building }
        : {}),
    };
  }
  return null;
}

async function getAudienceResidents(announcement) {
  const roomFilter = buildAudienceRoomFilter(announcement);
  if (!roomFilter) {
    return User.find({ role: "Resident" }).select("_id").lean();
  }

  const rooms = await Room.find({ ...roomFilter, resident_id: { $ne: null } })
    .select("resident_id")
    .lean();
  const ids = rooms.map((room) => room.resident_id).filter(Boolean);
  return User.find({ _id: { $in: ids }, role: "Resident" }).select("_id").lean();
}

async function notifyAudience(app, announcement, title, message, lifecycleEvent) {
  const residents = await getAudienceResidents(announcement);
  const residentIds = residents.map((resident) => resident._id);
  if (!residentIds.length) return { recipientCount: 0, push: null };

  const data = {
    announcement_id: String(announcement._id),
    announcement_type: announcement.type,
    announcement_status: announcement.status || "Active",
    lifecycle_event: lifecycleEvent,
  };
  const notifications = await Notification.insertMany(
    residentIds.map((userId) => ({
      user_id: userId,
      title,
      message,
      type: "Announcement",
      data,
    })),
  );
  notifications.forEach((notification) => {
    emitNotificationToUser(app, notification.user_id, notification);
  });
  const push = await sendPushToUsers(
    residentIds,
    { title, message, type: "Announcement", data },
    { channelId: "community_updates" },
  );
  return { recipientCount: residentIds.length, push };
}

function residentAudienceFilter(room) {
  return {
    $or: [
      { audience_type: "All Residents" },
      { audience_type: { $exists: false } },
      ...(room
        ? [
            { audience_type: "Building", audience_building: room.building },
            {
              audience_type: "Floor",
              audience_floor: room.floor,
              $or: [
                { audience_building: room.building },
                { audience_building: "" },
              ],
            },
            { audience_type: "Room", audience_room_id: room._id },
          ]
        : []),
    ],
  };
}

function versionOnePublicAudienceFilter() {
  return {
    $or: [
      { audience_type: "All Residents" },
      { audience_type: { $exists: false } },
    ],
  };
}

router.get("/", optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { type, q, status } = req.query;
    const authenticatedUserId = getUserId(req);
    const currentUser = authenticatedUserId
      ? await User.findById(authenticatedUserId)
          .select("_id role room_id")
          .lean()
      : null;
    if (authenticatedUserId && !currentUser) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    const filters = [];
    if (q) {
      const regex = new RegExp(escapeRegex(q.trim().slice(0, 120)), "i");
      filters.push({ $or: [{ title: regex }, { message: regex }] });
    }

    if (!currentUser) {
      // Version 1 clients did not attach Authorization to announcement reads.
      // Keep that installed build working without exposing targeted notices.
      filters.push(legacyActiveFilter());
      filters.push(versionOnePublicAudienceFilter());
    } else if (["Admin", "Staff"].includes(currentUser.role)) {
      if (status) filters.push({ status });
      else if (req.query.include_archived !== "true") {
        filters.push({
          $or: [
            { status: { $in: ["Active", "Completed"] } },
            { status: { $exists: false } },
          ],
        });
      }
    } else {
      const resolved = await resolveCurrentRoom(currentUser);
      filters.push(legacyActiveFilter());
      filters.push(residentAudienceFilter(resolved.found ? resolved.room : null));
    }

    const filter = filters.length ? { $and: filters } : {};
    if (type) filter.type = type;

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

router.post("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const { title, message, type } = req.body;

    if (!title || !message || !type) {
      return res.status(400).json({
        success: false,
        message: "title, message and type are required",
      });
    }

    const audience = validateAudience(req.body);
    if (audience.audience_room_id && !(await Room.exists({ _id: audience.audience_room_id }))) {
      return res.status(400).json({ success: false, message: "Audience room not found" });
    }
    const announcement = await Announcement.create({
      user_id: getUserId(req),
      title: String(title).trim(),
      message: String(message).trim(),
      type,
      ...audience,
    });
    const delivery = await notifyAudience(
      req.app,
      announcement,
      announcement.title,
      announcement.message,
      "created",
    );

    await recordAdminAudit({
      adminUserId: getUserId(req),
      action: "announcement_created",
      entityType: "Announcement",
      entityId: announcement._id,
      metadata: { type, audienceType: announcement.audience_type },
    });

    res.status(201).json({
      success: true,
      message: "Announcement created",
      data: announcement,
      announcement,
      delivery,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

async function closeAnnouncement(req, res, archive) {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }
    if (archive && announcement.status === "Archived") {
      return res.json({ success: true, message: "Announcement is already archived", data: announcement });
    }
    if (!archive && announcement.status === "Completed") {
      return res.json({ success: true, message: "Maintenance is already completed", data: announcement });
    }

    const shouldNotify =
      announcement.type === "Maintenance" && !announcement.completion_notified_at;
    if (archive) {
      announcement.status = "Archived";
      announcement.archived_at = new Date();
      announcement.archived_by = getUserId(req);
    } else {
      if (announcement.type !== "Maintenance") {
        return res.status(400).json({
          success: false,
          message: "Only maintenance announcements can be marked completed",
        });
      }
      announcement.status = "Completed";
      announcement.completed_at = new Date();
      announcement.completed_by = getUserId(req);
    }

    let delivery = { recipientCount: 0, push: null };
    if (shouldNotify) {
      announcement.completion_notified_at = new Date();
      delivery = await notifyAudience(
        req.app,
        announcement,
        "Maintenance completed",
        `${announcement.title} has been completed. The maintenance notice is no longer active.`,
        archive ? "archived" : "completed",
      );
    }
    await announcement.save();
    await recordAdminAudit({
      adminUserId: getUserId(req),
      action: archive ? "announcement_archived" : "maintenance_completed",
      entityType: "Announcement",
      entityId: announcement._id,
      metadata: { type: announcement.type, notifiedResidents: delivery.recipientCount },
    });
    return res.json({
      success: true,
      message: archive ? "Announcement archived" : "Maintenance completed",
      data: announcement,
      delivery,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

router.patch(
  "/:id/complete",
  protect,
  authorizeRoles("Admin", "Staff"),
  (req, res) => closeAnnouncement(req, res, false),
);

router.patch(
  "/:id/archive",
  protect,
  authorizeRoles("Admin", "Staff"),
  (req, res) => closeAnnouncement(req, res, true),
);

router.delete(
  "/:id",
  protect,
  authorizeRoles("Admin", "Staff"),
  (req, res) => closeAnnouncement(req, res, true),
);

module.exports = router;
