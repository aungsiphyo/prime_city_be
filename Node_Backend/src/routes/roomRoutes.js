const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Room = require("../models/Room");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const {
  buildRoomFinanceFields,
} = require("../services/propertyFinance.service");

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

async function buildRoomPayload(body, existingRoom = null) {
  const payload = { ...body };
  const roomType = body.room_type || existingRoom?.room_type || "Standard";

  Object.assign(
    payload,
    buildRoomFinanceFields(roomType, {
      purchase_date: body.purchase_date || existingRoom?.purchase_date,
      down_payment_paid_at: existingRoom?.down_payment_paid_at,
      installment_start_date: existingRoom?.installment_start_date,
      installments_paid: existingRoom?.installments_paid || 0,
    }),
  );

  if (Object.prototype.hasOwnProperty.call(body, "resident_id")) {
    const residentId = String(body.resident_id || "").trim();

    if (!residentId) {
      payload.resident_id = null;
      payload.owner_name = "";
      if (!body.status && existingRoom?.status === "Occupied") {
        payload.status = "Available";
      }
      return payload;
    }

    if (!isObjectId(residentId)) {
      const err = new Error("resident_id must be a valid user id");
      err.status = 400;
      throw err;
    }

    const resident = await User.findById(residentId)
      .select("_id fullname")
      .lean();

    if (!resident) {
      const err = new Error("Resident user not found");
      err.status = 404;
      throw err;
    }

    const existingAssignment = await Room.findOne({
      resident_id: resident._id,
      ...(existingRoom?._id ? { _id: { $ne: existingRoom._id } } : {}),
    }).lean();

    if (existingAssignment) {
      const err = new Error("Resident is already assigned to another room");
      err.status = 400;
      throw err;
    }

    payload.resident_id = resident._id;
    payload.owner_name = resident.fullname;
    if (!body.status) payload.status = "Occupied";
  }

  if (typeof body.owner_name === "string") {
    payload.owner_name = body.owner_name.trim();
  }

  return payload;
}

async function syncResidentRoomLink(room, previousResidentId = null) {
  if (!room) return;

  const roomId = String(room._id);
  const roomName = String(room.room_name || "");
  const currentResidentId = room.resident_id ? String(room.resident_id) : null;
  const previousId = previousResidentId ? String(previousResidentId) : null;

  if (previousId && previousId !== currentResidentId) {
    await User.updateOne(
      { _id: previousId, room_id: { $in: [roomId, roomName] } },
      { $set: { room_id: "" } },
    );
  }

  if (currentResidentId) {
    await User.findByIdAndUpdate(currentResidentId, {
      $set: { room_id: roomId },
    });
  }
}

function populateRoom(query) {
  return query.populate(
    "resident_id",
    "fullname email phone role resident_uid room_id",
  );
}

router.post("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const payload = await buildRoomPayload(req.body);
    const savedRoom = await new Room(payload).save();
    await syncResidentRoomLink(savedRoom);

    const populatedRoom = await populateRoom(Room.findById(savedRoom._id));
    res.status(201).json(populatedRoom);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Room name must be unique." });
    }
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get("/", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.resident_id) filter.resident_id = req.query.resident_id;
    if (req.query.floor) filter.floor = Number(req.query.floor);
    if (req.query.building) filter.building = req.query.building;

    const rooms = await populateRoom(
      Room.find(filter).sort({ building: 1, floor: 1, room_name: 1 }),
    );
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const room = await populateRoom(Room.findById(req.params.id));
    if (!room) return res.status(404).json({ message: "Room not found" });
    res.status(200).json(room);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const existingRoom = await Room.findById(req.params.id).lean();
    if (!existingRoom)
      return res.status(404).json({ message: "Room not found" });

    const payload = await buildRoomPayload(req.body, existingRoom);
    const updatedRoom = await Room.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    await syncResidentRoomLink(updatedRoom, existingRoom.resident_id);

    const populatedRoom = await populateRoom(Room.findById(updatedRoom._id));
    res.status(200).json(populatedRoom);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete("/:id", protect, authorizeRoles("Admin", "Staff"), async (req, res) => {
  try {
    const deletedRoom = await Room.findByIdAndDelete(req.params.id);
    if (!deletedRoom)
      return res.status(404).json({ message: "Room not found" });

    await syncResidentRoomLink(
      { ...deletedRoom.toObject(), resident_id: null },
      deletedRoom.resident_id,
    );

    res.status(200).json({ message: "Room successfully deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
