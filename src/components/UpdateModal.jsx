import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { ArrowDownToLine, Rocket, TriangleAlert } from 'lucide-react-native';
import { colors, radius, shadow, spacing } from '../theme/theme';

/**
 * Themed app-update dialog (matches the app's emerald/slate look — no native
 * Alert). Three shapes:
 *   type 'js'      → "Update Now" (seamless), shows a progress bar while applying
 *   type 'native'  → "Version Expired" mandatory block; the button exits the app
 *   error          → red notice + retry
 *
 * Props: visible, type, version, progress (0-100|null), downloading, error,
 *        onUpdate, mandatory
 */
const UpdateModal = ({
  visible,
  type = 'js',
  version,
  progress = null,
  downloading = false,
  error = '',
  onUpdate,
  mandatory = false,
}) => {
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(0.9);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  useEffect(() => {
    Animated.timing(bar, {
      toValue: Math.max(0, Math.min(100, progress || 0)),
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [progress, bar]);

  const isNative = type === 'native';
  const Icon = error ? TriangleAlert : isNative ? Rocket : ArrowDownToLine;
  const accentBg = error ? colors.dangerBg : colors.primarySoft;
  const iconColor = error ? colors.danger : colors.primary;

  const title = error ? 'Update Failed' : isNative ? 'New Version Required' : 'Update Available';
  const message = error
    ? error
    : isNative
    ? 'A new version of the app is available. Please install the latest APK to continue.'
    : 'A new update is ready. Update now to get the latest improvements.';
  const buttonLabel = downloading ? `Updating… ${progress ?? 0}%` : isNative ? 'Exit & Update' : 'Update Now';

  const width = bar.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
            <Icon size={26} color={iconColor} />
          </View>

          <Text style={styles.title}>{title}</Text>

          {!!version && !error && (
            <View style={styles.versionChip}>
              <Text style={styles.versionText}>v{version}</Text>
            </View>
          )}

          <Text style={styles.message}>{message}</Text>

          {downloading && (
            <View style={styles.progressWrap}>
              <View style={styles.track}>
                <Animated.View style={[styles.fill, { width }]} />
              </View>
              <Text style={styles.percent}>{progress ?? 0}%</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.btnWrap, pressed && !downloading && styles.pressed]}
            onPress={downloading ? undefined : onUpdate}
            disabled={downloading}
          >
            {isNative ? (
              <View style={[styles.btn, { backgroundColor: colors.danger }, downloading && styles.btnDisabled]}>
                <Text style={styles.btnText}>{buttonLabel}</Text>
              </View>
            ) : (
              <LinearGradient
                colors={downloading ? [colors.muted, colors.muted] : colors.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.btn}
              >
                <Text style={styles.btnText}>{buttonLabel}</Text>
              </LinearGradient>
            )}
          </Pressable>

          {(mandatory || isNative) && !downloading && (
            <Text style={styles.footNote}>This update is required to continue.</Text>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

export default UpdateModal;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    ...shadow.lg,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  versionChip: {
    marginTop: spacing.sm,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  versionText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  message: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.md,
  },
  progressWrap: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  percent: { fontSize: 12, fontWeight: '700', color: colors.primary, minWidth: 38, textAlign: 'right' },
  btnWrap: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  btn: { height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.7 },
  btnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  pressed: { opacity: 0.9 },
  footNote: { fontSize: 11, color: colors.faint, marginTop: spacing.md, textAlign: 'center' },
});
