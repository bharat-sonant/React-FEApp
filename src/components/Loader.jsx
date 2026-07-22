import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, shadow, spacing } from '../theme/theme';

/**
 * Branded loader — the app logo inside a rotating dashed orbit with a pulsing
 * glow and an indeterminate progress bar.
 *
 * Usage:
 *   <Loader visible={busy} message="Uploading task…" />        // full-screen overlay
 *   <Loader inline size={72} />                                // inline spinner
 *   <Loader inline bare size={22} />                           // orbit only, for
 *                                                              // tight spots like
 *                                                              // buttons and tiles
 *
 * Every waiting state in the app uses this, so a spinner always looks the same.
 */
const Loader = ({
  visible = true,
  message,
  inline = false,
  bare = false,
  size = 96,
  transparent = false,
}) => {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return undefined;

    const loops = [
      // Continuous orbit rotation
      Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 2600,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
      // Breathing glow behind the logo
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 1100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
      // Indeterminate progress sweep
      Animated.loop(
        Animated.timing(bar, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ];

    Animated.timing(fade, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    loops.forEach((l) => l.start());

    return () => loops.forEach((l) => l.stop());
  }, [visible, spin, pulse, bar, fade]);

  if (!visible) return null;

  const orbit = size * 1.42;
  const glow = size * 1.15;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.12] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.05] });
  const barShift = bar.interpolate({ inputRange: [0, 1], outputRange: [-70, 70] });

  const content = (
    <Animated.View style={[styles.center, { opacity: fade }]}>
      <View style={[styles.stage, { width: orbit, height: orbit }]}>
        {/* Pulsing glow */}
        <Animated.View
          style={[
            styles.glow,
            {
              width: glow,
              height: glow,
              borderRadius: glow / 2,
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />

        {/* Rotating dashed orbit */}
        <Animated.View
          style={[
            styles.orbit,
            {
              width: orbit,
              height: orbit,
              borderRadius: orbit / 2,
              transform: [{ rotate }],
            },
          ]}
        />

        {/* Logo */}
        <View
          style={[
            styles.logoCircle,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Image
            source={require('../assets/images/AppLogo.png')}
            style={{ width: size * 0.78, height: size * 0.78 }}
            resizeMode="contain"
          />
        </View>
      </View>

      {/* Progress sweep — dropped in `bare` mode, where there is no room */}
      {!bare && (
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { transform: [{ translateX: barShift }] }]} />
        </View>
      )}

      {!bare && !!message && <Text style={styles.message}>{message}</Text>}
    </Animated.View>
  );

  if (inline) return content;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.overlay, transparent && styles.overlayDim]}>{content}</View>
    </Modal>
  );
};

export default Loader;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayDim: { backgroundColor: 'rgba(241, 245, 249, 0.92)' },
  center: { alignItems: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },

  glow: {
    position: 'absolute',
    backgroundColor: colors.primary,
  },
  orbit: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: colors.primaryLight,
    borderStyle: 'dashed',
    opacity: 0.45,
  },
  logoCircle: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.md,
  },

  track: {
    marginTop: spacing.xxl,
    width: 110,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    overflow: 'hidden',
  },
  fill: {
    width: 42,
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },

  message: {
    marginTop: spacing.lg,
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.3,
  },
});
