import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import TopBar from '../../components/TopBar';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';

const fake = [
  { id: 'nt1', title: 'Package delivered', body: 'Your parcel arrived at the lobby', time: '2h ago', read: false },
  { id: 'nt2', title: 'Bill reminder', body: 'Water bill due in 3 days', time: '5h ago', read: false },
  { id: 'nt3', title: 'Visitor approved', body: 'Jane Smith has been pre-registered', time: '1d ago', read: true },
];

const NOTIF_ICONS = {
  'Package delivered': 'cube-outline',
  'Bill reminder': 'receipt-outline',
  'Visitor approved': 'person-outline',
};

export default function NotificationsScreen({ navigation }) {
  const { theme } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <TopBar navigation={navigation} variant="stack" title="Notifications" />
      <FlatList
        data={fake}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card style={!item.read ? { borderColor: theme.primary + '55' } : undefined}>
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: theme.primary + '18' }]}>
                <Ionicons
                  name={NOTIF_ICONS[item.title] || 'notifications-outline'}
                  size={20}
                  color={theme.primary}
                />
              </View>
              <View style={styles.content}>
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
                  {!item.read && (
                    <View style={[styles.unreadDot, { backgroundColor: theme.primary }]} />
                  )}
                </View>
                <Text style={[styles.body, { color: theme.subtext }]}>{item.body}</Text>
                <Text style={[styles.time, { color: theme.inactive }]}>{item.time}</Text>
              </View>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 16, paddingBottom: 32 },
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
});
