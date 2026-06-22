import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';
import { createHelperRequest, HELPER_CATEGORIES } from '../../api/helpers';

const GENDER_OPTIONS = ['No Preference', 'Female', 'Male'];

export default function HelperRequestScreen({ navigation, route }) {
  const { theme } = useTheme();
  const helper = route.params?.helper;
  const initialCategory =
    route.params?.category && route.params.category !== 'All'
      ? route.params.category
      : 'House Helper';

  const [category, setCategory] = useState(initialCategory);
  const [gender, setGender] = useState(helper?.gender || 'No Preference');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const helperSubtitle = useMemo(() => {
    if (!helper) return 'No specific helper selected';
    return [helper.gender, helper.phone].filter(Boolean).join(' · ');
  }, [helper]);

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      await createHelperRequest({
        helper_id: helper?._id,
        type: category,
        gender_preferred: gender,
        note: note.trim(),
      });

      Alert.alert('Request sent', 'Admin staff will review your helper request.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      if (!err.sessionExpired) {
        Alert.alert('Request failed', err.message || 'Unable to request helper.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      navigation={navigation}
      topBarVariant="stack"
      title="Helper Request"
      showBottomNav>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.selectedRow}>
            <View style={[styles.selectedIcon, { backgroundColor: theme.primary + '18' }]}>
              <Ionicons name="people-outline" size={22} color={theme.primary} />
            </View>
            <View style={styles.selectedCopy}>
              <Text style={[styles.selectedTitle, { color: theme.text }]}>
                {helper?.fullname || 'Any available helper'}
              </Text>
              <Text style={[styles.selectedSub, { color: theme.subtext }]}>
                {helperSubtitle}
              </Text>
            </View>
          </View>
        </Card>

        <Text style={[styles.label, { color: theme.subtext }]}>Category</Text>
        <View style={styles.chipGrid}>
          {HELPER_CATEGORIES.map((item) => {
            const selected = category === item;
            return (
              <TouchableOpacity
                key={item}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.primary : theme.card,
                    borderColor: selected ? theme.primary : theme.border,
                  },
                ]}
                onPress={() => setCategory(item)}>
                <Text
                  style={[
                    styles.chipText,
                    { color: selected ? theme.primaryText : theme.text },
                  ]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.label, { color: theme.subtext }]}>Preferred gender</Text>
        <View style={styles.genderRow}>
          {GENDER_OPTIONS.map((item) => {
            const selected = gender === item;
            return (
              <TouchableOpacity
                key={item}
                style={[
                  styles.genderChip,
                  {
                    backgroundColor: selected ? theme.primary + '20' : theme.card,
                    borderColor: selected ? theme.primary : theme.border,
                  },
                ]}
                onPress={() => setGender(item)}>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off-outline'}
                  size={16}
                  color={selected ? theme.primary : theme.inactive}
                />
                <Text style={[styles.genderText, { color: theme.text }]}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.label, { color: theme.subtext }]}>Notes</Text>
        <View style={[styles.textAreaWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
          <TextInput
            style={[styles.textArea, { color: theme.text }]}
            placeholder="Schedule, tasks, access notes..."
            placeholderTextColor={theme.inactive}
            value={note}
            onChangeText={setNote}
            multiline
            textAlignVertical="top"
          />
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
              <Text style={[styles.submitText, { color: theme.primaryText }]}>Send request</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  selectedRow: { flexDirection: 'row', alignItems: 'center' },
  selectedIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  selectedCopy: { flex: 1 },
  selectedTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  selectedSub: { fontSize: 13 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  genderRow: { gap: 8, marginBottom: 18 },
  genderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  genderText: { fontSize: 14, fontWeight: '600' },
  textAreaWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  textArea: { minHeight: 110, fontSize: 15, paddingVertical: 12 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  submitText: { fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.7 },
});
