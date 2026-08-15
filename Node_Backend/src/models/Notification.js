const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "Report",
      "Visitor",
      "General",
      "SOS",
      "Announcement",
      "Helper",
      "Emergency",
    ],
    required: true,
  },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  is_read: { type: Boolean, default: false },
  action_status: {
    type: String,
    enum: ["Pending", "Submitted"],
    default: "Pending",
  },
  actioned_at: { type: Date, default: null },
  actioned_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  created_at: { type: Date, default: Date.now },
});

NotificationSchema.index({ user_id: 1, is_read: 1, created_at: -1 });
NotificationSchema.index({ user_id: 1, action_status: 1, created_at: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
