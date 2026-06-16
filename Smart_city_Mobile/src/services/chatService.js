import { API_BASE_URL } from '../config/api';
// import { apiRequest } from '../api/client'; // uncomment when wiring backend

/**
 * AI Chat service — placeholder layer for RAG + MCP backend integration.
 *
 * Wire up your Node backend here. Expected endpoints (adjust paths as needed):
 *   POST /chat/messages     — send user message, receive assistant reply (RAG context)
 *   GET  /chat/history      — load prior messages for a conversation
 *   POST /chat/tools/invoke — optional: direct MCP tool invocation
 */

const MOCK_DELAY_MS = 900;

let conversationId = null;

function createMessage(role, content, extras = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

/**
 * BACKEND HOOK — replace mock body with real fetch/axios call.
 *
 * Example (fetch):
 *   const data = await apiRequest('/chat/messages', {
 *     method: 'POST',
 *     auth: true,
 *     body: {
 *       conversationId,
 *       message: text,
 *       enableMcpTools: true,   // allow assistant to call MCP tools
 *       ragContext: 'resident', // optional scope for retrieval
 *     },
 *   });
 *   return {
 *     userMessage: data.userMessage,
 *     assistantMessage: data.assistantMessage,
 *     conversationId: data.conversationId,
 *     toolCalls: data.toolCalls ?? [],
 *   };
 */
export async function sendMessage(text, options = {}) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Message cannot be empty');
  }

  console.log('[chatService] sendMessage:', trimmed, options);

  // --- MOCK: remove this block when backend is ready ---
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  const userMessage = createMessage('user', trimmed);
  const assistantMessage = createMessage(
    'assistant',
    `Thanks for your message. I can help with bills, visitors, parking, and community info once connected to the RAG + MCP backend.\n\nYou asked: "${trimmed}"`,
    { toolCalls: [] },
  );

  if (!conversationId) {
    conversationId = `conv-${Date.now()}`;
  }

  return {
    userMessage,
    assistantMessage,
    conversationId,
    toolCalls: [],
  };
  // --- END MOCK ---

  /*
  const data = await apiRequest('/chat/messages', {
    method: 'POST',
    auth: true,
    body: {
      conversationId,
      message: trimmed,
      enableMcpTools: options.enableMcpTools ?? true,
      ragContext: options.ragContext ?? 'resident',
    },
  });

  if (data.conversationId) {
    conversationId = data.conversationId;
  }

  return {
    userMessage: data.userMessage,
    assistantMessage: data.assistantMessage,
    conversationId: data.conversationId,
    toolCalls: data.toolCalls ?? [],
  };
  */
}

/**
 * BACKEND HOOK — stream or poll for incremental assistant tokens (optional).
 * Useful for SSE / WebSocket streaming from your RAG pipeline.
 */
export async function receiveMessage(/* payload */) {
  console.log('[chatService] receiveMessage — hook for streaming/push replies');

  /*
  const res = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return res;
  */

  return null;
}

/**
 * BACKEND HOOK — load conversation history on sheet open.
 */
export async function loadChatHistory(id = conversationId) {
  console.log('[chatService] loadChatHistory:', id);

  /*
  if (!id) return [];
  const data = await apiRequest(`/chat/history?conversationId=${id}`, { auth: true });
  return data.messages ?? [];
  */

  return [];
}

/**
 * BACKEND HOOK — invoke an MCP tool directly from the client (if exposed).
 */
export async function invokeMcpTool(toolName, args = {}) {
  console.log('[chatService] invokeMcpTool:', toolName, args);

  /*
  return apiRequest('/chat/tools/invoke', {
    method: 'POST',
    auth: true,
    body: { toolName, args, conversationId },
  });
  */

  return { toolName, result: null, mocked: true };
}

export function getConversationId() {
  return conversationId;
}

export function resetConversation() {
  conversationId = null;
}

export { createMessage, API_BASE_URL };
