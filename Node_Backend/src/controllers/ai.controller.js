const aiService = require("../services/ai.service");
const AiChat = require("../models/AiChat");
const AiFeedback = require("../models/AiFeedback");
const User = require("../models/User");

function getUserId(user) {
  return user?.id || user?._id || null;
}

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

  if (body.enableRag != null && typeof body.enableRag !== "boolean") {
    errors.push("enableRag must be a boolean when provided");
  }

  if (body.ragContext != null && typeof body.ragContext !== "string") {
    errors.push("ragContext must be a string when provided");
  }

  return errors;
}

function validateFeedbackBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body is required"];
  }

  if (
    typeof body.conversationId !== "string" ||
    !body.conversationId.trim()
  ) {
    errors.push("conversationId is required");
  }

  if (typeof body.messageId !== "string" || !body.messageId.trim()) {
    errors.push("messageId is required");
  }

  if (![1, -1].includes(Number(body.rating))) {
    errors.push("rating must be 1 or -1");
  }

  if (body.helpful != null && typeof body.helpful !== "boolean") {
    errors.push("helpful must be a boolean when provided");
  }

  if (body.resolved != null && typeof body.resolved !== "boolean") {
    errors.push("resolved must be a boolean when provided");
  }

  if (body.comment != null && typeof body.comment !== "string") {
    errors.push("comment must be a string when provided");
  } else if (typeof body.comment === "string" && body.comment.length > 1000) {
    errors.push("comment must be 1000 characters or fewer");
  }

  if (body.appVersion != null && typeof body.appVersion !== "string") {
    errors.push("appVersion must be a string when provided");
  }

  return errors;
}

async function persistChatTurn(user, result) {
  const userId = getUserId(user);

  if (!userId) return;

  await AiChat.create([
    {
      userId,
      conversationId: result.conversationId,
      messageId: result.userMessage.id,
      role: "user",
      content: result.userMessage.content,
    },
    {
      userId,
      conversationId: result.conversationId,
      messageId: result.assistantMessage.id,
      role: "assistant",
      content: result.assistantMessage.content,
      toolCalls: result.toolCalls || [],
      knowledgeSources: result.knowledgeSources || [],
      intent: result.intent || null,
      model: result.model || "",
      usedFallback: Boolean(result.usedFallback),
    },
  ]);
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

    const { message, conversationId, history, enableRag, ragContext } =
      req.body;
    const userId = getUserId(req.user);
    const currentUser = await User.findById(userId)
      .select("_id fullname role room_id resident_uid")
      .lean();

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user account was not found",
      });
    }

    const result = await aiService.chat({
      message,
      conversationId,
      history,
      user: currentUser,
      enableRag: enableRag !== false,
      audienceHint: ragContext,
    });

    await persistChatTurn(currentUser, result);

    return res.status(200).json({
      success: true,
      conversationId: result.conversationId,
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      toolCalls: result.toolCalls,
      knowledgeSources: result.knowledgeSources,
      meta: {
        model: result.model,
        usedFallback: result.usedFallback,
        intent: result.intent || null,
        ragUsed: result.knowledgeSources.length > 0,
        knowledgeSources: result.knowledgeSources,
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

async function postFeedback(req, res) {
  try {
    const errors = validateFeedbackBody(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: errors.join("; "),
      });
    }

    const userId = getUserId(req.user);
    const conversationId = req.body.conversationId.trim();
    const messageId = req.body.messageId.trim();
    const rating = Number(req.body.rating);
    const helpful =
      typeof req.body.helpful === "boolean" ? req.body.helpful : rating > 0;

    const chatMessage = await AiChat.findOne({
      userId,
      conversationId,
      messageId,
      role: "assistant",
    }).lean();

    if (!chatMessage) {
      return res.status(404).json({
        success: false,
        message: "Assistant message not found for this conversation",
      });
    }

    const feedback = await AiFeedback.findOneAndUpdate(
      {
        userId,
        conversationId,
        messageId,
      },
      {
        $set: {
          aiChatId: chatMessage._id,
          rating,
          helpful,
          resolved:
            typeof req.body.resolved === "boolean" ? req.body.resolved : null,
          comment: req.body.comment ? req.body.comment.trim() : "",
          source: "mobile",
          appVersion: req.body.appVersion ? req.body.appVersion.trim() : "",
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return res.status(200).json({
      success: true,
      feedback: {
        id: String(feedback._id),
        conversationId: feedback.conversationId,
        messageId: feedback.messageId,
        rating: feedback.rating,
        helpful: feedback.helpful,
        resolved: feedback.resolved,
        comment: feedback.comment,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
      },
    });
  } catch (err) {
    console.error("POST /api/ai/feedback error:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Feedback already exists for this assistant message",
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save AI feedback",
    });
  }
}

async function getMyChatHistory(req, res) {
  try {
    const userId = getUserId(req.user);
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 200))
      : 100;
    const filter = { userId };

    if (req.query.conversationId) {
      filter.conversationId = String(req.query.conversationId);
    }

    const chats = await AiChat.find(filter)
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      messages: chats.map((message) => ({
        id: message.messageId || String(message._id),
        dbId: String(message._id),
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        timestamp: message.createdAt,
        toolCalls: message.toolCalls || [],
        knowledgeSources: message.knowledgeSources || [],
        intent: message.intent || null,
      })),
    });
  } catch (err) {
    console.error("GET /api/ai/history error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load AI chat history",
    });
  }
}

async function postVoice(req, res) {
  try {
    const { audioBase64, mimeType, voicePreset } = req.body;

    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res.status(400).json({
        success: false,
        message: "audioBase64 is required and must be a string",
      });
    }

    const resolvedMime = typeof mimeType === "string" ? mimeType : "audio/m4a";
    const userId = getUserId(req.user);
    const currentUser = await User.findById(userId)
      .select("_id fullname role room_id resident_uid")
      .lean();

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user account was not found",
      });
    }

    const result = await aiService.voiceChat({
      audioBase64,
      mimeType: resolvedMime,
      user: currentUser,
      voicePreset: typeof voicePreset === "string" ? voicePreset : null,
    });

    return res.status(200).json({
      success: true,
      audioBase64: result.audioBase64,
      audioMimeType: result.audioMimeType,
      transcript: result.transcript,
      userTranscript: result.userTranscript,
      meta: {
        model: result.model,
      },
    });
  } catch (err) {
    console.error("POST /api/ai/voice error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to process voice message",
    });
  }
}

module.exports = {
  postChat,
  postFeedback,
  getMyChatHistory,
  postVoice,
};
