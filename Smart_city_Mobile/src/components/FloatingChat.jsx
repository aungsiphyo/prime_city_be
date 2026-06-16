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
} from 'react-native';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { sendMessage as sendAIMessage } from '../services/chatService';

export default function FloatingChat() {
  const { isOpen, close, toggle, messages, sendMessage } = useChat();
  const { theme } = useTheme();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        try {
          inputRef.current.focus();
        } catch (e) {}
      }, 100);
    }
  }, [isOpen]);

  async function handleSend() {
    const userText = text.trim();

    if (!userText || sending) return;

    setText('');
    setSending(true);

    sendMessage(userText, 'user');

    try {
      const result = await sendAIMessage(userText, {
        enableMcpTools: true,
        ragContext: 'resident',
      });

      const assistantText =
        result?.assistantMessage?.content ||
        result?.assistantMessage?.text ||
        'AI response မရပါ။';

      sendMessage(assistantText, 'bot');
    } catch (err) {
      sendMessage(
        err.message || 'AI assistant ချိတ်ဆက်မရပါ။ Backend/Ollama ကိုစစ်ပါ။',
        'bot',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.chatBox, { backgroundColor: theme.surface }]}>
            <View style={styles.header}>
              <Text style={[styles.headerText, { color: theme.text }]}>
                Assistant
              </Text>

              <TouchableOpacity onPress={close} style={styles.closeButton}>
                <Text style={{ color: theme.subtext }}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={messages}
              keyExtractor={i => i.id}
              style={styles.messages}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageRow,
                    item.from === 'user' ? styles.userMsg : styles.botMsg,
                  ]}
                >
                  <Text
                    style={{
                      color: item.from === 'user' ? '#fff' : theme.text,
                    }}
                  >
                    {item.text}
                  </Text>
                </View>
              )}
            />

            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder="Type a message"
                placeholderTextColor={theme.subtext}
                style={[
                  styles.input,
                  { backgroundColor: theme.input, color: theme.text },
                ]}
                editable={!sending}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />

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
                  <Text style={{ color: theme.primaryText }}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <View pointerEvents="box-none" style={styles.container}>
        <TouchableOpacity
          accessibilityLabel="Open chat"
          accessibilityHint="Opens assistant chat"
          onPress={toggle}
          style={[styles.fab, { backgroundColor: theme.primary }]}
        >
          <Text style={styles.fabText}>💬</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: 32,
    zIndex: 9999,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
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
  headerText: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 12,
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
  userMsg: {
    alignSelf: 'flex-end',
    backgroundColor: '#0B84FF',
  },
  botMsg: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  sendButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
