import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { fetchProfile } from '../../api/profile';

const PROFILE_FIELDS = [
  { key: 'fullname', label: 'Name', icon: 'person-outline' },
  { key: 'email', label: 'Email', icon: 'mail-outline' },
  { key: 'phone', label: 'Phone', icon: 'call-outline' },
  { key: 'room_id', label: 'Unit', icon: 'home-outline' },
];

function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export default function ProfileScreen({ navigation }) {
  const { theme, toggleTheme } = useTheme();
  const { signOut } = useAuth();
  const isDark = theme.mode === 'dark';

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await fetchProfile();
      setProfile(user);
    } catch (err) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile]),
  );

  const onSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const displayValue = (key) => {
    const value = profile?.[key];
    if (value == null || value === '') return '—';
    return String(value);
  };

  return (
    <ScreenContainer navigation={navigation}>
      <View style={styles.container}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
            <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: theme.primary }]}
              onPress={loadProfile}>
              <Text style={[styles.retryText, { color: theme.primaryText }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.avatarSection}>
              <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
                <Text style={[styles.avatarText, { color: theme.primaryText }]}>
                  {getInitials(profile?.fullname)}
                </Text>
              </View>
              <Text style={[styles.name, { color: theme.text }]}>{profile?.fullname}</Text>
              {profile?.room_id ? (
                <Text style={[styles.unit, { color: theme.subtext }]}>Unit {profile.room_id}</Text>
              ) : null}
              {profile?.role ? (
                <Text style={[styles.role, { color: theme.subtext }]}>{profile.role}</Text>
              ) : null}
            </View>

            <Card>
              {PROFILE_FIELDS.map((field, index) => (
                <View
                  key={field.key}
                  style={[
                    styles.fieldRow,
                    index < PROFILE_FIELDS.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: theme.border,
                    },
                  ]}>
                  <View style={[styles.fieldIcon, { backgroundColor: theme.primary + '15' }]}>
                    <Ionicons name={field.icon} size={18} color={theme.primary} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Text style={[styles.fieldLabel, { color: theme.subtext }]}>{field.label}</Text>
                    <Text style={[styles.fieldValue, { color: theme.text }]}>
                      {displayValue(field.key)}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>

            <Card style={styles.settingsCard}>
              <View style={styles.settingRow}>
                <View style={[styles.fieldIcon, { backgroundColor: theme.primary + '15' }]}>
                  <Ionicons
                    name={isDark ? 'moon' : 'sunny'}
                    size={18}
                    color={theme.primary}
                  />
                </View>
                <View style={styles.fieldContent}>
                  <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Appearance</Text>
                  <Text style={[styles.fieldValue, { color: theme.text }]}>
                    {isDark ? 'Dark mode' : 'Light mode'}
                  </Text>
                </View>
                <Switch
                  value={isDark}
                  onValueChange={toggleTheme}
                  trackColor={{ false: theme.border, true: theme.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </Card>

            <TouchableOpacity
              style={[styles.logoutBtn, { borderColor: theme.danger }]}
              onPress={onSignOut}
              activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={18} color={theme.danger} />
              <Text style={[styles.logoutText, { color: theme.danger }]}>Sign out</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  errorText: { fontSize: 15, textAlign: 'center', marginTop: 8 },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontSize: 14, fontWeight: '600' },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 24, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  unit: { fontSize: 14 },
  role: { fontSize: 13, marginTop: 2 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fieldContent: { flex: 1 },
  fieldLabel: { fontSize: 12, marginBottom: 2 },
  fieldValue: { fontSize: 15, fontWeight: '600' },
  settingsCard: { marginTop: 0 },
  settingRow: { flexDirection: 'row', alignItems: 'center' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  logoutText: { fontSize: 15, fontWeight: '600' },
});
