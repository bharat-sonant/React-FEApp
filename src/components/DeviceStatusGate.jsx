import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import {
  Check,
  MapPin,
  SignalHigh,
  WifiOff,
  X,
} from 'lucide-react-native';
import { subscribeDeviceStatus } from '../services/deviceStatusService';
import { colors, radius, shadow, spacing } from '../theme/theme';

/**
 * Full-screen block while the internet or location is switched off, and hides
 * itself the instant both come back on. Blocking (not a banner) is deliberate:
 * with no connection every Firebase read fails, and a task can't be recorded
 * without location.
 */

const StatusRow = ({ Icon, label, ok, hint }) => (
  <View style={[styles.row, ok ? styles.rowOk : styles.rowBad]}>
    <View style={[styles.rowIcon, { backgroundColor: ok ? colors.successBg : colors.dangerBg }]}>
      <Icon size={18} color={ok ? colors.success : colors.danger} />
    </View>
    <View style={styles.rowText}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowHint, { color: ok ? colors.success : colors.danger }]}>
        {ok ? 'On' : hint}
      </Text>
    </View>
    <View style={[styles.pill, { backgroundColor: ok ? colors.success : colors.danger }]}>
      {ok ? (
        <Check size={12} color={colors.white} strokeWidth={3.5} />
      ) : (
        <X size={12} color={colors.white} strokeWidth={3.5} />
      )}
    </View>
  </View>
);

const DeviceStatusGate = () => {
  const [status, setStatus] = useState({ network: true, location: true });
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeDeviceStatus(setStatus), []);

  const netOk = !!status.network;
  const gpsOk = !!status.location;
  const visible = !netOk || !gpsOk;

  useEffect(() => {
    if (!visible) return undefined;
    const ripple = (val, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const loops = [ripple(ring1, 0), ripple(ring2, 1100), bob];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [visible, ring1, ring2, floatY]);

  if (!visible) return null;

  const bothOff = !netOk && !gpsOk;
  const primaryNet = !netOk; // net breaks everything, lead with it
  const Icon = primaryNet ? WifiOff : MapPin;
  const title = bothOff
    ? 'Connection & Location Off'
    : primaryNet
    ? 'No Internet Connection'
    : 'Location is Turned Off';
  const subtitle = bothOff
    ? 'Turn both back on to continue with your tasks.'
    : primaryNet
    ? 'Your tasks can’t load or submit without an active connection.'
    : 'Location must be on so your tasks are recorded accurately.';

  const rippleStyle = (val) => ({
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
  });
  const bob = { transform: [{ translateY: floatY.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] };

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

        {/* Soft brand gradient top so it reads as part of the app */}
        <LinearGradient
          colors={[colors.primaryDark, colors.primary, colors.bg]}
          locations={[0, 0.35, 1]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <Text style={styles.brand}>FIELD EXECUTIVE</Text>

          <View style={styles.hero}>
            {/* Ripple rings */}
            <Animated.View style={[styles.ripple, rippleStyle(ring1)]} />
            <Animated.View style={[styles.ripple, rippleStyle(ring2)]} />
            <Animated.View style={[styles.iconWrap, bob]}>
              <Icon size={44} color={colors.white} strokeWidth={2} />
            </Animated.View>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.rows}>
              <StatusRow Icon={SignalHigh} label="Internet" ok={netOk} hint="Turn on mobile data or Wi-Fi" />
              <StatusRow Icon={MapPin} label="Location" ok={gpsOk} hint="Turn on location / GPS" />
            </View>

            <View style={styles.waiting}>
              <View style={styles.waitingDot} />
              <Text style={styles.waitingText}>Waiting… this closes automatically once both are on</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

export default DeviceStatusGate;

const HERO = 150;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl },
  brand: {
    marginTop: spacing.xl,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.9)',
  },
  hero: {
    width: HERO,
    height: HERO,
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadow.lg,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
    maxWidth: 300,
  },
  rows: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
  },
  rowOk: { borderColor: 'rgba(16,185,129,0.28)' },
  rowBad: { borderColor: 'rgba(239,68,68,0.24)' },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  rowHint: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  pill: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  waitingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.warning,
  },
  waitingText: { flex: 1, fontSize: 11, color: colors.faint, lineHeight: 16 },
});
