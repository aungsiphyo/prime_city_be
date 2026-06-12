const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ["Maintenance", "Security", "Other"], required: true },
    location: { type: String, required: true },
    status: { type: String, enum: ["Open", "In Progress", "Resolved"], default: "Open" },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Report", ReportSchema);