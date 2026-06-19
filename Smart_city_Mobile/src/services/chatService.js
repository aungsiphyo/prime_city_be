import { API_BASE_URL } from '../config/api';
import { apiRequest } from '../api/client';

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

  const data = await apiRequest('/ai/chat', {
    method: 'POST',
    auth: true,
    body: {
      conversationId: options.conversationId ?? conversationId,
      message: trimmed,
      history: options.history ?? [],
      enableMcpTools: options.enableMcpTools ?? true,
      enableRag: options.enableRag ?? true,
      ragContext: options.ragContext ?? 'resident',
    },
  });

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
  const knowledgeSources =
    data.knowledgeSources ??
    data.meta?.knowledgeSources ??
    assistantMessage.knowledgeSources ??
    [];
  const intent = data.meta?.intent ?? assistantMessage.intent ?? null;

  return {
    userMessage,
    assistantMessage,
    conversationId: nextConversationId,
    toolCalls: data.toolCalls ?? assistantMessage.toolCalls ?? [],
    knowledgeSources,
    intent,
  };
}

export async function receiveMessage() {
  return null;
}

export async function loadChatHistory() {
  try {
    const data = await apiRequest('/ai/history', {
      method: 'GET',
      auth: true,
    });

    return Array.isArray(data.messages) ? data.messages : [];
  } catch (err) {
    if (err.status === 401) return [];

    throw err;
  }
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
