const mongoose = require("mongoose");

const DeviceTokenSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  platform: {
    type: String,
    enum: ["android", "ios", "unknown"],
    default: "unknown",
  },
  device_id: {
    type: String,
    trim: true,
  },
  app_version: {
    type: String,
    trim: true,
  },
  last_seen_at: {
    type: Date,
    default: Date.now,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

DeviceTokenSchema.index({ user_id: 1, last_seen_at: -1 });

module.exports = mongoose.model("DeviceToken", DeviceTokenSchema);
