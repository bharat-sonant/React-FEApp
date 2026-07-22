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
import { colors, radius, shadow, spacing } from '../theme/theme';

/**
 * Themed confirmation dialog — replaces the native Alert.
 *
 * Props:
 *  visible, title, message, confirmLabel, cancelLabel,
 *  onConfirm, onCancel, danger (red confirm), icon (React node)
 */
const ConfirmDialog = ({
  visible,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  danger = false,
  icon = null,
}) => {
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

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

  const accentBg = danger ? colors.dangerBg : colors.primarySoft;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Animated.View style={{ opacity }}>
          {/* Stop propagation so taps inside the card don't dismiss */}
          <Pressable>
            <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
              {icon != null && (
                <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>{icon}</View>
              )}

              <Text style={styles.title}>{title}</Text>
              {!!message && <Text style={styles.message}>{message}</Text>}

              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
                  onPress={onCancel}
                >
                  <Text style={styles.cancelText}>{cancelLabel}</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.confirmWrap, pressed && styles.pressed]}
                  onPress={onConfirm}
                >
                  {danger ? (
                    <View style={[styles.confirmBtn, { backgroundColor: colors.danger }]}>
                      <Text style={styles.confirmText}>{confirmLabel}</Text>
                    </View>
                  ) : (
                    <LinearGradient
                      colors={colors.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.confirmBtn}
                    >
                      <Text style={styles.confirmText}>{confirmLabel}</Text>
                    </LinearGradient>
                  )}
                </Pressable>
              </View>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

export default ConfirmDialog;

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
    maxWidth: 300,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    ...shadow.lg,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.text },
  confirmWrap: { flex: 1, borderRadius: radius.sm, overflow: 'hidden' },
  confirmBtn: {
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { fontSize: 14, fontWeight: '700', color: colors.white },
  pressed: { opacity: 0.85 },
});
