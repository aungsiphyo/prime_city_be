import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';
import {
  fetchNotifications,
  markAllNotificationsRead,
} from '../../api/notifications';

const TYPE_ICONS = {
  SOS: 'alert-circle-outline',
  Emergency: 'warning-outline',
  Announcement: 'megaphone-outline',
  Helper: 'people-outline',
  Visitor: 'person-outline',
  Report: 'document-text-outline',
  General: 'notifications-outline',
};

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotificationsScreen({ navigation }) {
  const { theme } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const unreadCount = items.filter((item) => !item.is_read).length;

  const loadNotifications = useCallback(async (mode = 'initial') => {
    const isRefresh = mode === true || mode === 'refresh';
    const isSilent = mode === 'silent';

    if (isRefresh) setRefreshing(true);
    else if (!isSilent) setLoading(true);
    if (!isSilent) setError(null);

    try {
      const data = await fetchNotifications({ limit: 100 });
      setItems(
        data.map((item) => ({
          id: item._id,
          title: item.title,
          body: item.message,
          type: item.type || 'General',
          time: formatTime(item.created_at),
          is_read: item.is_read,
        })),
      );
    } catch (err) {
      if (err.sessionExpired) return;
      if (!isSilent) setError(err.message || 'Failed to load notifications');
    } finally {
      if (!isSilent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
      const timer = setInterval(() => loadNotifications('silent'), 30000);
      return () => clearInterval(timer);
    }, [loadNotifications]),
  );

  const onMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch (err) {
      if (!err.sessionExpired) setError(err.message || 'Unable to update notifications');
    }
  };

  const renderItem = ({ item }) => {
    const urgent = item.type === 'SOS' || item.type === 'Emergency';
    const accentColor = urgent ? theme.danger : theme.primary;

    return (
      <Card style={!item.is_read ? { borderColor: accentColor + '55' } : undefined}>
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: accentColor + '18' }]}>
            <Ionicons
              name={TYPE_ICONS[item.type] || TYPE_ICONS.General}
              size={20}
              color={accentColor}
            />
          </View>
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
                {item.title}
              </Text>
              {!item.is_read && (
                <View style={[styles.unreadDot, { backgroundColor: accentColor }]} />
              )}
            </View>
            <Text style={[styles.body, { color: theme.subtext }]}>{item.body}</Text>
            <Text style={[styles.time, { color: theme.inactive }]}>{item.time}</Text>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <ScreenContainer
      navigation={navigation}
      topBarVariant="stack"
      title="Notifications"
      showBottomNav>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadNotifications(true)}
            tintColor={theme.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View>
              <Text style={[styles.heading, { color: theme.text }]}>Inbox</Text>
              <Text style={[styles.sub, { color: theme.subtext }]}>
                {unreadCount ? `${unreadCount} unread` : 'All caught up'}
              </Text>
            </View>
            {unreadCount > 0 ? (
              <TouchableOpacity
                style={[styles.markBtn, { borderColor: theme.border }]}
                onPress={onMarkAllRead}>
                <Ionicons name="checkmark-done-outline" size={16} color={theme.primary} />
                <Text style={[styles.markText, { color: theme.primary }]}>Mark all</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Ionicons name="alert-circle-outline" size={36} color={theme.danger} />
              <Text style={[styles.emptyText, { color: theme.text }]}>{error}</Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: theme.primary }]}
                onPress={() => loadNotifications()}>
                <Text style={[styles.retryText, { color: theme.primaryText }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.centered}>
              <Ionicons name="notifications-outline" size={36} color={theme.inactive} />
              <Text style={[styles.emptyText, { color: theme.subtext }]}>No notifications yet</Text>
            </View>
          )
        }
        renderItem={renderItem}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  sub: { fontSize: 14 },
  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  markText: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row' },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '700', flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 6 },
  time: { fontSize: 12 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontSize: 14, fontWeight: '600' },
});
