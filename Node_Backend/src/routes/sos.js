const express = require("express");
const router = express.Router();
const SosAlert = require("../models/SosAlert");

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
router.post("/", async (req, res) => {
  try {
    const {
      resident_id,
      room_id,
      message,
      alert_type = "General",
      priority = "High",
    } = req.body;

    if (!resident_id || !room_id || !message) {
      return res.status(400).json({
        success: false,
        message: "resident_id, room_id and message are required",
      });
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
