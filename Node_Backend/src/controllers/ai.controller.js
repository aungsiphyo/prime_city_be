const aiService = require("../services/ai.service");

function validateChatBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body is required"];
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    errors.push("message is required and must be a non-empty string");
  } else if (body.message.length > 4000) {
    errors.push("message must be 4000 characters or fewer");
  }

  if (body.conversationId != null && typeof body.conversationId !== "string") {
    errors.push("conversationId must be a string when provided");
  }

  if (body.history != null && !Array.isArray(body.history)) {
    errors.push("history must be an array when provided");
  }

  return errors;
}

async function postChat(req, res) {
  try {
    const errors = validateChatBody(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: errors.join("; "),
      });
    }

    const { message, conversationId, history } = req.body;

    const result = await aiService.chat({
      message,
      conversationId,
      history,
      user: req.user || null,
    });

    return res.status(200).json({
      success: true,
      conversationId: result.conversationId,
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      toolCalls: result.toolCalls,
      meta: {
        model: result.model,
        usedFallback: result.usedFallback,
      },
    });
  } catch (err) {
    console.error("POST /api/ai/chat error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to process chat message",
    });
  }
}

module.exports = {
  postChat,
};
