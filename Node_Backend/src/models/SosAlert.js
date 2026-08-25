const mongoose = require("mongoose");

const SosAlertSchema = new mongoose.Schema({
  resident_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  room_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Room",
  },

  room_label: {
    type: String,
    trim: true,
  },

  source: {
    type: String,
    trim: true,
    default: "ESP32",
  },

  message: {
    type: String,
    required: true,
    trim: true,
  },

  alert_type: {
    type: String,
    enum: ["General", "Medical", "Fire", "Security", "Maintenance"],
    default: "General",
  },

  priority: {
    type: String,
    enum: ["Low", "Medium", "High", "Critical"],
    default: "High",
  },

  status: {
    type: String,
    enum: [
      "Pending",
      "Approved",
      "In Progress",
      "Resolved",
      "Rejected",
      "SOS_ACTIVE",
      "Active",
    ],
    default: "Pending",
  },

  approved_at: {
    type: Date,
  },

  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  rejected_at: {
    type: Date,
  },

  rejected_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  rejection_reason: {
    type: String,
    trim: true,
  },

  broadcast_status: {
    type: String,
    enum: ["Not Sent", "Processing", "Sent", "Partial", "Failed"],
    default: "Not Sent",
  },

  broadcasted_at: {
    type: Date,
  },

  broadcast_recipient_count: {
    type: Number,
    default: 0,
    min: 0,
  },

  push_delivery: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  broadcast_error: {
    type: String,
    trim: true,
  },

  created_at: {
    type: Date,
    default: Date.now,
  },

  device_id: {
    type: String,
    trim: true,
  },

  resolved_at: {
    type: Date,
  },

  resolved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

SosAlertSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model("SosAlert", SosAlertSchema);
