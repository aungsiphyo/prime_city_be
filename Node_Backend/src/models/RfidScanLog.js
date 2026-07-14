const mongoose = require("mongoose");

const RfidScanLogSchema = new mongoose.Schema(
  {
    valid: {
      type: Boolean,
      required: true,
      index: true,
    },
    message: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      trim: true,
      default: "rfid_scan",
      index: true,
    },
    device_id: {
      type: String,
      trim: true,
      index: true,
    },
    cardCode: {
      type: String,
      trim: true,
    },
    hardwareUid: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
    },
    personType: {
      type: String,
      enum: ["resident", "visitor", null],
      default: null,
      index: true,
    },
    matchType: {
      type: String,
      enum: ["hardwareUid", "cardCode", null],
      default: null,
    },
    resident_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    visitor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visitor",
    },
    room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
    },
    response: {
      type: mongoose.Schema.Types.Mixed,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
    },
    scanned_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("RfidScanLog", RfidScanLogSchema);
