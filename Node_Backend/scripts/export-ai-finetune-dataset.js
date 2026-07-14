require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const AiChat = require("../src/models/AiChat");
const AiFeedback = require("../src/models/AiFeedback");
const User = require("../src/models/User");

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../exports/ai-training");
const DEFAULT_HISTORY_LIMIT = 8;
const DEFAULT_LIMIT = 5000;

function parseArgs(argv) {
  const options = {
    outDir: DEFAULT_OUTPUT_DIR,
    historyLimit: DEFAULT_HISTORY_LIMIT,
    limit: DEFAULT_LIMIT,
    since: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--out" && next) {
      options.outDir = path.resolve(process.cwd(), next);
      index += 1;
    } else if (arg === "--history-limit" && next) {
      options.historyLimit = Math.max(1, Number(next) || DEFAULT_HISTORY_LIMIT);
      index += 1;
    } else if (arg === "--limit" && next) {
      options.limit = Math.max(1, Number(next) || DEFAULT_LIMIT);
      index += 1;
    } else if (arg === "--since" && next) {
      const since = new Date(next);

      if (Number.isNaN(since.getTime())) {
        throw new Error(`Invalid --since date: ${next}`);
      }

      options.since = since;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run export:ai-dataset -- [options]

Options:
  --out <dir>             Output directory. Default: Node_Backend/exports/ai-training
  --limit <number>        Max feedback records to process. Default: ${DEFAULT_LIMIT}
  --history-limit <num>   Max previous turns included before target answer. Default: ${DEFAULT_HISTORY_LIMIT}
  --since <YYYY-MM-DD>    Only include feedback created on/after this date.

Outputs:
  ai-sft-*.jsonl          Positive-feedback rows for supervised fine-tuning.
  ai-review-*.jsonl       Negative-feedback rows for human rewrite/prompt/RAG review.
  ai-summary-*.json       Aggregate quality signals by intent/tool/RAG usage.
`);
}

function normalizeForReplacement(value) {
  return String(value || "").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createUserRedactors(users) {
  const values = [];

  users.forEach((user) => {
    [
      user.fullname,
      user.email,
      user.phone,
      user.resident_uid,
      user.rfid_uid,
    ].forEach((value) => {
      const normalized = normalizeForReplacement(value);
      if (normalized.length >= 4) values.push(normalized);
    });
  });

  return Array.from(new Set(values))
    .sort((a, b) => b.length - a.length)
    .map((value) => ({
      regex: new RegExp(escapeRegex(value), "gi"),
      replacement: "[REDACTED_USER_FIELD]",
    }));
}

function redactText(text, userRedactors) {
  let redacted = String(text || "");

  userRedactors.forEach(({ regex, replacement }) => {
    redacted = redacted.replace(regex, replacement);
  });

  return redacted
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(
      /(?:\+?95|09)[\s.-]?\d{2,4}[\s.-]?\d{3}[\s.-]?\d{3,5}/g,
      "[REDACTED_PHONE]",
    )
    .replace(
      /\b(?:RES|VIS)-[a-f0-9-]{12,}\b/gi,
      "[REDACTED_SYSTEM_UID]",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[REDACTED_UUID]",
    )
    .replace(/\b[0-9a-f]{24}\b/gi, "[REDACTED_OBJECT_ID]")
    .replace(/\b[A-F0-9]{8,16}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim();
}

function hashRef(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 24);
}

function getIntentName(intent) {
  if (!intent || typeof intent !== "object") return "unknown";

  return intent.name || intent.toolName || "unknown";
}

function getToolName(message) {
  const toolCall = Array.isArray(message.toolCalls) ? message.toolCalls[0] : null;

  return toolCall?.function?.name || message.intent?.toolName || "none";
}

function toTrainingRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function buildConversationMap(chats) {
  const map = new Map();

  chats.forEach((chat) => {
    const key = chat.conversationId;
    const list = map.get(key) || [];

    list.push(chat);
    map.set(key, list);
  });

  map.forEach((list) => {
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  });

  return map;
}

function buildMessagesForTarget({
  conversationMessages,
  targetChat,
  historyLimit,
  userRedactors,
}) {
  const targetIndex = conversationMessages.findIndex(
    (message) => String(message._id) === String(targetChat._id),
  );
  const safeTargetIndex = targetIndex >= 0 ? targetIndex : conversationMessages.length;
  const startIndex = Math.max(0, safeTargetIndex - historyLimit);
  const selected = conversationMessages.slice(startIndex, safeTargetIndex + 1);

  return selected
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: toTrainingRole(message.role),
      content: redactText(message.content, userRedactors),
    }))
    .filter((message) => message.content);
}

function createSummaryBucket() {
  return {
    total: 0,
    positive: 0,
    negative: 0,
    withTools: 0,
    withKnowledge: 0,
  };
}

function incrementBucket(summary, key, rating, targetChat) {
  if (!summary[key]) summary[key] = createSummaryBucket();

  const bucket = summary[key];
  bucket.total += 1;
  if (rating > 0) bucket.positive += 1;
  if (rating < 0) bucket.negative += 1;
  if (Array.isArray(targetChat.toolCalls) && targetChat.toolCalls.length) {
    bucket.withTools += 1;
  }
  if (
    Array.isArray(targetChat.knowledgeSources) &&
    targetChat.knowledgeSources.length
  ) {
    bucket.withKnowledge += 1;
  }
}

function writeJsonl(stream, row) {
  stream.write(`${JSON.stringify(row)}\n`);
}

async function loadFeedback(options) {
  const query = {};

  if (options.since) {
    query.createdAt = { $gte: options.since };
  }

  return AiFeedback.find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit)
    .lean();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required to export AI training data.");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const feedbackRows = await loadFeedback(options);
  const targetChatIds = feedbackRows.map((feedback) => feedback.aiChatId);
  const userIds = Array.from(
    new Set(feedbackRows.map((feedback) => String(feedback.userId))),
  );
  const targetChats = await AiChat.find({ _id: { $in: targetChatIds } }).lean();
  const targetById = new Map(
    targetChats.map((chat) => [String(chat._id), chat]),
  );
  const conversationIds = Array.from(
    new Set(targetChats.map((chat) => chat.conversationId)),
  );
  const conversationChats = await AiChat.find({
    conversationId: { $in: conversationIds },
  })
    .sort({ conversationId: 1, createdAt: 1 })
    .lean();
  const users = await User.find({ _id: { $in: userIds } })
    .select("fullname email phone resident_uid rfid_uid")
    .lean();
  const userRedactors = createUserRedactors(users);
  const conversationMap = buildConversationMap(conversationChats);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  fs.mkdirSync(options.outDir, { recursive: true });

  const sftPath = path.join(options.outDir, `ai-sft-${stamp}.jsonl`);
  const reviewPath = path.join(options.outDir, `ai-review-${stamp}.jsonl`);
  const summaryPath = path.join(options.outDir, `ai-summary-${stamp}.json`);
  const sftStream = fs.createWriteStream(sftPath, { encoding: "utf8" });
  const reviewStream = fs.createWriteStream(reviewPath, { encoding: "utf8" });
  const summary = {
    generatedAt: new Date().toISOString(),
    processedFeedback: 0,
    skippedFeedback: 0,
    sftRows: 0,
    reviewRows: 0,
    byIntent: {},
    byTool: {},
    byRagUsage: {},
  };

  for (const feedback of feedbackRows) {
    const targetChat = targetById.get(String(feedback.aiChatId));

    if (!targetChat || targetChat.role !== "assistant") {
      summary.skippedFeedback += 1;
      continue;
    }

    const conversationMessages =
      conversationMap.get(targetChat.conversationId) || [];
    const messages = buildMessagesForTarget({
      conversationMessages,
      targetChat,
      historyLimit: options.historyLimit,
      userRedactors,
    });

    if (!messages.length || messages[messages.length - 1]?.role !== "assistant") {
      summary.skippedFeedback += 1;
      continue;
    }

    const rating = Number(feedback.rating);
    const intentName = getIntentName(targetChat.intent);
    const toolName = getToolName(targetChat);
    const ragKey =
      Array.isArray(targetChat.knowledgeSources) &&
      targetChat.knowledgeSources.length
        ? "rag_used"
        : "no_rag";
    const metadata = {
      conversationRef: hashRef(targetChat.conversationId),
      assistantMessageRef: hashRef(targetChat.messageId || targetChat._id),
      intent: intentName,
      toolName,
      toolCount: Array.isArray(targetChat.toolCalls)
        ? targetChat.toolCalls.length
        : 0,
      knowledgeSourceCount: Array.isArray(targetChat.knowledgeSources)
        ? targetChat.knowledgeSources.length
        : 0,
      model: targetChat.model || "",
      usedFallback: Boolean(targetChat.usedFallback),
      feedbackRating: rating,
      feedbackHelpful: Boolean(feedback.helpful),
      feedbackCreatedAt: feedback.createdAt,
    };

    incrementBucket(summary.byIntent, intentName, rating, targetChat);
    incrementBucket(summary.byTool, toolName, rating, targetChat);
    incrementBucket(summary.byRagUsage, ragKey, rating, targetChat);
    summary.processedFeedback += 1;

    if (rating > 0 && feedback.helpful) {
      writeJsonl(sftStream, {
        messages,
        metadata,
      });
      summary.sftRows += 1;
    } else {
      writeJsonl(reviewStream, {
        messages,
        feedback: {
          rating,
          helpful: Boolean(feedback.helpful),
          resolved: feedback.resolved,
          comment: redactText(feedback.comment || "", userRedactors),
        },
        metadata,
        reviewTask:
          "Rewrite the assistant answer, improve prompt/tool routing, or add knowledge base content before using this as training data.",
      });
      summary.reviewRows += 1;
    }
  }

  await Promise.all([
    new Promise((resolve) => sftStream.end(resolve)),
    new Promise((resolve) => reviewStream.end(resolve)),
  ]);

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log("AI dataset export complete:");
  console.log(`SFT dataset: ${sftPath}`);
  console.log(`Review queue: ${reviewPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(
    `Rows: ${summary.sftRows} SFT, ${summary.reviewRows} review, ${summary.skippedFeedback} skipped.`,
  );
}

main()
  .catch((err) => {
    console.error("AI dataset export failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
