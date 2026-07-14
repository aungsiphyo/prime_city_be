import React, { useState } from 'react';
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
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { REPORT_TYPES, submitReport } from '../../api/reports';

export default function ReportIssueScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [type, setType] = useState('Maintenance');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState(user?.room_id ? `Unit ${user.room_id}` : '');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!title.trim() || !location.trim() || !message.trim()) {
      Alert.alert('Missing fields', 'Please enter title, location, and details.');
      return;
    }

    setSubmitting(true);
    try {
      await submitReport({
        title: title.trim(),
        location: location.trim(),
        message: message.trim(),
        type,
      });

      Alert.alert('Report submitted', 'Admin staff will review your report.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
      setTitle('');
      setMessage('');
    } catch (err) {
      if (!err.sessionExpired) {
        Alert.alert('Submit failed', err.message || 'Unable to submit report.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      navigation={navigation}
      topBarVariant="stack"
      title="Report Issue"
      showBottomNav>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Type</Text>
          <View style={styles.typeRow}>
            {REPORT_TYPES.map((item) => {
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
                  onPress={() => setType(item)}
                  activeOpacity={0.8}>
                  <Ionicons
                    name={
                      item === 'Security'
                        ? 'shield-checkmark-outline'
                        : item === 'Maintenance'
                          ? 'construct-outline'
                          : 'document-text-outline'
                    }
                    size={16}
                    color={selected ? theme.primaryText : theme.icon}
                  />
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
              placeholder="Short report title"
              placeholderTextColor={theme.inactive}
              value={title}
              onChangeText={setTitle}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Location</Text>
          <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="Unit, lobby, floor, parking area..."
              placeholderTextColor={theme.inactive}
              value={location}
              onChangeText={setLocation}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtext }]}>Details</Text>
          <View style={[styles.textAreaWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
            <TextInput
              style={[styles.textArea, { color: theme.text }]}
              placeholder="Describe what happened..."
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
            styles.submitBtn,
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
              <Text style={[styles.submitText, { color: theme.primaryText }]}>Submit report</Text>
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
  typeRow: { gap: 8 },
  typeChip: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeText: { fontSize: 14, fontWeight: '700' },
  inputWrap: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  input: { fontSize: 15 },
  textAreaWrap: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  textArea: { minHeight: 128, fontSize: 15, paddingVertical: 12 },
  submitBtn: {
    minHeight: 50,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitText: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.7 },
});
