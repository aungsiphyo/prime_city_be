const crypto = require("crypto");

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(
  /\/+$/,
  "",
);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60000);

const SYSTEM_PROMPT =
  process.env.AI_SYSTEM_PROMPT ||
  "You are SmartRes AI, a helpful assistant for residents of a smart residential community. " +
    "Answer clearly and concisely about bills, parking, visitors, announcements, and community services.";

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

function ensureConversationId(conversationId) {
  return conversationId || `conv-${crypto.randomUUID()}`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((entry) => entry && typeof entry.content === "string" && entry.content.trim())
    .slice(-20)
    .map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.content.trim(),
    }));
}

async function callOllamaChat(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = data.error || data.message || res.statusText;
      throw new Error(`Ollama request failed (${res.status}): ${detail}`);
    }

    const content = data.message?.content?.trim();
    if (!content) {
      throw new Error("Ollama returned an empty response");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackReply(message) {
  return (
    `[Phase 1 scaffold] I received your message: "${message}". ` +
    "Connect Ollama at OLLAMA_BASE_URL to get live completions."
  );
}

/**
 * Send a user message to the configured Ollama model and return structured chat messages.
 * Tool calling and RAG enrichment are added in later phases.
 */
async function chat({ message, conversationId, history = [] }) {
  const trimmed = message.trim();
  const resolvedConversationId = ensureConversationId(conversationId);
  const userMessage = createMessage("user", trimmed);

  const ollamaMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...normalizeHistory(history),
    { role: "user", content: trimmed },
  ];

  let assistantContent;

  try {
    assistantContent = await callOllamaChat(ollamaMessages);
  } catch (err) {
    console.warn("[ai.service] Ollama unavailable, using fallback:", err.message);
    assistantContent = buildFallbackReply(trimmed);
  }

  const assistantMessage = createMessage("assistant", assistantContent);

  return {
    conversationId: resolvedConversationId,
    userMessage,
    assistantMessage,
    toolCalls: [],
    model: OLLAMA_MODEL,
    usedFallback: assistantContent.startsWith("[Phase 1 scaffold]"),
  };
}

module.exports = {
  chat,
  createMessage,
  SYSTEM_PROMPT,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
};
