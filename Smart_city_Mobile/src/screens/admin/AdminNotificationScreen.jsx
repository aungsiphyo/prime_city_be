import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';
import {
  fetchResidentsForNotifications,
  sendAdminNotification,
} from '../../api/adminNotifications';

const TARGETS = [
  { id: 'all', label: 'All residents', icon: 'people-outline' },
  { id: 'one', label: 'One resident', icon: 'person-outline' },
];

const NOTIFICATION_TYPES = ['General', 'Announcement', 'Emergency'];

export default function AdminNotificationScreen({ navigation }) {
  const { theme } = useTheme();
  const [target, setTarget] = useState('all');
  const [residents, setResidents] = useState([]);
  const [selectedResident, setSelectedResident] = useState(null);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('General');
  const [loadingResidents, setLoadingResidents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const loadResidents = useCallback(async () => {
    setLoadingResidents(true);
    setError(null);
    try {
      const data = await fetchResidentsForNotifications();
      setResidents(data);
    } catch (err) {
      if (!err.sessionExpired) {
        setError(err.message || 'Unable to load residents');
      }
    } finally {
      setLoadingResidents(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadResidents();
    }, [loadResidents]),
  );

  const filteredResidents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return residents;

    return residents.filter((resident) => {
      const text = [
        resident.fullname,
        resident.email,
        resident.phone,
        resident.room_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(term);
    });
  }, [residents, search]);

  const onSubmit = async () => {
    if (!title.trim() || !message.trim()) {
      Alert.alert('Missing fields', 'Please enter a title and message.');
      return;
    }

    if (target === 'one' && !selectedResident?._id) {
      Alert.alert('Select resident', 'Please choose a resident first.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await sendAdminNotification({
        target: target === 'all' ? 'all_residents' : 'resident',
        recipient_user_id: target === 'one' ? selectedResident._id : undefined,
        title: title.trim(),
        message: message.trim(),
        type,
      });

      Alert.alert(
        'Notification sent',
        `${res.sent_count || 1} resident${(res.sent_count || 1) > 1 ? 's' : ''} notified.`,
      );
      setTitle('');
      setMessage('');
    } catch (err) {
      if (!err.sessionExpired) {
        Alert.alert('Send failed', err.message || 'Unable to send notification.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      navigation={navigation}
      topBarVariant="stack"
      title="Send Notification"
      showBottomNav>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Send to</Text>
          <View style={styles.segmentRow}>
            {TARGETS.map((item) => {
              const selected = target === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: selected ? theme.primary : theme.card,
                      borderColor: selected ? theme.primary : theme.border,
                    },
                  ]}
                  onPress={() => setTarget(item.id)}
                  activeOpacity={0.8}>
                  <Ionicons
                    name={item.icon}
                    size={17}
                    color={selected ? theme.primaryText : theme.icon}
                  />
                  <Text
                    style={[
                      styles.segmentText,
                      { color: selected ? theme.primaryText : theme.text },
                    ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {target === 'one' ? (
          <View style={styles.section}>
            <Text style={[styles.label, { color: theme.subtext }]}>Resident</Text>
            <View style={[styles.searchBox, { backgroundColor: theme.input, borderColor: theme.border }]}>
              <Ionicons name="search-outline" size={18} color={theme.inactive} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search name, room, phone..."
                placeholderTextColor={theme.inactive}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            {loadingResidents ? (
              <View style={styles.residentLoading}>
                <ActivityIndicator color={theme.primary} />
              </View>
            ) : error ? (
              <Card>
                <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
              </Card>
            ) : (
              filteredResidents.slice(0, 12).map((resident) => {
                const selected = selectedResident?._id === resident._id;
                return (
                  <TouchableOpacity
                    key={resident._id}
                    style={[
                      styles.residentRow,
                      {
                        backgroundColor: selected ? theme.primary + '18' : theme.card,
                        borderColor: selected ? theme.primary : theme.border,
                      },
                    ]}
                    onPress={() => setSelectedResident(resident)}
                    activeOpacity={0.8}>
                    <View style={[styles.residentIcon, { backgroundColor: theme.primary + '18' }]}>
                      <Ionicons name="person-outline" size={18} color={theme.primary} />
                    </View>
                    <View style={styles.residentCopy}>
                      <Text style={[styles.residentName, { color: theme.text }]} numberOfLines={1}>
                        {resident.fullname || 'Resident'}
                      </Text>
                      <Text style={[styles.residentMeta, { color: theme.subtext }]} numberOfLines={1}>
                        {[resident.room_id, resident.phone].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Type</Text>
          <View style={styles.typeRow}>
            {NOTIFICATION_TYPES.map((item) => {
              const selected = type === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: selected ? theme.primary : theme.card,
                      borderColor: selected ? theme.primary : theme.border,
                    },
                  ]}
                  onPress={() => setType(item)}>
                  <Text
                    style={[
                      styles.typeText,
                      { color: selected ? theme.primaryText : theme.text },
                    ]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Title</Text>
          <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Notification title"
              placeholderTextColor={theme.inactive}
              value={title}
              onChangeText={setTitle}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Message</Text>
          <View style={[styles.textAreaWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
            <TextInput
              style={[styles.textArea, { color: theme.text }]}
              placeholder="Write the message residents will receive..."
              placeholderTextColor={theme.inactive}
              value={message}
              onChangeText={setMessage}
              multiline
              textAlignVertical="top"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: theme.primary },
            submitting && styles.disabled,
          ]}
          onPress={onSubmit}
          disabled={submitting}
          activeOpacity={0.85}>
          {submitting ? (
            <ActivityIndicator color={theme.primaryText} />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color={theme.primaryText} />
              <Text style={[styles.sendText, { color: theme.primaryText }]}>Send notification</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  searchBox: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14 },
  residentLoading: { paddingVertical: 18 },
  errorText: { fontSize: 14 },
  residentRow: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  residentIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  residentCopy: { flex: 1 },
  residentName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  residentMeta: { fontSize: 12 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  typeText: { fontSize: 13, fontWeight: '700' },
  inputWrap: {
    borderWidth: 1,
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  input: { fontSize: 15 },
  textAreaWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  textArea: { minHeight: 116, fontSize: 15, paddingVertical: 12 },
  sendBtn: {
    minHeight: 50,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sendText: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.7 },
});
