const mongoose = require("mongoose");

const ParkingSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["visitor", "resident"],
      required: true,
      unique: true,
    },
    totalSlot: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    usedSlot: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    availableSlot: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    maintenanceSlot: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Parking", ParkingSchema);
