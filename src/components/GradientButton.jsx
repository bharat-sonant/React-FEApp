import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Loader from './Loader';
import LinearGradient from 'react-native-linear-gradient';
import { colors, radius, shadow, spacing } from '../theme/theme';

/**
 * Primary call-to-action button with the brand gradient.
 */
const GradientButton = ({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon = null,
  loadingLabel = 'Please wait...',
  style,
}) => {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.wrap,
        shadow.brand,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {loading ? (
          <View style={styles.row}>
            <Loader inline bare size={22} />
            <Text style={styles.label}>{loadingLabel}</Text>
          </View>
        ) : (
          <View style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            {icon}
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
};

export default GradientButton;

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  gradient: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.6 },
});
