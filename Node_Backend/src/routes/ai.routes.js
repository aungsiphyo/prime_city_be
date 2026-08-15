const express = require("express");
const {
  postChat,
  postFeedback,
  getMyChatHistory,
  getMyChatSessions,
  deleteMyConversation,
  listFeedbackForReview,
  reviewFeedback,
  postVoice,
} = require("../controllers/ai.controller");
const requireAuth = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
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
router.get(
  "/feedback/admin",
  requireAuth,
  authorizeRoles("Admin", "Staff"),
  listFeedbackForReview,
);
router.post(
  "/feedback/:id/review",
  requireAuth,
  authorizeRoles("Admin", "Staff"),
  reviewFeedback,
);
router.get("/history", requireAuth, getMyChatHistory);
router.get("/history/sessions", requireAuth, getMyChatSessions);
router.delete("/history/:conversationId", requireAuth, deleteMyConversation);

module.exports = router;
