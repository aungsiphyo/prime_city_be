import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resetConversation, setConversationId } from '../services/chatService';

const ChatContext = createContext(null);
const CHAT_HISTORY_KEY = '@smart_city_mobile/chat_sessions_v1';

function createSession() {
  const now = new Date().toISOString();

  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New chat',
    messages: [],
    conversationId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildTitle(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (!normalized) return 'New chat';

  return normalized.length > 34 ? `${normalized.slice(0, 34)}...` : normalized;
}

function createLocalMessage(text, from, extras = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    from,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

export function ChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const activeSessionIdRef = useRef(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    let mounted = true;

    async function loadSessions() {
      try {
        const raw = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const savedSessions = Array.isArray(parsed?.sessions)
          ? parsed.sessions
          : [];

        if (!mounted) return;

        if (savedSessions.length > 0) {
          const nextActiveId =
            parsed.activeSessionId &&
            savedSessions.some(session => session.id === parsed.activeSessionId)
              ? parsed.activeSessionId
              : savedSessions[0].id;
          const activeSession = savedSessions.find(
            session => session.id === nextActiveId,
          );

          setSessions(savedSessions);
          setActiveSessionId(nextActiveId);
          setConversationId(activeSession?.conversationId ?? null);
        } else {
          const initialSession = createSession();
          setSessions([initialSession]);
          setActiveSessionId(initialSession.id);
          resetConversation();
        }
      } catch (err) {
        if (!mounted) return;

        const initialSession = createSession();
        setSessions([initialSession]);
        setActiveSessionId(initialSession.id);
        resetConversation();
      } finally {
        if (mounted) setHydrated(true);
      }
    }

    loadSessions();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    AsyncStorage.setItem(
      CHAT_HISTORY_KEY,
      JSON.stringify({ sessions, activeSessionId }),
    ).catch(() => {});
  }, [activeSessionId, hydrated, sessions]);

  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const messages = activeSession?.messages ?? [];

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(value => !value), []);

  const newChat = useCallback(() => {
    const session = createSession();

    setSessions(previous => [session, ...previous]);
    setActiveSessionId(session.id);
    resetConversation();

    return session;
  }, []);

  const selectSession = useCallback(
    sessionId => {
      const target = sessions.find(session => session.id === sessionId);

      if (!target) return;

      setActiveSessionId(sessionId);
      setConversationId(target.conversationId ?? null);
    },
    [sessions],
  );

  const deleteSession = useCallback(
    sessionId => {
      const remaining = sessions.filter(session => session.id !== sessionId);

      if (remaining.length === 0) {
        const session = createSession();
        setSessions([session]);
        setActiveSessionId(session.id);
        resetConversation();
        return;
      }

      setSessions(remaining);

      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0].id);
        setConversationId(remaining[0].conversationId ?? null);
      }
    },
    [activeSessionId, sessions],
  );

  const sendMessage = useCallback(
    (text, from = 'user', options = {}) => {
      const sessionId = options.sessionId ?? activeSessionId;
      const message = createLocalMessage(text, from, options.metadata ?? {});

      if (!sessionId) return message;

      setSessions(previous =>
        previous.map(session => {
          if (session.id !== sessionId) return session;

          const isFirstUserMessage =
            from === 'user' && !session.messages.some(item => item.from === 'user');

          return {
            ...session,
            title: isFirstUserMessage ? buildTitle(text) : session.title,
            messages: [...session.messages, message],
            updatedAt: message.createdAt,
          };
        }),
      );

      return message;
    },
    [activeSessionId],
  );

  const setActiveConversationId = useCallback(
    (conversationId, options = {}) => {
      const sessionId = options.sessionId ?? activeSessionId;

      if (!sessionId) return;

      if (sessionId === activeSessionIdRef.current) {
        setConversationId(conversationId ?? null);
      }

      setSessions(previous =>
        previous.map(session =>
          session.id === sessionId
            ? {
                ...session,
                conversationId: conversationId ?? null,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
    },
    [activeSessionId],
  );

  const clear = useCallback(() => {
    if (!activeSessionId) return;

    setSessions(previous =>
      previous.map(session =>
        session.id === activeSessionId
          ? {
              ...session,
              title: 'New chat',
              messages: [],
              conversationId: null,
              updatedAt: new Date().toISOString(),
            }
          : session,
      ),
    );
    resetConversation();
  }, [activeSessionId]);

  const value = {
    isOpen,
    open,
    close,
    toggle,
    sessions,
    activeSession,
    activeSessionId,
    messages,
    sendMessage,
    setActiveConversationId,
    newChat,
    selectSession,
    deleteSession,
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
