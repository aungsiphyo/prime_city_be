const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema(
  {
    room_name: { type: String, required: true, unique: true, trim: true },
    building: { type: String, default: "A", trim: true },
    floor: { type: Number, required: true },
    room_type: {
      type: String,
      enum: ["Business", "Office", "Standard", "Premium"],
      required: true,
      default: "Standard",
    },
    status: {
      type: String,
      enum: ["Available", "Occupied", "Maintenance"],
      default: "Available",
    },
    resident_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    owner_name: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Room", RoomSchema);
