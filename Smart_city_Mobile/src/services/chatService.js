import { API_BASE_URL } from '../config/api';

let conversationId = null;
const FALLBACK_ERROR_MESSAGE =
  'AI assistant ချိတ်ဆက်မရသေးပါ။ Backend/Ollama connection ကိုစစ်ပါ။';

function createMessage(role, content, extras = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

function normalizeAssistantMessage(data) {
  if (data.assistantMessage) return data.assistantMessage;

  if (data.reply) {
    return createMessage('assistant', data.reply, {
      toolCalls: data.toolCalls ?? [],
    });
  }

  return createMessage('assistant', 'AI response မရပါ။', {
    isError: true,
  });
}

export async function sendMessage(text, options = {}) {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('Message cannot be empty');
  }

  const res = await fetch(`${API_BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversationId: options.conversationId ?? conversationId,
      message: trimmed,
      history: options.history ?? [],
      enableMcpTools: options.enableMcpTools ?? true,
      ragContext: options.ragContext ?? 'resident',
    }),
  });

  const data = await res.json();

  if (!res.ok || data.success === false) {
    throw new Error(data.message || 'AI request failed');
  }

  if (data.meta?.usedFallback) {
    throw new Error(FALLBACK_ERROR_MESSAGE);
  }

  if (data.conversationId && options.syncGlobalConversationId !== false) {
    conversationId = data.conversationId;
  }

  const userMessage = data.userMessage || createMessage('user', trimmed);
  const assistantMessage = normalizeAssistantMessage(data);
  const nextConversationId =
    data.conversationId ?? options.conversationId ?? conversationId;

  return {
    userMessage,
    assistantMessage,
    conversationId: nextConversationId,
    toolCalls: data.toolCalls ?? assistantMessage.toolCalls ?? [],
  };
}

export async function receiveMessage() {
  return null;
}

export async function loadChatHistory() {
  return [];
}

export async function invokeMcpTool(toolName, args = {}) {
  const res = await fetch(`${API_BASE_URL}/mcp/tools`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();

  return {
    toolName,
    args,
    tools: data.tools ?? [],
  };
}

export function getConversationId() {
  return conversationId;
}

export function setConversationId(nextConversationId) {
  conversationId = nextConversationId ?? null;
}

export function resetConversation() {
  conversationId = null;
}

export { createMessage, API_BASE_URL };
