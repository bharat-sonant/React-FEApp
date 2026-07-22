import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { taskCardKey } from '../services/taskService';
import { colors, radius, shadow, spacing } from '../theme/theme';

// Cap the list so the sheet never swallows the whole screen.
const LIST_MAX_H = Math.round(Dimensions.get('window').height * 0.5);

/**
 * Task chooser for the "Add …" form.
 *
 * A bottom sheet rather than an inline dropdown: the list can be long, and
 * expanding it in place pushed the rest of the form up and down.
 *
 * Props: visible, title, options, selected, onSelect, onClose
 */
const TaskPickerSheet = ({ visible, title = 'Select Task', options = [], selected, onSelect, onClose }) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(400)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 10, tension: 70 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(400);
      opacity.setValue(0);
    }
  }, [visible, translateY, opacity]);

  const selectedKey = selected ? taskCardKey(selected) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={styles.backdropPress} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.md, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.count}>{options.length}</Text>
          </View>

          {options.length === 0 ? (
            <Text style={styles.empty}>No tasks available</Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {options.map((item) => {
                const key = taskCardKey(item);
                const active = key === selectedKey;
                return (
                  <Pressable
                    key={key}
                    style={({ pressed }) => [
                      styles.item,
                      active && styles.itemActive,
                      pressed && styles.itemPressed,
                    ]}
                    onPress={() => {
                      onSelect?.(item);
                      onClose?.();
                    }}
                  >
                    <Text style={[styles.itemText, active && styles.itemTextActive]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {active && (
                      <View style={styles.check}>
                        <Check size={13} color={colors.white} strokeWidth={3} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

export default TaskPickerSheet;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  backdropPress: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    ...shadow.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  title: { fontSize: 13, fontWeight: '600', color: colors.muted },
  count: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  empty: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  list: { maxHeight: LIST_MAX_H },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceAlt,
  },
  itemActive: { backgroundColor: colors.primaryTint },
  itemPressed: { opacity: 0.7 },
  itemText: { flex: 1, fontSize: 14, color: colors.text },
  itemTextActive: { color: colors.primary, fontWeight: '600' },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
