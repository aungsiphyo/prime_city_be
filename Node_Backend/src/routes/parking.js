const express = require("express");
const router = express.Router();
const Parking = require("../models/Parking");
const ParkingEvent = require("../models/ParkingEvent");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

function isValidType(type) {
  return ["visitor", "resident"].includes(type);
}

function calculateAvailable(totalSlot, usedSlot, maintenanceSlot) {
  const usableSlot = Math.max(totalSlot - maintenanceSlot, 0);
  return Math.max(usableSlot - usedSlot, 0);
}

// POST /api/parking/setup
router.post("/setup", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const { type, totalSlot, maintenanceSlot = 0 } = req.body;

    if (!isValidType(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be visitor or resident",
      });
    }

    const total = Number(totalSlot);
    const maintenance = Number(maintenanceSlot);

    if (Number.isNaN(total) || total < 0) {
      return res.status(400).json({
        success: false,
        message: "totalSlot must be 0 or greater",
      });
    }

    if (Number.isNaN(maintenance) || maintenance < 0 || maintenance > total) {
      return res.status(400).json({
        success: false,
        message: "maintenanceSlot must be between 0 and totalSlot",
      });
    }

    const parking = await Parking.findOneAndUpdate(
      { type },
      {
        type,
        totalSlot: total,
        usedSlot: 0,
        maintenanceSlot: maintenance,
        availableSlot: total - maintenance,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );

    res.status(201).json({
      success: true,
      message: "Parking setup saved successfully",
      data: parking,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/parking
router.get("/", async (req, res) => {
  try {
    const parking = await Parking.find().sort({ type: 1 });

    res.json({
      success: true,
      data: parking,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/parking/events/history
router.get(
  "/events/history",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (type) {
      if (!isValidType(type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid parking type",
        });
      }

      filter.type = type;
    }

    const pageNumber = Math.max(Number(page), 1);
    const limitNumber = Math.max(Number(limit), 1);
    const skip = (pageNumber - 1) * limitNumber;

    const [events, total] = await Promise.all([
      ParkingEvent.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      ParkingEvent.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: events,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        pages: Math.ceil(total / limitNumber),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
  },
);

// GET /api/parking/visitor
// GET /api/parking/resident
router.get("/:type", async (req, res) => {
  try {
    const { type } = req.params;

    if (!isValidType(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid parking type",
      });
    }

    const parking = await Parking.findOne({ type });

    if (!parking) {
      return res.status(404).json({
        success: false,
        message: "Parking data not found",
      });
    }

    res.json({
      success: true,
      data: parking,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/parking/visitor/delta
// PATCH /api/parking/resident/delta
router.patch(
  "/:type/delta",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
  try {
    const { type } = req.params;
    const delta = Number(req.body.delta);

    if (!isValidType(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid parking type",
      });
    }

    if (![1, -1].includes(delta)) {
      return res.status(400).json({
        success: false,
        message: "delta must be 1 or -1",
      });
    }

    const parking = await Parking.findOne({ type });

    if (!parking) {
      return res.status(404).json({
        success: false,
        message: "Parking setup not found",
      });
    }

    const usableSlot = Math.max(parking.totalSlot - parking.maintenanceSlot, 0);

    let newUsedSlot = parking.usedSlot + delta;

    if (newUsedSlot < 0) newUsedSlot = 0;
    if (newUsedSlot > usableSlot) newUsedSlot = usableSlot;

    parking.usedSlot = newUsedSlot;
    parking.availableSlot = calculateAvailable(
      parking.totalSlot,
      parking.usedSlot,
      parking.maintenanceSlot,
    );

    await parking.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("parking_update", parking);
    }

    res.json({
      success: true,
      message: "Parking updated successfully",
      data: parking,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
  },
);

// PATCH /api/parking/visitor/reset
// PATCH /api/parking/resident/reset
router.patch(
  "/:type/reset",
  protect,
  authorizeRoles("Admin", "Staff"),
  async (req, res) => {
  try {
    const { type } = req.params;

    if (!isValidType(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid parking type",
      });
    }

    const parking = await Parking.findOne({ type });

    if (!parking) {
      return res.status(404).json({
        success: false,
        message: "Parking setup not found",
      });
    }

    parking.usedSlot = 0;
    parking.availableSlot = Math.max(
      parking.totalSlot - parking.maintenanceSlot,
      0,
    );

    await parking.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("parking_update", parking);
    }

    res.json({
      success: true,
      message: "Parking reset successfully",
      data: parking,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
  },
);

module.exports = router;
