import React, { createContext, useContext, useState, useCallback } from 'react';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(v => !v), []);

  const sendMessage = useCallback((text, from = 'user') => {
    const msg = {
      id: Date.now().toString(),
      text,
      from,
      createdAt: new Date(),
    };
    setMessages(m => [...m, msg]);
    return msg;
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  const value = {
    isOpen,
    open,
    close,
    toggle,
    messages,
    sendMessage,
    clear,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

export default ChatProvider;
