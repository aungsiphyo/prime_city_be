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
import { forgotPasswordStep1, forgotPasswordStep2 } from '../../api/auth';

export default function ForgotPasswordScreen({ navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert('Missing field', 'Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      await forgotPasswordStep1(email.trim());
      setOtpSent(true);
      Alert.alert('OTP sent', 'Check your email for the password reset OTP verification code.');
    } catch (err) {
      Alert.alert('Request failed', err.message || 'Unable to request password reset.');
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    if (!otp.trim()) {
      Alert.alert('Missing field', 'Please enter the verification OTP.');
      return;
    }
    if (!newPassword) {
      Alert.alert('Missing field', 'Please enter your new password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Invalid Password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Confirm password does not match new password.');
      return;
    }

    setLoading(true);
    try {
      await forgotPasswordStep2(email.trim(), otp.trim(), newPassword);
      Alert.alert(
        'Success',
        'Your password has been successfully reset. Please sign in with your new password.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login'),
          },
        ]
      );
    } catch (err) {
      Alert.alert('Reset failed', err.message || 'Invalid or expired OTP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20 }]}
        keyboardShouldPersistTaps="handled">
        
        {/* Back navigation button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (otpSent) {
              setOtpSent(false);
              setOtp('');
              setNewPassword('');
              setConfirmPassword('');
            } else {
              navigation.goBack();
            }
          }}
          activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>

        <View style={[styles.logoWrap, { backgroundColor: theme.primary }]}>
          <Ionicons name="key-outline" size={32} color={theme.primaryText} />
        </View>
        
        <Text style={[styles.title, { color: theme.text }]}>Forgot Password</Text>
        <Text style={[styles.subtitle, { color: theme.subtext }]}>
          {otpSent
            ? 'Enter the OTP code from your email and set your new password.'
            : 'Enter your registered email address to receive a password reset OTP code.'}
        </Text>

        <View style={styles.form}>
          {!otpSent ? (
            <>
              <Text style={[styles.label, { color: theme.subtext }]}>Email Address</Text>
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

              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary }]}
                onPress={onSendOtp}
                disabled={loading}
                activeOpacity={0.85}>
                {loading ? (
                  <ActivityIndicator color={theme.primaryText} />
                ) : (
                  <>
                    <Text style={[styles.buttonText, { color: theme.primaryText }]}>Send OTP</Text>
                    <Ionicons name="arrow-forward" size={18} color={theme.primaryText} />
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backLink}
                onPress={() => navigation.navigate('Login')}
                activeOpacity={0.7}>
                <Text style={[styles.backLinkText, { color: theme.primary }]}>Back to Sign In</Text>
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

              <Text style={[styles.label, { color: theme.subtext }]}>New Password</Text>
              <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.inactive} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChangeText={setNewPassword}
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

              <Text style={[styles.label, { color: theme.subtext }]}>Confirm New Password</Text>
              <View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor: theme.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={theme.inactive} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  placeholderTextColor={theme.inactive}
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} hitSlop={8}>
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={theme.inactive}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.primary }]}
                onPress={onResetPassword}
                disabled={loading}
                activeOpacity={0.85}>
                {loading ? (
                  <ActivityIndicator color={theme.primaryText} />
                ) : (
                  <>
                    <Text style={[styles.buttonText, { color: theme.primaryText }]}>Reset Password</Text>
                    <Ionicons name="checkmark" size={18} color={theme.primaryText} />
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backLink}
                onPress={() => {
                  setOtpSent(false);
                  setOtp('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                activeOpacity={0.7}>
                <Text style={[styles.backLinkText, { color: theme.primary }]}>Use a different email</Text>
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
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 24,
    marginLeft: -4,
  },
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
