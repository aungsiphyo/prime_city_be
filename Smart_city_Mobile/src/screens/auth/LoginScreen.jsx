import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { loginStep1, loginStep2 } from '../../api/auth';

export default function LoginScreen() {
  const { theme } = useTheme();
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onContinue = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      await loginStep1(email.trim(), password);
      setOtpSent(true);
      Alert.alert('OTP sent', 'Check your email for the verification code.');
    } catch (err) {
      Alert.alert('Sign in failed', err.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const onVerifyOtp = async () => {
    if (!otp.trim()) {
      Alert.alert('Missing OTP', 'Enter the code sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const res = await loginStep2(email.trim(), otp.trim());
      signIn({
        id: res.user.id,
        fullname: res.user.fullname,
        email: email.trim(),
        role: res.user.role,
      });
    } catch (err) {
      Alert.alert('Verification failed', err.message || 'Invalid or expired OTP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40 }]}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.logoWrap, { backgroundColor: theme.primary }]}>
          <Ionicons name="business" size={32} color={theme.primaryText} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Smart Residential</Text>
        <Text style={[styles.subtitle, { color: theme.subtext }]}>
          {otpSent ? 'Enter the OTP sent to your email' : 'Sign in with your resident account'}
        </Text>

        <View style={styles.form}>
          {!otpSent ? (
            <>
              <Text style={[styles.label, { color: theme.subtext }]}>Email</Text>
              <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
                <Ionicons name="mail-outline" size={18} color={theme.inactive} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter email"
                  value={email}
                  onChangeText={setEmail}
                  placeholderTextColor={theme.inactive}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <Text style={[styles.label, { color: theme.subtext }]}>Password</Text>
              <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.inactive} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholderTextColor={theme.inactive}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={theme.inactive}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary }]}
                onPress={onContinue}
                disabled={loading}
                activeOpacity={0.85}>
                {loading ? (
                  <ActivityIndicator color={theme.primaryText} />
                ) : (
                  <>
                    <Text style={[styles.buttonText, { color: theme.primaryText }]}>Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color={theme.primaryText} />
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: theme.subtext }]}>OTP code</Text>
              <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
                <Ionicons name="key-outline" size={18} color={theme.inactive} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="6-digit code"
                  value={otp}
                  onChangeText={setOtp}
                  placeholderTextColor={theme.inactive}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary }]}
                onPress={onVerifyOtp}
                disabled={loading}
                activeOpacity={0.85}>
                {loading ? (
                  <ActivityIndicator color={theme.primaryText} />
                ) : (
                  <>
                    <Text style={[styles.buttonText, { color: theme.primaryText }]}>Verify & sign in</Text>
                    <Ionicons name="checkmark" size={18} color={theme.primaryText} />
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backLink}
                onPress={() => {
                  setOtpSent(false);
                  setOtp('');
                }}>
                <Text style={[styles.backLinkText, { color: theme.primary }]}>Use a different account</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 32 },
  form: { gap: 4 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 12 },
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
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    marginTop: 28,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  backLink: { alignItems: 'center', marginTop: 16 },
  backLinkText: { fontSize: 14, fontWeight: '600' },
});
