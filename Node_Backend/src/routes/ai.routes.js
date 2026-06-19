const express = require("express");
const { postChat, getMyChatHistory } = require("../controllers/ai.controller");
const requireAuth = require("../middleware/authMiddleware");
const optionalAuth = require("../middleware/optionalAuthMiddleware");
const {
  aiRateLimit,
  requireAIAuthIfConfigured,
} = require("../middleware/aiChatGuard");

const router = express.Router();

router.post(
  "/chat",
  optionalAuth,
  requireAIAuthIfConfigured,
  aiRateLimit,
  postChat,
);
router.get("/history", requireAuth, getMyChatHistory);

module.exports = router;
