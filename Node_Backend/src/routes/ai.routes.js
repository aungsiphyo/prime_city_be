const express = require("express");
const { postChat } = require("../controllers/ai.controller");

const router = express.Router();

// POST /api/ai/chat
// Body: { "message": "Hello", "conversationId": "optional", "history": [] }
router.post("/chat", postChat);

module.exports = router;
