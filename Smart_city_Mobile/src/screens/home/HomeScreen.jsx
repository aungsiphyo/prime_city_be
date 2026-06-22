import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
// local chat components removed: using global FloatingChat instead
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { fetchAnnouncements } from '../../api/announcements';

const QUICK_ACTIONS = [
  { id: 'bills', label: 'Bills', icon: 'receipt-outline', screen: 'Bills' },
  { id: 'helpers', label: 'Helpers', icon: 'people-outline', screen: 'Helpers' },
  {
    id: 'visitor',
    label: 'Visitor',
    icon: 'person-add-outline',
    screen: 'PreRegister',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: 'notifications-outline',
    screen: 'Notifications',
  },
  {
    id: 'news',
    label: 'News',
    icon: 'megaphone-outline',
    screen: 'Announcements',
  },
];

const TYPE_COLORS = {
  Maintenance: 'warning',
  Event: 'primary',
};

export default function HomeScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  // chat is managed globally by ChatProvider / FloatingChat
  const [announcements, setAnnouncements] = useState([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const quickActions =
    user?.role === 'Admin'
      ? [
          {
            id: 'admin-notifications',
            label: 'Send Noti',
            icon: 'send-outline',
            screen: 'AdminNotifications',
          },
          ...QUICK_ACTIONS,
        ]
      : QUICK_ACTIONS;

  const navigateTo = screen => navigation.navigate(screen);

  const loadAnnouncements = useCallback(async () => {
    setLoadingAnnouncements(true);
    try {
      const data = await fetchAnnouncements({ limit: 5 });
      setAnnouncements(
        data.map((item) => ({
          id: item._id,
          title: item.title,
          message: item.message,
          type: item.type || 'General',
        })),
      );
    } catch (err) {
      if (!err.sessionExpired) setAnnouncements([]);
    } finally {
      setLoadingAnnouncements(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAnnouncements();
    }, [loadAnnouncements]),
  );

  return (
    <ScreenContainer navigation={navigation}>
      <FlatList
        data={announcements}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <Text style={[styles.greeting, { color: theme.subtext }]}>
                Good morning
              </Text>
              <Text style={[styles.heading, { color: theme.text }]}>
                Welcome, Resident
              </Text>
              <Text style={[styles.sub, { color: theme.subtext }]}>
                Unit A-101 · Smart Residential
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Quick actions
            </Text>
            <View style={styles.actionsRow}>
              {quickActions.map(action => (
                <TouchableOpacity
                  key={action.id}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={() => navigateTo(action.screen)}
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: theme.primary + '22' },
                    ]}
                  >
                    <Ionicons
                      name={action.icon}
                      size={22}
                      color={theme.primary}
                    />
                  </View>
                  <Text style={[styles.actionLabel, { color: theme.text }]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Card style={styles.reportCard}>
              <View style={styles.reportRow}>
                <View style={[styles.reportIcon, { backgroundColor: theme.warningBg }]}>
                  <Ionicons name="document-text-outline" size={22} color={theme.warning} />
                </View>
                <View style={styles.reportCopy}>
                  <Text style={[styles.reportTitle, { color: theme.text }]}>Submit a report</Text>
                  <Text style={[styles.reportSub, { color: theme.subtext }]}>
                    Maintenance, security, or community issues
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: theme.primary }]}
                onPress={() => navigateTo('ReportIssue')}
                activeOpacity={0.85}>
                <Ionicons name="send-outline" size={17} color={theme.primaryText} />
                <Text style={[styles.reportBtnText, { color: theme.primaryText }]}>Report now</Text>
              </TouchableOpacity>
            </Card>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Latest announcements
            </Text>
          </>
        }
        ListEmptyComponent={
          loadingAnnouncements ? (
            <View style={styles.emptyAnnouncements}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : (
            <Card>
              <View style={styles.emptyRow}>
                <Ionicons name="megaphone-outline" size={20} color={theme.inactive} />
                <Text style={[styles.emptyText, { color: theme.subtext }]}>
                  No announcements yet
                </Text>
              </View>
            </Card>
          )
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
                    name={
                      item.type === 'Event'
                        ? 'calendar-outline'
                        : 'construct-outline'
                    }
                    size={14}
                    color={accentColor}
                  />
                  <Text style={[styles.typeText, { color: accentColor }]}>
                    {item.type}
                  </Text>
                </View>
              </View>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {item.title}
              </Text>
              <Text style={[styles.cardText, { color: theme.subtext }]}>
                {item.message}
              </Text>
            </Card>
          );
        }}
      />

    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  hero: { marginBottom: 24 },
  greeting: { fontSize: 14, fontWeight: '500', marginBottom: 4 },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
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
  reportCard: { marginBottom: 28 },
  reportRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  reportIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reportCopy: { flex: 1 },
  reportTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  reportSub: { fontSize: 13, lineHeight: 18 },
  reportBtn: {
    minHeight: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  reportBtnText: { fontSize: 14, fontWeight: '700' },
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
  emptyAnnouncements: { paddingVertical: 20 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 14 },
});
