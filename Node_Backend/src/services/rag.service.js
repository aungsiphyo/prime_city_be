const Knowledge = require("../models/Knowledge");

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

function toRagDoc(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    category: doc.category,
    audience: doc.audience,
    content: truncateContent(doc.content),
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

  return docs.map(toRagDoc);
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
        `Content: ${doc.content}`,
    )
    .join("\n\n");
}

module.exports = {
  retrieveKnowledge,
  buildRagContext,
  detectCategory,
  getAudience,
};
