const mongoose = require("mongoose");

const AnnouncementSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ["General", "Maintenance", "Event"], required: true },
    is_read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Announcement", AnnouncementSchema);