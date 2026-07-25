const express = require("express");
const {
  postChat,
  postFeedback,
  getMyChatHistory,
  postVoice,
} = require("../controllers/ai.controller");
const requireAuth = require("../middleware/authMiddleware");
const {
  aiRateLimit,
  requireAIAuthIfConfigured,
} = require("../middleware/aiChatGuard");

const router = express.Router();

// ── Text Chat (Gemini 3.1 Flash Lite) ──────────────────────────────
router.post(
  "/chat",
  requireAuth,
  requireAIAuthIfConfigured,
  aiRateLimit,
  postChat,
);

// ── Voice Chat (Gemini 2.5 Flash - Native Audio Dialog) ────────────
router.post(
  "/voice",
  requireAuth,
  requireAIAuthIfConfigured,
  aiRateLimit,
  postVoice,
);

router.post("/feedback", requireAuth, postFeedback);
router.get("/history", requireAuth, getMyChatHistory);

module.exports = router;
