const express = require("express");
const router = express.Router();
const Visitor = require("../models/Visitor");
const User = require("../models/User");
const Room = require("../models/Room");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

function optionalAuth(req, res, next) {
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return protect(req, res, next);
  }
  return next();
}

async function getAuthenticatedUser(req) {
  const userId = req.user?.id || req.user?._id;
  if (!userId) return null;
  return User.findById(userId).select("_id fullname role room_id").lean();
}

async function findLinkedRoom(user) {
  if (!user) return null;
  const roomRef = String(user.room_id || "").trim();
  const clauses = [{ resident_id: user._id }];
  if (roomRef) {
    if (require("mongoose").Types.ObjectId.isValid(roomRef)) clauses.push({ _id: roomRef });
    clauses.push({ room_name: roomRef });
  }
  return Room.findOne({ $or: clauses }).select("_id room_name").lean();
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRfidUid(value) {
  return String(value || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase();
}

function broadcastSSE(req, event, data) {
  const sseClients = req.app.get("sseClients") || new Map();
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of sseClients.values()) {
    try {
      if (client.req.destroyed || client.res.writableEnded) {
        client.cleanup?.();
        continue;
      }

      client.res.write(msg);
      if (client.res.flush) client.res.flush();
    } catch (err) {
      console.error("SSE Broadcast Error:", err.message);
      client.cleanup?.();
    }
  }
}

router.post("/register", optionalAuth, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      nric_number,
      company,
      hostName,
      purpose,
      purposeDetail,
      agreedToTerms,
      rfid_uid,
    } = req.body;

    const normalized = {
      firstName: cleanText(firstName),
      lastName: cleanText(lastName),
      email: cleanText(email).toLowerCase(),
      phone: cleanText(phone),
      nric_number: cleanText(nric_number),
      company: cleanText(company),
      hostName: cleanText(hostName),
      purpose: cleanText(purpose) || "Other",
      purposeDetail: cleanText(purposeDetail),
      agreedToTerms: Boolean(agreedToTerms),
      rfid_uid: cleanText(rfid_uid),
    };

    if (
      !normalized.firstName ||
      !normalized.lastName ||
      !normalized.email ||
      !normalized.phone ||
      !normalized.hostName ||
      !normalized.purpose
    ) {
      return res.status(400).json({
        success: false,
        message:
          "First name, last name, email, phone, host name, and purpose are required.",
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(normalized.email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required.",
      });
    }

    if (!normalized.agreedToTerms) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the terms before registering.",
      });
    }

    const authenticatedUser = await getAuthenticatedUser(req);
    const isManager = ["Admin", "Staff"].includes(authenticatedUser?.role);
    let linkedRoom = null;

    if (authenticatedUser && !isManager) {
      linkedRoom = await findLinkedRoom(authenticatedUser);
      if (!linkedRoom) {
        return res.status(400).json({
          success: false,
          message: "Your account is not linked to a room.",
        });
      }
    } else if (isManager && req.body.target_room_id) {
      linkedRoom = await Room.findById(req.body.target_room_id)
        .select("_id room_name")
        .lean();
    }

    const visitor = new Visitor({
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      email: normalized.email,
      phone: normalized.phone,
      nric_number: normalized.nric_number,
      company: normalized.company,
      hostName: authenticatedUser?.fullname || normalized.hostName,
      purpose: normalized.purpose,
      purposeDetail: normalized.purposeDetail,
      reason_for_visit: normalized.purposeDetail,
      agreedToTerms: normalized.agreedToTerms,
      rfid_uid: normalized.rfid_uid || undefined,
      registered_by: authenticatedUser?._id || null,
      target_room_id: linkedRoom?._id || null,
    });

    await visitor.save();

    broadcastSSE(req, "registered", {
      uid: visitor.visitor_uid,
      name: visitor.fullname,
      badge: visitor.badgeNumber,
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("visitor:registered", {
        uid: visitor.visitor_uid,
        name: visitor.fullname,
        badge: visitor.badgeNumber,
        time: new Date().toISOString(),
      });
      io.emit("visitor_checkin", visitor);
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful!",
      data: {
        visitor_uid: visitor.visitor_uid,
        rfid_uid: visitor.rfid_uid || null,
        badgeNumber: visitor.badgeNumber,
        name: visitor.fullname,
        id: visitor._id,
      },
    });
  } catch (err) {
    console.error("Registration Server Error:", err);

    if (err.name === "ValidationError") {
      const msgs = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: msgs.join(". "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error: " + err.message,
    });
  }
});

router.patch(
  "/:id/rfid",
  protect,
  authorizeRoles("Admin", "Staff", "Security"),
  async (req, res) => {
  try {
    const rfidUid = normalizeRfidUid(req.body.rfid_uid || req.body.rfidUid);

    if (!rfidUid) {
      return res.status(400).json({
        success: false,
        message: "RFID UID is required.",
      });
    }

    const [assignedResident, assignedVisitor] = await Promise.all([
      User.findOne({ rfid_uid: rfidUid })
        .select("_id resident_uid fullname")
        .lean(),
      Visitor.findOne({ _id: { $ne: req.params.id }, rfid_uid: rfidUid })
        .select("_id visitor_uid fullname")
        .lean(),
    ]);

    if (assignedResident || assignedVisitor) {
      return res.status(409).json({
        success: false,
        message: "This RFID card is already assigned.",
        assignedTo: assignedResident
          ? { type: "resident", ...assignedResident }
          : { type: "visitor", ...assignedVisitor },
      });
    }

    const visitor = await Visitor.findByIdAndUpdate(
      req.params.id,
      { $set: { rfid_uid: rfidUid } },
      { new: true, runValidators: true },
    );

    if (!visitor) {
      return res.status(404).json({
        success: false,
        message: "Visitor not found.",
      });
    }

    req.app.get("io")?.emit("visitor:rfid-assigned", {
      id: visitor._id,
      visitor_uid: visitor.visitor_uid,
      rfid_uid: visitor.rfid_uid,
      name: visitor.fullname,
      time: new Date().toISOString(),
    });

    return res.json({
      success: true,
      message: "RFID card assigned to visitor.",
      data: visitor,
    });
  } catch (err) {
    console.error("Visitor RFID assignment error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
  },
);

router.get("/", protect, async (req, res) => {
  try {
    const { date, page = 1, limit = 50 } = req.query;
    const currentUser = await getAuthenticatedUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, message: "User not found" });
    }
    const isManager = ["Admin", "Staff", "Security"].includes(currentUser.role);
    const filter = isManager ? {} : { registered_by: currentUser._id };

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);

      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      filter.createdAt = { $gte: start, $lte: end };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [visitors, total] = await Promise.all([
      Visitor.find(filter)
        .populate("target_room_id", "room_name building floor")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Visitor.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: visitors,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;
