import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import { useTheme } from '../../context/ThemeContext';

const EMERGENCY_TYPES = [
  { id: 'security', label: 'Security', icon: 'shield-outline' },
  { id: 'medical', label: 'Medical', icon: 'medkit-outline' },
  { id: 'fire', label: 'Fire', icon: 'flame-outline' },
];

export default function SosScreen({ navigation }) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState('security');

  const triggerSOS = () => {
    Alert.alert(
      'Send SOS Alert?',
      'Security will be notified immediately with your location.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: () => Alert.alert('SOS Sent', 'Help is on the way.') },
      ],
    );
  };

  return (
    <ScreenContainer navigation={navigation}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.text }]}>Emergency SOS</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>
            Select type and hold the button to alert security
          </Text>
        </View>

        <View style={styles.typeRow}>
          {EMERGENCY_TYPES.map((type) => {
            const active = selected === type.id;
            return (
              <TouchableOpacity
                key={type.id}
                style={[
                  styles.typeBtn,
                  {
                    backgroundColor: active ? theme.dangerBg : theme.card,
                    borderColor: active ? theme.danger : theme.border,
                  },
                ]}
                onPress={() => setSelected(type.id)}>
                <Ionicons
                  name={type.icon}
                  size={22}
                  color={active ? theme.danger : theme.inactive}
                />
                <Text
                  style={[
                    styles.typeLabel,
                    { color: active ? theme.danger : theme.subtext },
                  ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sosArea}>
          <TouchableOpacity
            style={styles.sosOuter}
            onPress={triggerSOS}
            activeOpacity={0.9}>
            <View style={styles.sosRing}>
              <View style={styles.sosButton}>
                <Ionicons name="alert" size={40} color="#FFFFFF" />
                <Text style={styles.sosText}>SOS</Text>
              </View>
            </View>
          </TouchableOpacity>
          <Text style={[styles.hint, { color: theme.subtext }]}>Tap to send alert</Text>
        </View>

        <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
          <Text style={[styles.infoText, { color: theme.subtext }]}>
            Your unit number and location will be shared with on-duty security staff.
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { marginBottom: 24 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, marginBottom: 6 },
  sub: { fontSize: 14, lineHeight: 20 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 32 },
  typeBtn: {
    flex: 1,
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 6,
  },
  typeLabel: { fontSize: 12, fontWeight: '600' },
  sosArea: { alignItems: 'center', marginBottom: 32 },
  sosOuter: { marginBottom: 12 },
  sosRing: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#EF444422',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  sosText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, marginTop: 2 },
  hint: { fontSize: 13 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
