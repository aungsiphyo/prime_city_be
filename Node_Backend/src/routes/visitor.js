const express = require("express");
const router = express.Router();
const Visitor = require("../models/Visitor");
const User = require("../models/User");
const Room = require("../models/Room");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const crypto = require("crypto");
const {
  createVisitorQrToken,
  createVisitorQrImageDataUrl,
} = require("../services/visitorQr.service");

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
    if (require("mongoose").Types.ObjectId.isValid(roomRef))
      clauses.push({ _id: roomRef });
    clauses.push({ room_name: roomRef });
  }
  return Room.findOne({ $or: clauses }).select("_id room_name").lean();
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function yangonDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function visitorSchedule(value) {
  const date = cleanText(value) || yangonDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Visit date must use YYYY-MM-DD format");
  }
  const validFrom = new Date(`${date}T00:00:00+06:30`);
  const expiresAt = new Date(`${date}T23:59:59.999+06:30`);
  if (Number.isNaN(validFrom.getTime()) || expiresAt < new Date()) {
    throw new Error("Choose today or a future visit date");
  }
  return { date, validFrom, expiresAt };
}

function publicBaseUrl(req) {
  const configured = cleanText(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (configured) return configured;
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${protocol}://${req.get("host")}`;
}

async function buildVisitorPass(visitor, req) {
  const token = createVisitorQrToken({
    visitorId: visitor._id,
    qrId: visitor.pre_registration_qr_id,
    validFrom: visitor.qr_valid_from,
    expiresAt: visitor.qr_expires_at,
  });
  return {
    enabled: true,
    status: visitor.qr_status,
    valid_from: visitor.qr_valid_from,
    expires_at: visitor.qr_expires_at,
    qr_image_data_url: await createVisitorQrImageDataUrl(token),
    share_url: `${publicBaseUrl(req)}/visitor-pass#${token}`,
  };
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
      visitDate,
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

    const isPreRegistered = Boolean(authenticatedUser && linkedRoom);
    let schedule = null;
    if (isPreRegistered) {
      try {
        schedule = visitorSchedule(visitDate);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
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
      registration_type: isPreRegistered ? "PreRegistered" : "WalkIn",
      pre_registration_qr_id: isPreRegistered ? crypto.randomUUID() : undefined,
      qr_valid_from: schedule?.validFrom || null,
      qr_expires_at: schedule?.expiresAt || null,
      qr_status: isPreRegistered ? "Active" : null,
      visitDate: schedule?.validFrom || new Date(),
      check_in_time: isPreRegistered ? null : new Date(),
    });

    // Build the signed pass before persisting so a signing/configuration error
    // cannot leave behind a pre-registration that has no usable QR code.
    const pass = isPreRegistered ? await buildVisitorPass(visitor, req) : null;

    await visitor.save();

    if (!isPreRegistered) {
      broadcastSSE(req, "registered", {
        uid: visitor.visitor_uid,
        name: visitor.fullname,
        badge: visitor.badgeNumber,
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("visitor:registered", {
        uid: visitor.visitor_uid,
        name: visitor.fullname,
        badge: visitor.badgeNumber,
        time: new Date().toISOString(),
      });
      if (!isPreRegistered) io.emit("visitor_checkin", visitor);
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
        registration_type: visitor.registration_type,
        visitDate: visitor.visitDate,
        qr_status: visitor.qr_status,
        visitor_pass: pass,
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
      message: "Unable to complete visitor registration. Please try again.",
    });
  }
});

router.get("/:id/qr", protect, async (req, res) => {
  try {
    const currentUser = await getAuthenticatedUser(req);
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }
    const visitor = await Visitor.findById(req.params.id)
      .select("+pre_registration_qr_id")
      .populate("target_room_id", "room_name building floor");
    if (!visitor || visitor.registration_type !== "PreRegistered") {
      return res
        .status(404)
        .json({ success: false, message: "Visitor pass not found" });
    }
    const isManager = ["Admin", "Staff", "Security"].includes(currentUser.role);
    if (
      !isManager &&
      String(visitor.registered_by) !== String(currentUser._id)
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (visitor.qr_status === "Active" && visitor.qr_expires_at < new Date()) {
      visitor.qr_status = "Expired";
      await visitor.save();
    }
    const visitorPass =
      visitor.qr_status === "Active"
        ? await buildVisitorPass(visitor, req)
        : {
            enabled: false,
            status: visitor.qr_status,
            valid_from: visitor.qr_valid_from,
            expires_at: visitor.qr_expires_at,
            qr_image_data_url: null,
            share_url: null,
          };
    return res.json({
      success: true,
      data: {
        id: visitor._id,
        name: visitor.fullname,
        badgeNumber: visitor.badgeNumber,
        purpose: visitor.purpose,
        purposeDetail: visitor.purposeDetail,
        visitDate: visitor.visitDate,
        room: visitor.target_room_id?.room_name || null,
        registration_type: visitor.registration_type,
        qr_status: visitor.qr_status,
        visitor_pass: visitorPass,
      },
    });
  } catch (error) {
    console.error("Visitor QR retrieval error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load the visitor pass. Please try again.",
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
        { new: true, runValidators: true }
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
  }
);

router.get("/", protect, async (req, res) => {
  try {
    const { date, page = 1, limit = 50 } = req.query;
    const currentUser = await getAuthenticatedUser(req);
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
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
