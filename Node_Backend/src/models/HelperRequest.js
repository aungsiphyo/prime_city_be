const mongoose = require("mongoose");

const HelperRequestSchema = new mongoose.Schema({
  room_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Room",
    required: true,
  },
  type: { type: String, required: true }, // e.g., "Cleaning", "Maintenance"
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
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("HelperRequest", HelperRequestSchema);
