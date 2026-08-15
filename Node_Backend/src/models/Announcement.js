const mongoose = require("mongoose");

const AnnouncementSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    type: {
      type: String,
      enum: ["General", "Maintenance", "Event"],
      required: true,
    },
    status: {
      type: String,
      enum: ["Active", "Completed", "Archived"],
      default: "Active",
      index: true,
    },
    audience_type: {
      type: String,
      enum: ["All Residents", "Building", "Floor", "Room"],
      default: "All Residents",
    },
    audience_building: { type: String, trim: true, default: "" },
    audience_floor: { type: Number, default: null },
    audience_room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
    },
    is_read: { type: Boolean, default: false },
    completed_at: { type: Date, default: null },
    completed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    archived_at: { type: Date, default: null },
    archived_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completion_notified_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

AnnouncementSchema.index({ status: 1, type: 1, created_at: -1 });
AnnouncementSchema.index({ audience_type: 1, created_at: -1 });

module.exports = mongoose.model("Announcement", AnnouncementSchema);
