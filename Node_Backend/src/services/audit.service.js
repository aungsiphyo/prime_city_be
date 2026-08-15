const AdminAuditLog = require("../models/AdminAuditLog");

function sanitizeMetadata(metadata = {}) {
  const blocked = new Set([
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "privateKey",
    "serviceAccount",
  ]);

  return Object.entries(metadata).reduce((result, [key, value]) => {
    if (!blocked.has(key) && value !== undefined) result[key] = value;
    return result;
  }, {});
}

async function recordAdminAudit({ adminUserId, action, entityType, entityId, metadata }) {
  if (!adminUserId || !action || !entityType) return null;

  try {
    return await AdminAuditLog.create({
      admin_user_id: adminUserId,
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : "",
      metadata: sanitizeMetadata(metadata),
    });
  } catch (err) {
    console.warn("Admin audit log failed:", err.message);
    return null;
  }
}

module.exports = { recordAdminAudit };
