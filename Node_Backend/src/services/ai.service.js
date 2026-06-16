const crypto = require("crypto");
const { getToolSchemas } = require("./toolRegistry");
const { runTool } = require("./aiTools.service");

const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://localhost:11434"
).replace(/\/+$/, "");

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:12b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  `
You are SmartRes AI, a helpful assistant for a smart residential community.

Rules:
- Reply in Myanmar language unless the user uses English.
- You can help with parking, rooms, bills, visitors, SOS, announcements, and community services.
- Never expose private data.
- Use database/tool data only when provided.
- If data is missing, say you cannot find it.
`;

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

  return history
    .filter(
      (entry) =>
        entry && typeof entry.content === "string" && entry.content.trim(),
    )
    .slice(-20)
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

async function callOllama(messages, { toolsEnabled = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const body = {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
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

async function chat({ message, conversationId, history = [], user = null }) {
  const trimmed = message.trim();
  const resolvedConversationId = ensureConversationId(conversationId);
  const userMessage = createMessage("user", trimmed);

  let toolCalls = [];
  let usedFallback = false;
  let assistantContent = "";

  try {
    const toolContext = await manualToolContext(trimmed, user);

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...normalizeHistory(history),
    ];

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
      `[Fallback] AI model response မရသေးပါ။ Backend/Ollama connection ကိုစစ်ပါ။\n\n` +
      `Error: ${err.message}\n\n` +
      `Your message: ${trimmed}`;
  }

  const assistantMessage = createMessage("assistant", assistantContent, {
    toolCalls,
  });

  return {
    conversationId: resolvedConversationId,
    userMessage,
    assistantMessage,
    toolCalls,
    model: OLLAMA_MODEL,
    usedFallback,
  };
}

module.exports = {
  chat,
  createMessage,
  SYSTEM_PROMPT,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
};
