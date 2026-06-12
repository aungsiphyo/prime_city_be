import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';

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
