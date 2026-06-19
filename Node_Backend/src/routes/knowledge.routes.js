const express = require("express");
const {
  listKnowledge,
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
} = require("../controllers/knowledge.controller");
const optionalAuth = require("../middleware/optionalAuthMiddleware");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/", optionalAuth, listKnowledge);
router.post("/", protect, authorizeRoles("Admin", "Staff"), createKnowledge);
router.put("/:id", protect, authorizeRoles("Admin", "Staff"), updateKnowledge);
router.delete(
  "/:id",
  protect,
  authorizeRoles("Admin", "Staff"),
  deleteKnowledge,
);

module.exports = router;
