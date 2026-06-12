import React, { useState } from 'react';
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
import TopBar from '../../components/TopBar';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { registerVisitor, splitFullName, VISITOR_PURPOSES } from '../../api/visitors';

export default function PreRegisterVisitorScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [host, setHost] = useState(user?.fullname || '');
  const [purpose, setPurpose] = useState('General');
  const [purposeDetail, setPurposeDetail] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const InputField = ({ label, icon, ...props }) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.subtext }]}>{label}</Text>
      <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
        <Ionicons name={icon} size={18} color={theme.inactive} style={styles.inputIcon} />
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholderTextColor={theme.inactive}
          {...props}
        />
      </View>
    </View>
  );

  const onSubmit = async () => {
    const { firstName, lastName } = splitFullName(name);

    if (!firstName || !email.trim() || !phone.trim() || !host.trim()) {
      Alert.alert('Missing fields', 'Please fill in visitor name, email, phone, and host.');
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    if (!agreedToTerms) {
      Alert.alert('Terms required', 'You must agree to the visitor terms before registering.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await registerVisitor({
        firstName,
        lastName,
        email: email.trim(),
        phone: phone.trim(),
        hostName: host.trim(),
        purpose,
        purposeDetail: purposeDetail.trim(),
        agreedToTerms: true,
      });

      Alert.alert(
        'Visitor Registered',
        `Badge: ${res.data?.badgeNumber || 'N/A'}\n${res.message || 'Your visitor has been pre-approved.'}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Registration failed', err.message || 'Unable to register visitor.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <TopBar navigation={navigation} variant="stack" title="Pre-register Visitor" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.infoBanner, { backgroundColor: theme.primary + '15', borderColor: theme.primary + '33' }]}>
          <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
          <Text style={[styles.infoText, { color: theme.subtext }]}>
            Pre-register visitors for faster lobby check-in
          </Text>
        </View>

        <InputField
          label="Visitor name"
          icon="person-outline"
          placeholder="Full name"
          value={name}
          onChangeText={setName}
        />
        <InputField
          label="Email"
          icon="mail-outline"
          placeholder="visitor@email.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <InputField
          label="Phone number"
          icon="call-outline"
          placeholder="+1 234 567 890"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <InputField
          label="Host name"
          icon="home-outline"
          placeholder="Resident or host name"
          value={host}
          onChangeText={setHost}
        />

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.subtext }]}>Purpose of visit</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.purposeRow}>
            {VISITOR_PURPOSES.map((item) => {
              const selected = purpose === item;
              return (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.purposeChip,
                    {
                      backgroundColor: selected ? theme.primary : theme.input,
                      borderColor: selected ? theme.primary : theme.border,
                    },
                  ]}
                  onPress={() => setPurpose(item)}>
                  <Text
                    style={[
                      styles.purposeChipText,
                      { color: selected ? theme.primaryText : theme.text },
                    ]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <InputField
          label="Additional details (optional)"
          icon="document-text-outline"
          placeholder="Meeting room, delivery notes, etc."
          value={purposeDetail}
          onChangeText={setPurposeDetail}
        />

        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => setAgreedToTerms(!agreedToTerms)}
          activeOpacity={0.7}>
          <Ionicons
            name={agreedToTerms ? 'checkbox' : 'square-outline'}
            size={22}
            color={agreedToTerms ? theme.primary : theme.inactive}
          />
          <Text style={[styles.termsText, { color: theme.subtext }]}>
            I agree to the visitor registration terms
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.primary, opacity: submitting ? 0.7 : 1 }]}
          onPress={onSubmit}
          disabled={submitting}
          activeOpacity={0.85}>
          {submitting ? (
            <ActivityIndicator color={theme.primaryText} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.primaryText} />
              <Text style={[styles.buttonText, { color: theme.primaryText }]}>Submit registration</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 16, paddingBottom: 40 },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15 },
  purposeRow: { gap: 8, paddingVertical: 2 },
  purposeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  purposeChipText: { fontSize: 13, fontWeight: '600' },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  termsText: { flex: 1, fontSize: 13, lineHeight: 18 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
});
