const mongoose = require("mongoose");

const ParkingEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["visitor", "resident"],
      required: true,
      index: true,
    },
    delta: {
      type: Number,
      enum: [1, -1],
      required: true,
    },
    source: {
      type: String,
      trim: true,
      default: "ESP32",
      index: true,
    },
    device_id: {
      type: String,
      trim: true,
    },
    previousUsedSlot: {
      type: Number,
      required: true,
      min: 0,
    },
    usedSlot: {
      type: Number,
      required: true,
      min: 0,
    },
    previousAvailableSlot: {
      type: Number,
      required: true,
      min: 0,
    },
    availableSlot: {
      type: Number,
      required: true,
      min: 0,
    },
    totalSlot: {
      type: Number,
      required: true,
      min: 0,
    },
    maintenanceSlot: {
      type: Number,
      required: true,
      min: 0,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
    },
    created_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ParkingEvent", ParkingEventSchema);
