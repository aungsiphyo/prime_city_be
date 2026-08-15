const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ["Maintenance", "Security", "Other"], required: true },
    location: { type: String, required: true },
    status: { type: String, enum: ["Open", "In Progress", "Resolved"], default: "Open" },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    submitted_at: { type: Date, default: null },
    submitted_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    created_at: { type: Date, default: Date.now },
});

ReportSchema.index({ user_id: 1, created_at: -1 });
ReportSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model("Report", ReportSchema);
