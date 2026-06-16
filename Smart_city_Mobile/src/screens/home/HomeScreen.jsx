import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import FloatingChatButton from '../../components/chat/FloatingChatButton';
import ChatSheet from '../../components/chat/ChatSheet';
import { useTheme } from '../../context/ThemeContext';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 68;

const fakeAnnouncements = [
  { id: 'a1', title: 'Water Shutoff', message: 'Maintenance on 12 June', type: 'Maintenance' },
  { id: 'a2', title: 'Community BBQ', message: 'Join us this Saturday', type: 'Event' },
];

const QUICK_ACTIONS = [
  { id: 'bills', label: 'Bills', icon: 'receipt-outline', screen: 'Bills' },
  { id: 'visitor', label: 'Visitor', icon: 'person-add-outline', screen: 'PreRegister' },
  { id: 'alerts', label: 'Alerts', icon: 'notifications-outline', screen: 'Notifications' },
  { id: 'news', label: 'News', icon: 'megaphone-outline', screen: 'Announcements' },
];

const TYPE_COLORS = {
  Maintenance: 'warning',
  Event: 'primary',
};

export default function HomeScreen({ navigation }) {
  const { theme } = useTheme();
  const [chatOpen, setChatOpen] = useState(false);

  const navigateTo = (screen) => navigation.navigate(screen);

  return (
    <ScreenContainer navigation={navigation}>
      <FlatList
        data={fakeAnnouncements}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <Text style={[styles.greeting, { color: theme.subtext }]}>Good morning</Text>
              <Text style={[styles.heading, { color: theme.text }]}>Welcome, Resident</Text>
              <Text style={[styles.sub, { color: theme.subtext }]}>
                Unit A-101 · Smart Residential
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>Quick actions</Text>
            <View style={styles.actionsRow}>
              {QUICK_ACTIONS.map((action) => (
                <TouchableOpacity
                  key={action.id}
                  style={[styles.actionBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => navigateTo(action.screen)}>
                  <View style={[styles.actionIcon, { backgroundColor: theme.primary + '22' }]}>
                    <Ionicons name={action.icon} size={22} color={theme.primary} />
                  </View>
                  <Text style={[styles.actionLabel, { color: theme.text }]}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>AI assistant</Text>
            <Card style={styles.aiCard}>
              <View style={styles.aiRow}>
                <View style={[styles.aiIconWrap, { backgroundColor: theme.primaryBg }]}>
                  <Ionicons name="sparkles" size={22} color={theme.primary} />
                </View>
                <View style={styles.aiCopy}>
                  <Text style={[styles.aiTitle, { color: theme.text }]}>SmartRes AI</Text>
                  <Text style={[styles.aiSub, { color: theme.subtext }]}>
                    Ask about bills, visitors, parking & more — RAG + MCP powered.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.aiCta, { backgroundColor: theme.primary }]}
                onPress={() => setChatOpen(true)}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.primaryText} />
                <Text style={[styles.aiCtaText, { color: theme.primaryText }]}>Start chatting</Text>
              </TouchableOpacity>
            </Card>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>Latest announcements</Text>
          </>
        }
        renderItem={({ item }) => {
          const accent = TYPE_COLORS[item.type] || 'primary';
          const accentColor = theme[accent];
          const accentBg = theme[`${accent}Bg`] || theme.card;
          return (
            <Card>
              <View style={styles.cardHeader}>
                <View style={[styles.typeBadge, { backgroundColor: accentBg }]}>
                  <Ionicons
                    name={item.type === 'Event' ? 'calendar-outline' : 'construct-outline'}
                    size={14}
                    color={accentColor}
                  />
                  <Text style={[styles.typeText, { color: accentColor }]}>{item.type}</Text>
                </View>
              </View>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{item.title}</Text>
              <Text style={[styles.cardText, { color: theme.subtext }]}>{item.message}</Text>
            </Card>
          );
        }}
      />

      <FloatingChatButton
        visible={!chatOpen}
        bottomOffset={TAB_BAR_HEIGHT + 12}
        onPress={() => setChatOpen(true)}
      />

      <ChatSheet visible={chatOpen} onClose={() => setChatOpen(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  hero: { marginBottom: 24 },
  greeting: { fontSize: 14, fontWeight: '500', marginBottom: 4 },
  heading: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginBottom: 4 },
  sub: { fontSize: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
  },
  actionBtn: {
    width: '47%',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionLabel: { fontSize: 13, fontWeight: '600' },
  aiCard: { marginBottom: 28 },
  aiRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  aiIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  aiCopy: { flex: 1 },
  aiTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  aiSub: { fontSize: 13, lineHeight: 18 },
  aiCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  aiCtaText: { fontSize: 14, fontWeight: '600' },
  cardHeader: { marginBottom: 8 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeText: { fontSize: 12, fontWeight: '600' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardText: { fontSize: 14, lineHeight: 20 },
});
