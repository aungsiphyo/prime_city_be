import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import useVoiceAssistant from '../hooks/useVoiceAssistant';
import {
  sendFeedback as sendChatFeedback,
  sendMessage as sendAIMessage,
} from '../services/chatService';

const CHAT_BOB_DISTANCE = 8;
const CHAT_BOB_DURATION = 1800;
const THINKING_DOTS = [0, 1, 2];

function ThinkingIndicator({ theme }) {
  const dotAnims = useRef(
    THINKING_DOTS.map(() => new Animated.Value(0.35)),
  ).current;

  useEffect(() => {
    const dotLoops = dotAnims.map((anim, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(anim, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.35,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    dotLoops.forEach(loop => loop.start());

    return () => {
      dotLoops.forEach(loop => loop.stop());
    };
  }, [dotAnims]);

  return (
    <View style={[styles.messageRow, styles.thinkingRow]}>
      <View
        style={[
          styles.thinkingBubble,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <ActivityIndicator size="small" color={theme.primary} />
        <Text style={[styles.thinkingText, { color: theme.subtext }]}>အဖြေရှာနေပါတယ်</Text>
        <View style={styles.thinkingDots}>
          {dotAnims.map((anim, index) => (
            <Animated.View
              key={THINKING_DOTS[index]}
              style={[
                styles.thinkingDot,
                {
                  backgroundColor: theme.primary,
                  opacity: anim,
                  transform: [
                    {
                      scale: anim.interpolate({
                        inputRange: [0.35, 1],
                        outputRange: [0.72, 1],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function HistoryDrawer({
  theme,
  sessions,
  activeSessionId,
  onClose,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}) {
  return (
    <View style={styles.historyLayer}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={styles.historyScrim}
      />

      <View
        style={[
          styles.historyPanel,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.historyHeader}>
          <Text style={[styles.historyTitle, { color: theme.text }]}>Chat history</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.historyClose}
          >
            <Ionicons name="close" size={20} color={theme.subtext} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={onNewChat}
          activeOpacity={0.82}
          style={[
            styles.newChatButton,
            { backgroundColor: theme.primaryBg, borderColor: theme.primary },
          ]}
        >
          <Ionicons name="create-outline" size={17} color={theme.primary} />
          <Text style={[styles.newChatText, { color: theme.primary }]}>New chat</Text>
        </TouchableOpacity>

        <FlatList
          data={sessions}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.historyList}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isActive = item.id === activeSessionId;
            const lastMessage = item.messages[item.messages.length - 1];
            const preview = lastMessage?.text || 'No messages yet';

            return (
              <TouchableOpacity
                onPress={() => onSelectSession(item.id)}
                activeOpacity={0.84}
                style={[
                  styles.historyItem,
                  {
                    backgroundColor: isActive ? theme.primaryBg : 'transparent',
                    borderColor: isActive ? theme.primary : theme.border,
                  },
                ]}
              >
                <View style={styles.historyItemTextWrap}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.historyItemTitle,
                      { color: isActive ? theme.primary : theme.text },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.historyItemPreview, { color: theme.subtext }]}
                  >
                    {preview}
                  </Text>
                </View>

                {sessions.length > 1 && (
                  <TouchableOpacity
                    onPress={() => onDeleteSession(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.historyDelete}
                  >
                    <Ionicons name="trash-outline" size={16} color={theme.subtext} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </View>
  );
}

export default function FloatingChat() {
  const {
    isOpen,
    close,
    toggle,
    sessions,
    activeSession,
    activeSessionId,
    messages,
    sendMessage,
    updateMessage,
    setActiveConversationId,
    newChat,
    selectSession,
    deleteSession,
  } = useChat();
  const { theme } = useTheme();
  const { user } = useAuth();
  const userName = (user?.fullname || user?.name || '').trim();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedbackSendingById, setFeedbackSendingById] = useState({});
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const bobAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const voiceReplyEnabledRef = useRef(false);
  const {
    listening,
    voiceAvailable,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  } = useVoiceAssistant({
    onSpeechText: spokenText => {
      voiceReplyEnabledRef.current = true;
      setText(spokenText);
    },
  });

  useEffect(() => {
    if (!isOpen) setHistoryOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;

    stopSpeaking();
    if (listening) stopListening();
  }, [isOpen, listening, stopListening, stopSpeaking]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        try {
          inputRef.current.focus();
        } catch (e) {}
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [isOpen, messages.length, sending]);

  useEffect(() => {
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bobAnim, {
          toValue: 1,
          duration: CHAT_BOB_DURATION,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bobAnim, {
          toValue: 0,
          duration: CHAT_BOB_DURATION,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: CHAT_BOB_DURATION,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: CHAT_BOB_DURATION,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );

    bobLoop.start();
    glowLoop.start();

    return () => {
      bobLoop.stop();
      glowLoop.stop();
    };
  }, [bobAnim, glowAnim]);

  const translateY = bobAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -CHAT_BOB_DISTANCE],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.42],
  });

  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.04],
  });
  const micUnavailable = voiceAvailable === false;
  const micIconName = listening
    ? 'mic'
    : micUnavailable
      ? 'mic-off-outline'
      : 'mic-outline';
  const micAccessibilityLabel = listening
    ? 'Stop voice input'
    : micUnavailable
      ? 'Voice input unavailable'
      : 'Start voice input';
  const micAccessibilityHint = micUnavailable
    ? 'Speech recognition is unavailable on this emulator or device'
    : 'Uses speech recognition to fill the message box';

  async function handleSend() {
    const userText = text.trim();
    const targetSessionId = activeSessionId;

    if (!userText || sending || !targetSessionId) return;

    const shouldSpeakReply = voiceReplyEnabledRef.current;
    voiceReplyEnabledRef.current = false;
    setText('');
    setSending(true);

    sendMessage(userText, 'user', { sessionId: targetSessionId });

    try {
      const recentHistory = messages.slice(-8).map(item => ({
        role: item.from === 'bot' ? 'assistant' : 'user',
        content: item.text,
      }));
      const result = await sendAIMessage(userText, {
        conversationId: activeSession?.conversationId,
        syncGlobalConversationId: false,
        enableMcpTools: true,
        ragContext: 'resident',
        history: recentHistory,
      });

      if (result?.conversationId) {
        setActiveConversationId(result.conversationId, {
          sessionId: targetSessionId,
        });
      }

      const assistantText =
        result?.assistantMessage?.content ||
        result?.assistantMessage?.text ||
        'AI response မရပါ။';
      const nextConversationId =
        result?.conversationId || activeSession?.conversationId || null;

      sendMessage(assistantText, 'bot', {
        sessionId: targetSessionId,
        metadata: {
          assistantMessageId: result?.assistantMessage?.id ?? null,
          conversationId: nextConversationId,
          feedbackRating: null,
          knowledgeSources:
            result?.knowledgeSources ||
            result?.assistantMessage?.knowledgeSources ||
            [],
          toolCalls: result?.toolCalls || result?.assistantMessage?.toolCalls || [],
          intent: result?.intent || result?.assistantMessage?.intent || null,
        },
      });

      if (shouldSpeakReply) {
        speak(assistantText);
      }
    } catch (err) {
      sendMessage(
        err.message || 'AI assistant ချိတ်ဆက်မရပါ။ Backend/Ollama ကိုစစ်ပါ။',
        'bot',
        { sessionId: targetSessionId },
      );
    } finally {
      setSending(false);
    }
  }

  async function handleFeedback(item, rating) {
    const messageId = item.assistantMessageId;
    const conversationId = item.conversationId || activeSession?.conversationId;

    if (
      !messageId ||
      !conversationId ||
      feedbackSendingById[item.id] ||
      item.feedbackRating === rating
    ) {
      return;
    }

    const previousRating = item.feedbackRating ?? null;

    setFeedbackSendingById(previous => ({ ...previous, [item.id]: true }));
    updateMessage(
      item.id,
      {
        feedbackRating: rating,
        feedbackError: null,
      },
      { sessionId: activeSessionId },
    );

    try {
      await sendChatFeedback({
        conversationId,
        messageId,
        rating,
        helpful: rating > 0,
      });
    } catch (err) {
      updateMessage(
        item.id,
        {
          feedbackRating: previousRating,
          feedbackError: err.message || 'Feedback မသိမ်းနိုင်သေးပါ။',
        },
        { sessionId: activeSessionId },
      );
    } finally {
      setFeedbackSendingById(previous => {
        const next = { ...previous };
        delete next[item.id];
        return next;
      });
    }
  }

  function handleClose() {
    setHistoryOpen(false);
    if (listening) stopListening();
    stopSpeaking();
    close();
  }

  function handleMicPress() {
    if (sending) return;

    if (listening) {
      stopListening();
      return;
    }

    startListening();
  }

  function handleNewChat() {
    newChat();
    setText('');
    setHistoryOpen(false);
  }

  function handleSelectSession(sessionId) {
    selectSession(sessionId);
    setHistoryOpen(false);
  }

  function handleDeleteSession(sessionId) {
    deleteSession(sessionId);
  }

  return (
    <>
      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.chatBox, { backgroundColor: theme.surface }]}>
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => setHistoryOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.menuButton}
              >
                <Ionicons name="menu" size={24} color={theme.subtext} />
              </TouchableOpacity>

              <View style={styles.headerTitleWrap}>
                <Text style={[styles.headerText, { color: theme.text }]}>
                  SmartRes AI
                </Text>
                {userName ? (
                  <Text style={[styles.headerSubText, { color: theme.subtext }]}>
                    မင်္ဂလာပါ, {userName.split(' ')[0]} 👋
                  </Text>
                ) : null}
              </View>

              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Text style={{ color: theme.subtext }}>✕</Text>
              </TouchableOpacity>
            </View>

            {historyOpen && (
              <HistoryDrawer
                theme={theme}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onClose={() => setHistoryOpen(false)}
                onNewChat={handleNewChat}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
              />
            )}

            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={i => i.id}
              style={styles.messages}
              keyboardShouldPersistTaps="handled"
              ListFooterComponent={
                sending ? <ThinkingIndicator theme={theme} /> : null
              }
              ListEmptyComponent={
                !sending ? (
                  <View style={styles.emptyState}>
                    <View style={[styles.emptyIconWrap, { backgroundColor: theme.primaryBg }]}>
                      <Ionicons name="sparkles" size={28} color={theme.primary} />
                    </View>
                    <Text style={[styles.emptyGreeting, { color: theme.text }]}>
                      {userName
                        ? `မင်္ဂလာပါ ${userName.split(' ')[0]} 👋\nဘာကူညီပေးရမလဲ?`
                        : 'မင်္ဂလာပါ 👋\nဘာကူညီပေးရမလဲ?'}
                    </Text>
                    <Text style={[styles.emptyHint, { color: theme.subtext }]}>
                      Bills, helpers, visitors, parking, announcements — I've got you.
                    </Text>
                    <View style={styles.quickChips}>
                      {[
                        'ပါကင် status ဘယ်လောက်ကျန်လဲ?',
                        'ကျွန်တော့် bill ဘယ်လောက်ကျန်လဲ?',
                        'ကျွန်တော့် အခန်း ဘာသတင်းရှိလဲ?',
                      ].map(chip => (
                        <TouchableOpacity
                          key={chip}
                          onPress={() => setText(chip)}
                          style={[styles.quickChip, { backgroundColor: theme.primaryBg, borderColor: theme.primary }]}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.quickChipText, { color: theme.primary }]}>{chip}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null
              }
              onContentSizeChange={() => {
                listRef.current?.scrollToEnd({ animated: true });
              }}
              renderItem={({ item }) => {
                const isUser = item.from === 'user';
                const canSendFeedback =
                  !isUser && item.assistantMessageId && item.conversationId;
                const feedbackBusy = Boolean(feedbackSendingById[item.id]);
                const sourceTitles = Array.isArray(item.knowledgeSources)
                  ? item.knowledgeSources
                      .map(source => source?.title)
                      .filter(Boolean)
                      .slice(0, 2)
                  : [];

                return (
                  <View
                    style={[
                      styles.messageRow,
                      isUser ? styles.userMsg : styles.botMsg,
                    ]}
                  >
                    <Text
                      style={{
                        color: isUser ? '#fff' : theme.text,
                      }}
                    >
                      {item.text}
                    </Text>

                    {!isUser && sourceTitles.length > 0 && (
                      <Text style={[styles.messageMeta, { color: theme.subtext }]}>
                        Knowledge: {sourceTitles.join(', ')}
                      </Text>
                    )}

                    {!isUser && item.toolCalls?.length > 0 && (
                      <Text style={[styles.messageMeta, { color: theme.subtext }]}>
                        Tools: {item.toolCalls.length}
                      </Text>
                    )}

                    {canSendFeedback && (
                      <View style={styles.feedbackRow}>
                        <TouchableOpacity
                          onPress={() => handleFeedback(item, 1)}
                          disabled={feedbackBusy}
                          accessibilityLabel="Mark answer helpful"
                          style={[
                            styles.feedbackButton,
                            {
                              backgroundColor:
                                item.feedbackRating === 1
                                  ? theme.primaryBg
                                  : theme.input,
                              borderColor:
                                item.feedbackRating === 1
                                  ? theme.primary
                                  : theme.border,
                            },
                            feedbackBusy && styles.feedbackButtonDisabled,
                          ]}
                        >
                          <Ionicons
                            name={
                              item.feedbackRating === 1
                                ? 'thumbs-up'
                                : 'thumbs-up-outline'
                            }
                            size={15}
                            color={
                              item.feedbackRating === 1
                                ? theme.primary
                                : theme.subtext
                            }
                          />
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => handleFeedback(item, -1)}
                          disabled={feedbackBusy}
                          accessibilityLabel="Mark answer not helpful"
                          style={[
                            styles.feedbackButton,
                            {
                              backgroundColor:
                                item.feedbackRating === -1
                                  ? theme.dangerBg
                                  : theme.input,
                              borderColor:
                                item.feedbackRating === -1
                                  ? theme.danger
                                  : theme.border,
                            },
                            feedbackBusy && styles.feedbackButtonDisabled,
                          ]}
                        >
                          <Ionicons
                            name={
                              item.feedbackRating === -1
                                ? 'thumbs-down'
                                : 'thumbs-down-outline'
                            }
                            size={15}
                            color={
                              item.feedbackRating === -1
                                ? theme.danger
                                : theme.subtext
                            }
                          />
                        </TouchableOpacity>

                        {feedbackBusy && (
                          <ActivityIndicator size="small" color={theme.primary} />
                        )}
                      </View>
                    )}

                    {!isUser && item.feedbackError && (
                      <Text style={[styles.messageMeta, { color: theme.danger }]}>
                        {item.feedbackError}
                      </Text>
                    )}
                  </View>
                );
              }}
            />

            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={nextText => {
                  voiceReplyEnabledRef.current = false;
                  setText(nextText);
                }}
                placeholder={listening ? 'Listening...' : 'Type a message'}
                placeholderTextColor={theme.subtext}
                style={[
                  styles.input,
                  { backgroundColor: theme.input, color: theme.text },
                ]}
                autoCapitalize="none"
                autoCorrect={false}
                blurOnSubmit={false}
                keyboardType="default"
                multiline
                returnKeyType="default"
                textAlignVertical="center"
              />

              <TouchableOpacity
                onPress={handleMicPress}
                disabled={sending}
                accessibilityLabel={micAccessibilityLabel}
                accessibilityHint={micAccessibilityHint}
                style={[
                  styles.micButton,
                  {
                    backgroundColor: listening ? theme.primary : theme.border,
                    opacity: sending || micUnavailable ? 0.65 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={micIconName}
                  size={19}
                  color={listening ? theme.primaryText : theme.text}
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSend}
                disabled={sending || !text.trim()}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor:
                      sending || !text.trim() ? theme.border : theme.primary,
                  },
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={theme.primaryText} />
                ) : (
                  <Ionicons name="send" size={18} color={theme.primaryText} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <View pointerEvents="box-none" style={styles.container}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          <Animated.View
            style={[
              styles.glow,
              {
                backgroundColor: theme.primary,
                opacity: glowOpacity,
                transform: [{ scale: glowScale }],
              },
            ]}
          />

          <TouchableOpacity
            accessibilityLabel="Open chat"
            accessibilityHint="Opens assistant chat"
            onPress={toggle}
            activeOpacity={0.86}
            style={[
              styles.fab,
              {
                backgroundColor: theme.primary,
                shadowColor: theme.primary,
              },
            ]}
          >
            <Text style={styles.fabText}>💬</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 98 : 84,
    zIndex: 9999,
  },
  glow: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.3,
    shadowRadius: 9,
    elevation: 8,
  },
  fabText: {
    fontSize: 24,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  chatBox: {
    height: '55%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  menuButton: {
    position: 'absolute',
    left: 12,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 12,
  },
  historyLayer: {
    position: 'absolute',
    top: 52,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
  },
  historyScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  historyPanel: {
    width: 270,
    height: '100%',
    borderRightWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
  },
  historyHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  historyClose: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChatButton: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  newChatText: {
    fontSize: 14,
    fontWeight: '700',
  },
  historyList: {
    paddingBottom: 10,
  },
  historyItem: {
    minHeight: 60,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  historyItemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  historyItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  historyItemPreview: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
  },
  historyDelete: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  messages: {
    flex: 1,
    padding: 12,
  },
  messageRow: {
    marginVertical: 6,
    padding: 10,
    borderRadius: 8,
    maxWidth: '85%',
  },
  thinkingRow: {
    alignSelf: 'flex-start',
  },
  thinkingBubble: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thinkingText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  thinkingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  thinkingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  userMsg: {
    alignSelf: 'flex-end',
    backgroundColor: '#0B84FF',
  },
  botMsg: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  messageMeta: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 16,
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  feedbackButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackButtonDisabled: {
    opacity: 0.65,
  },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    minHeight: 44,
    maxHeight: 96,
    fontSize: 16,
    lineHeight: 24,
    includeFontPadding: true,
  },
  micButton: {
    marginLeft: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    marginLeft: 8,
    width: 52,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    alignItems: 'center',
    flex: 1,
  },
  headerSubText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
    opacity: 0.85,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyGreeting: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  quickChips: {
    width: '100%',
    gap: 8,
  },
  quickChip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
