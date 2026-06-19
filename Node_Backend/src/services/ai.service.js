const crypto = require("crypto");
const { getToolSchemas } = require("./toolRegistry");
const { runTool } = require("./aiTools.service");
const { retrieveKnowledge, buildRagContext } = require("./rag.service");
const { classifyIntent, isToolIntent } = require("./intent.service");

const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://localhost:11434"
).replace(/\/+$/, "");

function numberEnv(name, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const value = Number(process.env[name]);

  if (Number.isFinite(value) && value >= min) return value;

  return fallback;
}

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:12b";
const OLLAMA_TIMEOUT_MS = numberEnv("OLLAMA_TIMEOUT_MS", 120000, {
  min: 1000,
});
const OLLAMA_NUM_CTX = numberEnv("OLLAMA_NUM_CTX", 4096, { min: 512 });
const OLLAMA_NUM_PREDICT = numberEnv("OLLAMA_NUM_PREDICT", 180, { min: 32 });
const OLLAMA_TEMPERATURE = numberEnv("OLLAMA_TEMPERATURE", 0.3, { min: 0 });
const OLLAMA_THINK = process.env.OLLAMA_THINK === "true";
const AI_HISTORY_LIMIT = numberEnv("AI_HISTORY_LIMIT", 8, { min: 0 });

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  `
You are SmartRes AI, a helpful assistant for a smart residential community.

Rules:
- Reply in Myanmar language unless the user uses English.
- When replying in Myanmar, use Myanmar Unicode script only. Do not use romanized Burmese unless the user explicitly asks for romanization.
- You can help with parking, rooms, bills, visitors, SOS, announcements, and community services.
- You understand intents such as parking status, room info, bills, visitors, maintenance requests, RAG policy search, SOS, and general chat.
- Never expose private data.
- Use database/tool data only when provided.
- Never guess real-time database values such as parking slots, room data, bills, visitors, or maintenance request status.
- Use knowledge base context when it is provided and relevant.
- For community rules, fees, policies, manuals, and notices, do not invent facts.
- If data is missing, say you cannot find it.
- For SOS or emergency messages, give calm immediate safety guidance. Do not claim an alert was sent unless backend data confirms it.
`;

const RESPONSE_STYLE_PROMPT =
  process.env.AI_RESPONSE_STYLE_PROMPT ||
  "Give the final answer only. Keep replies concise: 1 to 4 short sentences unless the user asks for details.";

function createMessage(role, content, extras = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

function ensureConversationId(conversationId) {
  return conversationId || `conv-${crypto.randomUUID()}`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  if (AI_HISTORY_LIMIT === 0) return [];

  return history
    .filter(
      (entry) =>
        entry && typeof entry.content === "string" && entry.content.trim(),
    )
    .slice(-AI_HISTORY_LIMIT)
    .map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.content.trim(),
    }));
}

function isToolQuestion(message) {
  const text = message.toLowerCase();

  return (
    text.includes("parking") ||
    text.includes("slot") ||
    text.includes("ပါကင်") ||
    text.includes("ကားရပ်") ||
    text.includes("room") ||
    text.includes("အခန်း")
  );
}

function shouldEnableTools(message) {
  return process.env.AI_ENABLE_TOOLS === "true" && isToolQuestion(message);
}

function isEmergencyMessage(message) {
  const text = message.toLowerCase().trim();
  const compact = text.replace(/[!?.\s]+/g, " ").trim();

  return (
    compact === "sos" ||
    compact === "emergency" ||
    compact === "help" ||
    text.includes("အရေးပေါ်") ||
    text.includes("ကယ်ပါ")
  );
}

function buildEmergencyResponse() {
  return (
    "SOS request ကိုတွေ့ပါတယ်။ အရေးပေါ်အန္တရာယ်ရှိနေရင် " +
    "လုံခြုံရေး/management ကို ချက်ချင်းဖုန်းဆက်ပါ၊ လိုအပ်ရင် ဒေသဆိုင်ရာ emergency service ကို ဆက်သွယ်ပါ။ " +
    "ဒီ chat က alert ပို့ပြီးသားလို့ မယူဆပါနဲ့။ App ထဲမှာ SOS action ရှိရင် အဲ့ဒါကိုလည်း ချက်ချင်းနှိပ်ပါ။"
  );
}

function formatDate(value) {
  if (!value) return "မသတ်မှတ်ထားပါ";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "မသတ်မှတ်ထားပါ";

  return date.toISOString().slice(0, 10);
}

function buildToolAssistantContent(toolName, result) {
  if (toolName === "getParkingStatus") {
    return (
      `Visitor parking slot ${result.visitor.availableSlot} ခုကျန်ပါတယ်။ ` +
      `Resident parking slot ${result.resident.availableSlot} ခုကျန်ပါတယ်။`
    );
  }

  if (toolName === "getMyRoom") {
    if (!result.found) {
      return `သင့် room information မတွေ့သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
    }

    return (
      `သင့်အခန်းက ${result.roomNumber} ဖြစ်ပါတယ်။ ` +
      `Floor ${result.floor}, type ${result.roomType}, status ${result.status} ဖြစ်ပါတယ်။`
    );
  }

  if (toolName === "getMyBills") {
    if (!result.found) {
      return `သင့် bill data မတွေ့သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
    }

    if (!result.bills.length) {
      return `အခန်း ${result.roomNumber} အတွက် recent bill မတွေ့ပါ။`;
    }

    const latest = result.bills[0];
    return (
      `အခန်း ${result.roomNumber} အတွက် မပေးရသေးတဲ့စုစုပေါင်း ${result.totalOutstanding} ဖြစ်ပါတယ်။ ` +
      `နောက်ဆုံး bill က ${latest.amount} (${latest.status}), due date ${formatDate(latest.dueDate)} ပါ။`
    );
  }

  if (toolName === "getMyVisitors") {
    if (!result.found) {
      return `သင့် visitor data မတွေ့သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
    }

    if (!result.visitors.length) {
      return `အခန်း ${result.roomNumber} အတွက် recent visitor မတွေ့ပါ။`;
    }

    const latest = result.visitors[0];
    return (
      `အခန်း ${result.roomNumber} အတွက် recent visitor ${result.visitors.length} ယောက်တွေ့ပါတယ်။ ` +
      `နောက်ဆုံး visitor က ${latest.name || "အမည်မရှိ"} (${latest.purpose || "General"}), badge ${latest.badgeNumber || "မရှိ"} ပါ။`
    );
  }

  if (toolName === "createMaintenanceRequest") {
    if (result.created) {
      return (
        `Maintenance request တင်ပြီးပါပြီ။ ` +
        `Room ${result.roomNumber}, status ${result.status}, request ID ${result.reportId} ဖြစ်ပါတယ်။`
      );
    }

    if (result.needsFollowUp) {
      return `Maintenance request တင်ဖို့ ပြဿနာအသေးစိတ်ပြောပါ။ ဥပမာ ရေပိုက်ယိုတာ၊ မီးမလာတာ၊ တံခါးပျက်တာလို detail လိုပါတယ်။`;
    }

    return `Maintenance request မတင်နိုင်သေးပါ။ ${result.message || "Login/room link ကိုစစ်ပါ။"}`;
  }

  return "Tool result ရရှိပါတယ်။";
}

async function callOllama(messages, { toolsEnabled = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const body = {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      think: OLLAMA_THINK,
      options: {
        num_ctx: OLLAMA_NUM_CTX,
        num_predict: OLLAMA_NUM_PREDICT,
        temperature: OLLAMA_TEMPERATURE,
      },
    };

    if (toolsEnabled) {
      body.tools = getToolSchemas();
    }

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = data.error || data.message || res.statusText;
      throw new Error(`Ollama request failed (${res.status}): ${detail}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function manualToolContext(message, user) {
  const text = message.toLowerCase();

  if (
    text.includes("parking") ||
    text.includes("slot") ||
    text.includes("ပါကင်") ||
    text.includes("ကားရပ်")
  ) {
    const result = await runTool("getParkingStatus", {}, user);
    return {
      toolName: "getParkingStatus",
      result,
    };
  }

  if (text.includes("room") || text.includes("အခန်း")) {
    const result = await runTool("getMyRoom", {}, user);
    return {
      toolName: "getMyRoom",
      result,
    };
  }

  return null;
}

async function chat({
  message,
  conversationId,
  history = [],
  user = null,
  enableRag = true,
  audienceHint = null,
}) {
  const trimmed = message.trim();
  const resolvedConversationId = ensureConversationId(conversationId);
  const userMessage = createMessage("user", trimmed);

  let toolCalls = [];
  let knowledgeSources = [];
  let usedFallback = false;
  let assistantContent = "";
  const intent = classifyIntent(trimmed);

  if (intent.name === "emergency" || isEmergencyMessage(trimmed)) {
    assistantContent = buildEmergencyResponse();

    const assistantMessage = createMessage("assistant", assistantContent, {
      toolCalls,
      knowledgeSources,
      intent,
    });

    return {
      conversationId: resolvedConversationId,
      userMessage,
      assistantMessage,
      toolCalls,
      knowledgeSources,
      model: OLLAMA_MODEL,
      usedFallback,
      intent,
    };
  }

  try {
    if (isToolIntent(intent)) {
      const toolResult = await runTool(intent.toolName, intent.args || {}, user);

      toolCalls = [
        {
          function: {
            name: intent.toolName,
            arguments: intent.args || {},
          },
        },
      ];
      assistantContent = buildToolAssistantContent(intent.toolName, toolResult);

      const assistantMessage = createMessage("assistant", assistantContent, {
        toolCalls,
        knowledgeSources,
        intent,
      });

      return {
        conversationId: resolvedConversationId,
        userMessage,
        assistantMessage,
        toolCalls,
        knowledgeSources,
        model: OLLAMA_MODEL,
        usedFallback,
        intent,
      };
    }

    const [toolContext, ragDocs] = await Promise.all([
      manualToolContext(trimmed, user),
      enableRag
        ? retrieveKnowledge(trimmed, user, { audienceHint }).catch((err) => {
            console.warn("[ai.service] RAG retrieval failed:", err.message);
            return [];
          })
        : Promise.resolve([]),
    ]);
    const ragContext = buildRagContext(ragDocs);

    knowledgeSources = ragDocs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      audience: doc.audience,
    }));

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: RESPONSE_STYLE_PROMPT },
      {
        role: "system",
        content: `Detected intent: ${intent.name}. Confidence: ${intent.confidence}.`,
      },
    ];

    if (ragContext) {
      baseMessages.push({
        role: "system",
        content:
          "Use the following knowledge base context when it helps answer the user. " +
          "Prefer this context over general knowledge. If neither the knowledge base nor backend tool data answers the question, say the information is not available.\n\n" +
          ragContext,
      });
    }

    baseMessages.push(...normalizeHistory(history));

    if (toolContext) {
      toolCalls = [
        {
          function: {
            name: toolContext.toolName,
            arguments: {},
          },
        },
      ];

      baseMessages.push({
        role: "user",
        content:
          `Backend tool result:\n${JSON.stringify(toolContext, null, 2)}\n\n` +
          `User question: ${trimmed}`,
      });
    } else {
      baseMessages.push({
        role: "user",
        content: trimmed,
      });
    }

    const toolsEnabled = shouldEnableTools(trimmed);

    const response = await callOllama(baseMessages, { toolsEnabled });

    assistantContent = response.message?.content?.trim();

    if (!assistantContent) {
      throw new Error("Ollama returned empty response");
    }
  } catch (err) {
    console.warn("[ai.service] Ollama unavailable:", err.message);
    usedFallback = true;
    assistantContent =
      "AI model response မရသေးပါ။ Backend/Ollama connection ကိုစစ်ပါ။ " +
      "Real-time DB tool မေးခွန်းတွေကိုတော့ available ဖြစ်သလောက် ဆက်ဖြေပေးနိုင်ပါတယ်။";
  }

  const assistantMessage = createMessage("assistant", assistantContent, {
    toolCalls,
    knowledgeSources,
    intent,
  });

  return {
    conversationId: resolvedConversationId,
    userMessage,
    assistantMessage,
    toolCalls,
    knowledgeSources,
    model: OLLAMA_MODEL,
    usedFallback,
    intent,
  };
}

module.exports = {
  chat,
  createMessage,
  SYSTEM_PROMPT,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  OLLAMA_NUM_CTX,
  OLLAMA_NUM_PREDICT,
  OLLAMA_TEMPERATURE,
  OLLAMA_THINK,
  AI_HISTORY_LIMIT,
};
