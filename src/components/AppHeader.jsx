import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MoreVertical } from 'lucide-react-native';
import { colors, shadow, spacing } from '../theme/theme';

/**
 * Gradient app header with optional back button and overflow menu.
 * menuItems: [{ label, icon?, onPress, danger? }]
 */
const AppHeader = ({
  title,
  subtitle,
  showBack = false,
  onBack,
  menuItems = [],
  right = null,
}) => {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <LinearGradient
      colors={colors.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
    >
      <View style={styles.side}>
        {showBack && (
          <Pressable hitSlop={10} onPress={onBack} style={styles.iconBtn}>
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
        )}
      </View>

      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      <View style={[styles.side, styles.sideRight]}>
        {right}
        {menuItems.length > 0 && (
          <Pressable hitSlop={10} onPress={() => setMenuOpen(true)} style={styles.iconBtn}>
            <MoreVertical size={22} color={colors.white} />
          </Pressable>
        )}
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, { top: insets.top + 48 }]}>
            {menuItems.map((item, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  setMenuOpen(false);
                  item.onPress?.();
                }}
              >
                {item.icon}
                <Text style={[styles.menuLabel, item.danger && { color: colors.danger }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
};

export default AppHeader;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadow.md,
  },
  side: { minWidth: 40, justifyContent: 'center' },
  sideRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  center: { flex: 1, alignItems: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    marginTop: 2,
  },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.xs,
    minWidth: 190,
    ...shadow.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  menuItemPressed: { backgroundColor: colors.surfaceAlt },
  menuLabel: { fontSize: 14, fontWeight: '500', color: colors.text },
});
