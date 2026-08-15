const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema({
  admin_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  action: { type: String, required: true, trim: true, maxlength: 120 },
  entity_type: { type: String, required: true, trim: true, maxlength: 80 },
  entity_id: { type: String, default: "", trim: true, maxlength: 160 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  created_at: { type: Date, default: Date.now, index: true },
});

adminAuditLogSchema.index({ admin_user_id: 1, created_at: -1 });
adminAuditLogSchema.index({ entity_type: 1, entity_id: 1, created_at: -1 });

module.exports = mongoose.model("AdminAuditLog", adminAuditLogSchema);
