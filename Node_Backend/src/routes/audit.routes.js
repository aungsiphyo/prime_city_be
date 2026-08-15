const express = require("express");
const AdminAuditLog = require("../models/AdminAuditLog");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/", protect, authorizeRoles("Admin"), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const filter = {};
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.entity_type) filter.entity_type = String(req.query.entity_type);
    const [items, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("admin_user_id", "fullname role")
        .lean(),
      AdminAuditLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
