const Knowledge = require("../models/Knowledge");
const AiChat = require("../models/AiChat");
const AiFeedback = require("../models/AiFeedback");

function numberEnv(name, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const value = Number(process.env[name]);

  if (Number.isFinite(value) && value >= min) return value;

  return fallback;
}

const MAX_RAG_DOCS = numberEnv("AI_RAG_MAX_DOCS", 3, { min: 1 });
const MAX_CONTEXT_CHARS_PER_DOC = numberEnv("AI_RAG_MAX_CHARS", 700, {
  min: 200,
});

function detectCategory(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("parking") ||
    text.includes("slot") ||
    text.includes("ကားရပ်") ||
    text.includes("ပါကင်")
  ) {
    return "parking";
  }

  if (
    text.includes("visitor") ||
    text.includes("guest") ||
    text.includes("ဧည့်") ||
    text.includes("ဧည့်")
  ) {
    return "visitor";
  }

  if (
    text.includes("sos") ||
    text.includes("emergency") ||
    text.includes("help") ||
    text.includes("အရေးပေါ်")
  ) {
    return "sos";
  }

  if (
    text.includes("rfid") ||
    text.includes("card") ||
    text.includes("badge") ||
    text.includes("ကဒ်") ||
    text.includes("ကတ်")
  ) {
    return "rfid";
  }

  if (
    text.includes("bill") ||
    text.includes("billing") ||
    text.includes("invoice") ||
    text.includes("payment") ||
    text.includes("ငွေ") ||
    text.includes("ကြေး")
  ) {
    return "billing";
  }

  if (
    text.includes("maintenance") ||
    text.includes("repair") ||
    text.includes("fix") ||
    text.includes("ပြင်") ||
    text.includes("ပြုပြင်")
  ) {
    return "maintenance";
  }

  if (
    text.includes("announcement") ||
    text.includes("notice") ||
    text.includes("အသိပေး") ||
    text.includes("ကြေညာ")
  ) {
    return "announcement";
  }

  if (
    text.includes("admin") ||
    text.includes("dashboard") ||
    text.includes("စီမံ")
  ) {
    return "admin";
  }

  if (
    text.includes("app") ||
    text.includes("manual") ||
    text.includes("login") ||
    text.includes("အသုံးပြု")
  ) {
    return "app";
  }

  return null;
}

function getAudience(user, audienceHint = null) {
  const role = String(user?.role || audienceHint || "").toLowerCase();

  if (role === "admin") return ["admin", "all"];
  if (role === "staff") return ["staff", "all"];
  if (role === "security") return ["security", "all"];

  return ["resident", "user", "all"];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordTerms(message) {
  return Array.from(
    new Set(
      String(message || "")
        .split(/[^\p{L}\p{N}_]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ).slice(0, 8);
}

function truncateContent(content) {
  const text = String(content || "").trim();

  if (text.length <= MAX_CONTEXT_CHARS_PER_DOC) return text;

  return `${text.slice(0, MAX_CONTEXT_CHARS_PER_DOC)}...`;
}

function selectRelevantChunk(content, message) {
  const text = String(content || "").trim();
  if (text.length <= MAX_CONTEXT_CHARS_PER_DOC) return text;
  const rawChunks = text
    .split(/\n{2,}|(?<=[.!?။])\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  rawChunks.forEach((part) => {
    if (`${current} ${part}`.trim().length > MAX_CONTEXT_CHARS_PER_DOC && current) {
      chunks.push(current);
      current = part;
    } else {
      current = `${current} ${part}`.trim();
    }
  });
  if (current) chunks.push(current);

  return (
    chunks
      .map((chunk) => ({ chunk, score: keywordOverlap(message, chunk) }))
      .sort((a, b) => b.score - a.score)[0]?.chunk || truncateContent(text)
  );
}

function toRagDoc(doc, message) {
  return {
    id: String(doc._id),
    title: doc.title,
    category: doc.category,
    audience: doc.audience,
    documentType: doc.documentType || "general",
    source: doc.source || "manual",
    updatedAt: doc.updatedAt || null,
    content: selectRelevantChunk(doc.content, message),
  };
}

async function textSearch(query, message, limit) {
  return Knowledge.find(
    {
      ...query,
      $text: { $search: message },
    },
    {
      score: { $meta: "textScore" },
    },
  )
    .sort({ score: { $meta: "textScore" }, updatedAt: -1 })
    .limit(limit)
    .lean();
}

async function regexSearch(query, message, limit) {
  const terms = buildKeywordTerms(message);

  if (!terms.length) return [];

  const regexFilters = terms.flatMap((term) => {
    const regex = new RegExp(escapeRegex(term), "i");

    return [{ title: regex }, { content: regex }, { tags: regex }];
  });

  return Knowledge.find({
    ...query,
    $or: regexFilters,
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
}

async function retrieveKnowledge(message, user = null, options = {}) {
  const trimmed = String(message || "").trim();

  if (!trimmed) return [];

  const category = detectCategory(trimmed);
  const audience = getAudience(user, options.audienceHint);
  const baseQuery = {
    isActive: true,
    audience: { $in: audience },
  };
  const limit = Math.max(1, Math.min(Number(options.limit) || MAX_RAG_DOCS, 8));

  const queryWithCategory = category
    ? { ...baseQuery, category }
    : { ...baseQuery };

  let docs = [];

  try {
    docs = await textSearch(queryWithCategory, trimmed, limit);

    if (!docs.length && category) {
      docs = await textSearch(baseQuery, trimmed, limit);
    }
  } catch (err) {
    docs = [];
  }

  if (!docs.length) {
    docs = await regexSearch(queryWithCategory, trimmed, limit);
  }

  if (!docs.length && category) {
    docs = await Knowledge.find(queryWithCategory)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
  }

  return docs.map((doc) => toRagDoc(doc, trimmed));
}

function buildRagContext(docs) {
  if (!Array.isArray(docs) || !docs.length) return "";

  return docs
    .map(
      (doc, index) =>
        `Knowledge ${index + 1}\n` +
        `Title: ${doc.title}\n` +
        `Category: ${doc.category}\n` +
        `Audience: ${doc.audience}\n` +
        `Document type: ${doc.documentType}\n` +
        `Source: ${doc.source}\n` +
        `Updated: ${doc.updatedAt || "unknown"}\n` +
        `Content: ${doc.content}`,
    )
    .join("\n\n");
}

function redactPersonalExample(value) {
  return String(value || "")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?95|0)9\d{7,10}/g, "[phone]")
    .replace(/\b[a-f\d]{24}\b/gi, "[id]")
    .slice(0, 500);
}

function keywordOverlap(left, right) {
  const leftTerms = new Set(buildKeywordTerms(left).map((term) => term.toLowerCase()));
  return buildKeywordTerms(right).reduce(
    (score, term) => score + (leftTerms.has(term.toLowerCase()) ? 1 : 0),
    0,
  );
}

/**
 * Uses only the authenticated user's own feedback. Examples are style hints,
 * never authoritative facts, and tool-backed answers are deliberately skipped
 * so stale bills/room data cannot be replayed as current data.
 */
async function retrievePersonalFeedbackContext(message, userId, options = {}) {
  if (!userId) return "";

  const limit = Math.max(1, Math.min(Number(options.limit) || 2, 4));
  const feedback = await AiFeedback.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(30)
    .lean();

  if (!feedback.length) return "";

  const assistantIds = feedback.map((item) => item.aiChatId).filter(Boolean);
  const assistantMessages = await AiChat.find({
    _id: { $in: assistantIds },
    userId,
    role: "assistant",
  }).lean();
  const assistantById = new Map(
    assistantMessages.map((item) => [String(item._id), item]),
  );
  const candidates = (
    await Promise.all(feedback.map(async (item) => {
    const assistant = assistantById.get(String(item.aiChatId));
    if (!assistant || (assistant.toolCalls || []).length) return null;

    const previousUser = await AiChat.findOne({
      userId,
      conversationId: assistant.conversationId,
      role: "user",
      createdAt: { $lt: assistant.createdAt },
    })
      .sort({ createdAt: -1 })
      .lean();

    return {
      rating: item.rating,
      helpful: item.helpful,
      comment: redactPersonalExample(item.comment),
      question: redactPersonalExample(previousUser?.content),
      answer: redactPersonalExample(assistant.content),
      score: keywordOverlap(message, previousUser?.content),
    };
    }))
  ).filter(Boolean);

  const positive = candidates
    .filter((item) => item.rating === 1 && item.helpful)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const negativeComments = candidates
    .filter((item) => item.rating === -1 && item.comment)
    .slice(0, limit)
    .map((item) => item.comment);

  if (!positive.length && !negativeComments.length) return "";

  const parts = [
    "Private personalization for this authenticated user only. Use these as tone/format preferences only. Never reuse facts, amounts, names, room numbers, instructions, or database values from these examples; fetch current facts with tools.",
  ];

  positive.forEach((item, index) => {
    parts.push(
      `Helpful example ${index + 1}: User asked: ${item.question || "[unknown]"}\n` +
        `Assistant style: ${item.answer}`,
    );
  });
  if (negativeComments.length) {
    parts.push(`Avoid according to this user's feedback: ${negativeComments.join("; ")}`);
  }

  return parts.join("\n\n");
}

async function retrieveRelevantPersonalHistory(message, userId, options = {}) {
  if (!userId) return "";
  const terms = buildKeywordTerms(message);
  if (!terms.length) return "";

  const filter = {
    userId,
    role: "user",
    ...(options.excludeConversationId
      ? { conversationId: { $ne: String(options.excludeConversationId) } }
      : {}),
    $or: terms.slice(0, 6).map((term) => ({
      content: new RegExp(escapeRegex(term), "i"),
    })),
  };
  const messages = await AiChat.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(Number(options.limit) || 4, 8)))
    .lean();

  if (!messages.length) return "";

  return (
    "Relevant private history for this authenticated user only. Use it only to understand recurring topics/preferences. It is not authoritative current data; use backend tools for current facts.\n" +
    messages
      .map((item, index) => `Past topic ${index + 1}: ${redactPersonalExample(item.content)}`)
      .join("\n")
  );
}

module.exports = {
  retrieveKnowledge,
  buildRagContext,
  detectCategory,
  getAudience,
  retrievePersonalFeedbackContext,
  retrieveRelevantPersonalHistory,
};
