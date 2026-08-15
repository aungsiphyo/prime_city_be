const express = require("express");
const router = express.Router();
const ServiceBill = require("../models/ServiceBill");
const User = require("../models/User");
const Room = require("../models/Room");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { resolveCurrentRoom } = require("../services/aiTools.service");

function populateBillRoom(query) {
  return query.populate({
    path: "room_id",
    select: "room_name building floor room_type status owner_name resident_id",
    populate: {
      path: "resident_id",
      select: "fullname email phone role resident_uid",
    },
  });
}

async function roomExists(roomId) {
  if (!roomId) return false;

  try {
    return Boolean(await Room.exists({ _id: roomId }));
  } catch (_err) {
    return false;
  }
}

router.get("/", protect, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id)
      .select("_id role room_id")
      .lean();

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user account was not found",
      });
    }

    const filter = {};
    const canViewAllBills = ["Admin", "Staff"].includes(currentUser.role);

    if (!canViewAllBills) {
      const resolved = await resolveCurrentRoom(currentUser);

      if (!resolved.found) {
        return res.json({
          success: true,
          scope: "own_room",
          room: null,
          data: [],
        });
      }

      filter.room_id = resolved.room._id;
    }

    const bills = await populateBillRoom(
      ServiceBill.find(filter).sort({ due_date: -1, created_at: -1 }),
    ).lean();

    res.json({
      success: true,
      scope: canViewAllBills ? "all_rooms" : "own_room",
      data: bills,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    if (!(await roomExists(req.body.room_id))) {
      return res.status(400).json({
        success: false,
        message: "A valid room_id is required",
      });
    }

    const bill = await ServiceBill.create(req.body);
    const populatedBill = await populateBillRoom(
      ServiceBill.findById(bill._id),
    ).lean();

    const io = req.app.get("io");
    if (io) io.emit("bill_update", populatedBill);

    res.status(201).json({
      success: true,
      message: "Bill created",
      bill: populatedBill,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/:id", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    if (req.body.room_id && !(await roomExists(req.body.room_id))) {
      return res.status(400).json({
        success: false,
        message: "room_id does not match an existing room",
      });
    }

    const bill = await ServiceBill.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    const populatedBill = await populateBillRoom(
      ServiceBill.findById(bill._id),
    ).lean();

    const io = req.app.get("io");
    if (io) io.emit("bill_update", populatedBill);

    res.json({
      success: true,
      message: "Bill updated",
      bill: populatedBill,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
