const mongoose = require("mongoose");

const HelperRequestSchema = new mongoose.Schema({
  requested_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  room_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Room",
    required: true,
  },
  helper_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Helper",
  },
  type: { type: String, required: true }, // e.g., "Cleaning", "Maintenance"
  quoted_price_mmk: { type: Number, min: 0, default: null },
  quoted_currency: { type: String, enum: ["MMK"], default: "MMK" },
  service_window: { type: String, trim: true, default: null },
  pricing_status: {
    type: String,
    enum: ["Fixed", "Admin Confirmation"],
    default: "Admin Confirmation",
  },
  note: {
    type: String,
    trim: true,
  },
  gender_preferred: {
    type: String,
    enum: ["Male", "Female", "No Preference"],
    default: "No Preference",
  },
  status: {
    type: String,
    enum: ["Pending", "In Progress", "Completed"],
    default: "Pending",
  },
  submitted_at: { type: Date, default: null },
  submitted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  created_at: { type: Date, default: Date.now },
});

HelperRequestSchema.index({ requested_by: 1, created_at: -1 });
HelperRequestSchema.index({ room_id: 1, status: 1, created_at: -1 });

module.exports = mongoose.model("HelperRequest", HelperRequestSchema);
