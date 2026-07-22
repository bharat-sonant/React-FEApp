import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, Eye, EyeOff, Lock, User } from 'lucide-react-native';
import GradientButton from '../../components/GradientButton';
import Loader from '../../components/Loader';
import { useToast } from '../../context/ToastContext';
import * as action from '../../Action/Login/Login_Action';
import { colors, radius, shadow, spacing } from '../../theme/theme';

const LoginScreen = ({ navigation }) => {
  const { showToast } = useToast();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(null);

  const handleLogin = async () => {
    const message = action.validateCredentials({ userId, password });
    if (message) return setError(message);

    setError('');
    setLoading(true);
    try {
      const res = await action.performLogin({ userId, password });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      showToast(res.message, 'success');
      // Clear the stack so back can't return to login
      navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    } catch (e) {
      setError(e?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Decorative background */}
      <View style={styles.bgOrbTop} />
      <View style={styles.bgOrbBottom} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={styles.brand}>
            <View style={styles.logoCircle}>
              <Image
                source={require('../../assets/images/AppLogo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.title}>Field Executive</Text>
            <Text style={styles.subtitle}>
              <Text style={styles.subtitleBold}>WeVOIS</Text> Labs Management Portal
            </Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* User ID */}
            <Text style={styles.label}>User ID</Text>
            <View style={[styles.inputWrap, focused === 'uid' && styles.inputWrapFocused]}>
              <User size={18} color={focused === 'uid' ? colors.primary : colors.faint} />
              <TextInput
                style={styles.input}
                placeholder="e.g. AJM101"
                placeholderTextColor={colors.faint}
                value={userId}
                onChangeText={(v) => {
                  setUserId(action.formatUserId(v));
                  if (error) setError('');
                }}
                onFocus={() => setFocused('uid')}
                onBlur={() => setFocused(null)}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <Text style={[styles.label, { marginTop: spacing.lg }]}>Password</Text>
            <View style={[styles.inputWrap, focused === 'pwd' && styles.inputWrapFocused]}>
              <Lock size={18} color={focused === 'pwd' ? colors.primary : colors.faint} />
              <TextInput
                style={styles.input}
                placeholder="Enter Password"
                placeholderTextColor={colors.faint}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (error) setError('');
                }}
                onFocus={() => setFocused('pwd')}
                onBlur={() => setFocused(null)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <Pressable hitSlop={8} onPress={() => setShowPassword((s) => !s)}>
                {showPassword ? (
                  <EyeOff size={18} color={colors.muted} />
                ) : (
                  <Eye size={18} color={colors.muted} />
                )}
              </Pressable>
            </View>

            <GradientButton
              label="LOGIN"
              icon={<ArrowRight size={20} color={colors.white} />}
              loading={loading}
              onPress={handleLogin}
              style={{ marginTop: spacing.xl }}
            />
          </View>

          <Text style={styles.copy}>
            © 2026 WeVOIS Labs Pvt. Ltd. All rights reserved.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Loader visible={loading} message="Signing you in…" transparent />
    </SafeAreaView>
  );
};

export default LoginScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },
  bgOrbTop: {
    position: 'absolute',
    top: -110,
    right: -70,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.primary,
    opacity: 0.08,
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: -130,
    left: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: colors.primaryLight,
    opacity: 0.07,
  },
  brand: { alignItems: 'center', marginBottom: spacing.xxl },
  logoCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadow.md,
  },
  logo: { width: 84, height: 84 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 4 },
  subtitleBold: { fontWeight: '700', color: colors.primary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.md,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 50,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceAlt,
  },
  inputWrapFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: colors.ink,
    padding: 0,
  },
  copy: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.faint,
    marginTop: spacing.xxl,
  },
});
