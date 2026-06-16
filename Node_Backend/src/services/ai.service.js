const crypto = require("crypto");
const { getToolSchemas } = require("./toolRegistry");
const { runTool } = require("./aiTools.service");

const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://localhost:11434"
).replace(/\/+$/, "");

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:12b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60000);

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  `
You are SmartRes AI, a helpful assistant for a smart residential community.

Rules:
- Reply in Myanmar language unless the user uses English.
- You can help with parking, rooms, bills, visitors, SOS, announcements, and community services.
- Never expose private data.
- Use tools when database data is needed.
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

async function callOllama(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        tools: getToolSchemas(),
        stream: false,
      }),
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

async function chat({ message, conversationId, history = [], user = null }) {
  const trimmed = message.trim();
  const resolvedConversationId = ensureConversationId(conversationId);

  const userMessage = createMessage("user", trimmed);

  const baseMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...normalizeHistory(history),
    { role: "user", content: trimmed },
  ];

  let assistantContent = "";
  let toolCalls = [];
  let usedFallback = false;

  try {
    const firstResponse = await callOllama(baseMessages);

    toolCalls = firstResponse.message?.tool_calls || [];

    if (toolCalls.length > 0) {
      const toolMessages = [];

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name;
        const toolArgs = toolCall.function?.arguments || {};

        const result = await runTool(toolName, toolArgs, user);

        toolMessages.push({
          role: "tool",
          content: JSON.stringify({
            toolName,
            result,
          }),
        });
      }

      const secondResponse = await callOllama([
        ...baseMessages,
        firstResponse.message,
        ...toolMessages,
      ]);

      assistantContent =
        secondResponse.message?.content?.trim() ||
        "Tool result ရခဲ့ပါတယ်၊ ဒါပေမယ့် AI response မရပါ။";
    } else {
      assistantContent = firstResponse.message?.content?.trim();
    }

    if (!assistantContent) {
      throw new Error("Ollama returned empty response");
    }
  } catch (err) {
    console.warn("[ai.service] Ollama unavailable:", err.message);
    usedFallback = true;
    assistantContent = `[Fallback] AI model response မရသေးပါ။ Backend/Ollama connection ကိုစစ်ပါ။\n\nYour message: ${trimmed}`;
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
