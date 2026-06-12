import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';

const fakeBills = [
  { id: 'b1', amount: 45.5, status: 'Pending', due_date: '2026-06-15', service: 'Water' },
  { id: 'b2', amount: 60.0, status: 'Paid', due_date: '2026-05-10', service: 'Electricity' },
  { id: 'b3', amount: 32.0, status: 'Pending', due_date: '2026-06-20', service: 'Maintenance' },
];

const SERVICE_ICONS = {
  Water: 'water-outline',
  Electricity: 'flash-outline',
  Maintenance: 'build-outline',
};

export default function BillsScreen({ navigation }) {
  const { theme } = useTheme();

  return (
    <ScreenContainer navigation={navigation}>
      <FlatList
        data={fakeBills}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.heading, { color: theme.text }]}>Service Bills</Text>
            <Text style={[styles.sub, { color: theme.subtext }]}>
              Manage and pay your utility bills
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isPaid = item.status === 'Paid';
          const statusColor = isPaid ? theme.success : theme.warning;
          const statusBg = isPaid ? theme.successBg : theme.warningBg;
          return (
            <Card>
              <View style={styles.row}>
                <View style={[styles.serviceIcon, { backgroundColor: theme.primary + '18' }]}>
                  <Ionicons
                    name={SERVICE_ICONS[item.service] || 'receipt-outline'}
                    size={22}
                    color={theme.primary}
                  />
                </View>
                <View style={styles.details}>
                  <Text style={[styles.service, { color: theme.text }]}>{item.service}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={13} color={theme.subtext} />
                    <Text style={[styles.due, { color: theme.subtext }]}>Due {item.due_date}</Text>
                  </View>
                </View>
                <View style={styles.right}>
                  <Text style={[styles.amount, { color: theme.text }]}>
                    ${item.amount.toFixed(2)}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
                    <Ionicons
                      name={isPaid ? 'checkmark-circle' : 'time-outline'}
                      size={12}
                      color={statusColor}
                    />
                    <Text style={[styles.status, { color: statusColor }]}>{item.status}</Text>
                  </View>
                </View>
              </View>
            </Card>
          );
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 8 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  sub: { fontSize: 14, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  serviceIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  details: { flex: 1 },
  service: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  due: { fontSize: 13 },
  right: { alignItems: 'flex-end' },
  amount: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  status: { fontSize: 12, fontWeight: '600' },
});
