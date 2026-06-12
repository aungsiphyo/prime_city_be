const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema({
  room_name: { type: String, required: true, unique: true },
  floor: { type: Number, required: true },
  room_type: { type: String, enum: ["Office", "Standard", "Premium"], required: true, default: "Standard" },
  status: { type: String, enum: ["Available", "Occupied", "Maintenance"], default: "Available" },
});

module.exports = mongoose.model("Room", RoomSchema);
