const aiService = require("../services/ai.service");
const AiChat = require("../models/AiChat");
const AiFeedback = require("../models/AiFeedback");
const AiUserMemory = require("../models/AiUserMemory");
const Knowledge = require("../models/Knowledge");
const User = require("../models/User");
const {
  retrievePersonalFeedbackContext,
  retrieveRelevantPersonalHistory,
} = require("../services/rag.service");
const { recordAdminAudit } = require("../services/audit.service");

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

  if (
    body.feedbackType != null &&
    !["helpful", "not_helpful", "incorrect", "missing_information", "other"].includes(body.feedbackType)
  ) {
    errors.push("feedbackType is invalid");
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

    const { message, conversationId, enableRag } = req.body;
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

    const detectedHonorific = message.includes("ခင်ဗျာ")
      ? "khinbya"
      : message.includes("ရှင်")
        ? "shin"
        : null;
    let memory = await AiUserMemory.findOne({ userId }).lean();

    if (!memory || (memory.honorific === "neutral" && detectedHonorific)) {
      memory = await AiUserMemory.findOneAndUpdate(
        { userId },
        {
          $setOnInsert: { userId },
          ...(detectedHonorific ? { $set: { honorific: detectedHonorific } } : {}),
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();
    }

    // History is loaded by authenticated user + conversation on the server.
    // Client-supplied history is never trusted as a source of identity or data.
    const serverHistory = conversationId
      ? await AiChat.find({ userId, conversationId: String(conversationId) })
          .sort({ createdAt: -1 })
          .limit(30)
          .lean()
      : [];
    serverHistory.reverse();
    const [personalFeedbackContext, relevantPersonalHistory] = enableRag === false
      ? ["", ""]
      : await Promise.all([
          retrievePersonalFeedbackContext(message, userId).catch(() => ""),
          retrieveRelevantPersonalHistory(message, userId, {
            excludeConversationId: conversationId,
          }).catch(() => ""),
        ]);

    const result = await aiService.chat({
      message,
      conversationId,
      history: serverHistory,
      user: currentUser,
      enableRag: enableRag !== false,
      audienceHint: currentUser.role,
      honorific: memory?.honorific || "neutral",
      personalFeedbackContext,
      relevantPersonalHistory,
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
          feedbackType:
            req.body.feedbackType || (rating > 0 ? "helpful" : "not_helpful"),
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
        feedbackType: feedback.feedbackType,
        reviewStatus: feedback.reviewStatus,
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

async function listFeedbackForReview(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const filter = {};
    if (["pending", "approved", "rejected"].includes(req.query.status)) {
      filter.reviewStatus = req.query.status;
    }
    const [items, total] = await Promise.all([
      AiFeedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("userId", "fullname role")
        .populate("aiChatId", "content intent model createdAt")
        .lean(),
      AiFeedback.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: { total, page, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function reviewFeedback(req, res) {
  try {
    const reviewStatus = String(req.body.reviewStatus || "").trim().toLowerCase();
    if (!["approved", "rejected"].includes(reviewStatus)) {
      return res.status(400).json({
        success: false,
        message: "reviewStatus must be approved or rejected",
      });
    }

    const feedback = await AiFeedback.findById(req.params.id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: "Feedback not found" });
    }

    let knowledge = null;
    if (reviewStatus === "approved") {
      const approvedContent = String(req.body.approvedContent || "").trim();
      const title = String(req.body.title || "").trim();
      if (!title || !approvedContent) {
        return res.status(400).json({
          success: false,
          message: "title and approvedContent are required for approved feedback",
        });
      }

      knowledge = await Knowledge.create({
        title,
        content: approvedContent,
        category: req.body.category || "general",
        audience: req.body.audience || "all",
        tags: Array.isArray(req.body.tags) ? req.body.tags : [],
        documentType: "approved_feedback",
        source: "feedback_review",
        sourceReference: String(feedback._id),
        approvedBy: getUserId(req.user),
        isActive: true,
      });
    }

    feedback.reviewStatus = reviewStatus;
    feedback.reviewedBy = getUserId(req.user);
    feedback.reviewedAt = new Date();
    feedback.reviewNote = String(req.body.reviewNote || "").trim();
    feedback.approvedKnowledgeId = knowledge?._id || null;
    await feedback.save();

    await recordAdminAudit({
      adminUserId: getUserId(req.user),
      action: `ai_feedback_${reviewStatus}`,
      entityType: "AiFeedback",
      entityId: feedback._id,
      metadata: { approvedKnowledgeId: knowledge ? String(knowledge._id) : null },
    });

    return res.json({ success: true, data: feedback, knowledge });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

async function getMyChatHistory(req, res) {
  try {
    const userId = getUserId(req.user);
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 2000))
      : 1000;
    const filter = { userId };

    if (req.query.conversationId) {
      filter.conversationId = String(req.query.conversationId);
    }

    const [total, newestChats] = await Promise.all([
      AiChat.countDocuments(filter),
      AiChat.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    ]);
    const chats = newestChats.reverse();
    const mappedMessages = chats.map((message) => ({
      id: message.messageId || String(message._id),
      dbId: String(message._id),
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      timestamp: message.createdAt,
      toolCalls: message.toolCalls || [],
      knowledgeSources: message.knowledgeSources || [],
      intent: message.intent || null,
    }));
    const sessionsById = new Map();

    mappedMessages.forEach((message) => {
      if (!sessionsById.has(message.conversationId)) {
        sessionsById.set(message.conversationId, {
          conversationId: message.conversationId,
          title: "New chat",
          createdAt: message.timestamp,
          updatedAt: message.timestamp,
          messages: [],
        });
      }

      const session = sessionsById.get(message.conversationId);
      session.messages.push(message);
      session.updatedAt = message.timestamp;
      if (session.title === "New chat" && message.role === "user") {
        const normalized = message.content.replace(/\s+/g, " ").trim();
        session.title = normalized.length > 34
          ? `${normalized.slice(0, 34)}...`
          : normalized || "New chat";
      }
    });
    const sessions = Array.from(sessionsById.values()).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    );

    return res.status(200).json({
      success: true,
      messages: mappedMessages,
      sessions,
      pagination: { total, returned: mappedMessages.length, truncated: total > limit },
    });
  } catch (err) {
    console.error("GET /api/ai/history error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load AI chat history",
    });
  }
}

async function getMyChatSessions(req, res) {
  try {
    const userId = getUserId(req.user);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const match = { userId: new (require("mongoose").Types.ObjectId)(userId) };

    const [sessionRows, countRows] = await Promise.all([
      AiChat.aggregate([
        { $match: match },
        { $sort: { createdAt: 1 } },
        {
          $group: {
            _id: "$conversationId",
            createdAt: { $first: "$createdAt" },
            updatedAt: { $last: "$createdAt" },
            firstContent: { $first: "$content" },
          },
        },
        { $sort: { updatedAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
      AiChat.aggregate([
        { $match: match },
        { $group: { _id: "$conversationId" } },
        { $count: "total" },
      ]),
    ]);
    const conversationIds = sessionRows.map((row) => row._id);
    const messages = await AiChat.find({
      userId,
      conversationId: { $in: conversationIds },
    })
      .sort({ createdAt: 1 })
      .lean();
    const messagesBySession = new Map();
    messages.forEach((message) => {
      const mapped = {
        id: message.messageId || String(message._id),
        dbId: String(message._id),
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        timestamp: message.createdAt,
        toolCalls: message.toolCalls || [],
        knowledgeSources: message.knowledgeSources || [],
        intent: message.intent || null,
      };
      const existing = messagesBySession.get(message.conversationId) || [];
      existing.push(mapped);
      messagesBySession.set(message.conversationId, existing);
    });
    const sessions = sessionRows.map((row) => {
      const sessionMessages = messagesBySession.get(row._id) || [];
      const firstUserMessage = sessionMessages.find((item) => item.role === "user");
      const normalized = String(firstUserMessage?.content || row.firstContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return {
        conversationId: row._id,
        title:
          normalized.length > 34
            ? `${normalized.slice(0, 34)}...`
            : normalized || "New chat",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messages: sessionMessages,
      };
    });
    const total = countRows[0]?.total || 0;

    return res.json({
      success: true,
      sessions,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteMyConversation(req, res) {
  try {
    const userId = getUserId(req.user);
    const conversationId = String(req.params.conversationId || "").trim();

    if (!conversationId) {
      return res.status(400).json({ success: false, message: "conversationId is required" });
    }

    const result = await AiChat.deleteMany({ userId, conversationId });
    await AiFeedback.deleteMany({ userId, conversationId });

    return res.status(200).json({
      success: true,
      message: "Conversation deleted",
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
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
  getMyChatSessions,
  deleteMyConversation,
  listFeedbackForReview,
  reviewFeedback,
  postVoice,
};
