import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors, radius, shadow, spacing } from '../theme/theme';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const YEARS_PER_PAGE = 12;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** First year of the page a given year sits on, so paging is stable. */
const yearPageStart = (year) => Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;

/**
 * Themed calendar, matching the app's sheets rather than the OS date dialog
 * (which ignores our palette entirely).
 *
 * Three drill-down levels so an old date is a few taps away instead of dozens
 * of month-by-month steps:
 *   days   — tap the "July 2026" header to zoom out
 *   months — tap the "2026" header to zoom out further
 *   years  — pick a year, then a month, then a day
 *
 * Dates outside [minDate, maxDate] are disabled at every level — there is
 * nothing to show for a day that hasn't happened yet, and history is bounded.
 *
 * Props: visible, value (Date), minDate (Date), maxDate (Date), onSelect(Date), onClose
 */
const DatePickerSheet = ({ visible, value, minDate, maxDate, onSelect, onClose }) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(400)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const selected = useMemo(() => (value ? startOfDay(value) : null), [value]);
  const max = useMemo(() => (maxDate ? startOfDay(maxDate) : null), [maxDate]);
  const min = useMemo(() => (minDate ? startOfDay(minDate) : null), [minDate]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const [mode, setMode] = useState('days'); // 'days' | 'months' | 'years'
  // The month on screen, which the user can page through independently.
  const [view, setView] = useState(() => {
    const base = value || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!visible) {
      translateY.setValue(400);
      opacity.setValue(0);
      return;
    }
    // Re-open on the selected date's month, at the day level.
    const base = value || new Date();
    setView(new Date(base.getFullYear(), base.getMonth(), 1));
    setMode('days');
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 10, tension: 70 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    // `value` is intentionally read only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const maxYear = max ? max.getFullYear() : null;
  const maxMonth = max ? max.getMonth() : null;
  const minYear = min ? min.getFullYear() : null;
  const minMonth = min ? min.getMonth() : null;

  const pageStart = yearPageStart(year);

  // With both bounds set the whole range fits on one screen (the app allows the
  // current year plus three back), so the year level needs no paging at all.
  const boundedYears = Boolean(min && max);
  const yearList = useMemo(() => {
    if (min && max) {
      const out = [];
      for (let y = min.getFullYear(); y <= max.getFullYear(); y += 1) out.push(y);
      return out;
    }
    return Array.from({ length: YEARS_PER_PAGE }, (_, i) => pageStart + i);
  }, [min, max, pageStart]);

  // Leading blanks so the 1st lands under its weekday, then the month's days.
  const dayCells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out = new Array(firstWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d += 1) out.push(new Date(year, month, d));
    return out;
  }, [year, month]);

  const dayDisabled = (d) => Boolean((max && d > max) || (min && d < min));
  const monthDisabled = (m) =>
    Boolean(
      (max && (year > maxYear || (year === maxYear && m > maxMonth))) ||
        (min && (year < minYear || (year === minYear && m < minMonth))),
    );
  const yearDisabled = (y) => Boolean((max && y > maxYear) || (min && y < minYear));

  // What the two header arrows step through, per level.
  const step =
    mode === 'days'
      ? { back: () => setView(new Date(year, month - 1, 1)), fwd: () => setView(new Date(year, month + 1, 1)) }
      : mode === 'months'
      ? { back: () => setView(new Date(year - 1, month, 1)), fwd: () => setView(new Date(year + 1, month, 1)) }
      : {
          back: () => setView(new Date(pageStart - YEARS_PER_PAGE, month, 1)),
          fwd: () => setView(new Date(pageStart + YEARS_PER_PAGE, month, 1)),
        };

  const canGoNext =
    mode === 'years'
      ? !boundedYears && (!max || pageStart + YEARS_PER_PAGE <= maxYear)
      : !max ||
        (mode === 'days' ? new Date(year, month + 1, 1) <= max : year + 1 <= maxYear);

  const canGoPrev =
    mode === 'years'
      ? !boundedYears
      : !min ||
        // last day of the previous month still inside the range?
        (mode === 'days' ? new Date(year, month, 0) >= min : year - 1 >= minYear);

  const headerLabel =
    mode === 'days'
      ? `${MONTHS[month]} ${year}`
      : mode === 'months'
      ? String(year)
      : `${yearList[0]} – ${yearList[yearList.length - 1]}`;

  // Tapping the header zooms out one level; years is the top, so it goes back.
  const onHeaderPress = () =>
    setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'days');

  const pickDay = (d) => {
    onSelect?.(d);
    onClose?.();
  };

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

          {/* Selected date, so the choice is always readable at a glance */}
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>SELECTED DATE</Text>
            <Text style={styles.previewValue}>
              {selected
                ? `${WEEKDAY_NAMES[selected.getDay()]}, ${selected.getDate()} ${MONTHS_SHORT[selected.getMonth()]} ${selected.getFullYear()}`
                : '—'}
            </Text>
          </View>

          {/* Header: arrows step the current level, the label zooms out */}
          <View style={styles.header}>
            <Pressable
              style={[styles.navBtn, !canGoPrev && styles.navBtnOff]}
              onPress={() => canGoPrev && step.back()}
              disabled={!canGoPrev}
              hitSlop={6}
            >
              <ChevronLeft size={18} color={canGoPrev ? colors.primary : colors.faint} />
            </Pressable>

            <Pressable style={styles.headerLabelBtn} onPress={onHeaderPress} hitSlop={6}>
              <Text style={styles.monthText}>{headerLabel}</Text>
              <ChevronDown
                size={15}
                color={colors.primary}
                style={mode !== 'days' && styles.headerChevronUp}
              />
            </Pressable>

            <Pressable
              style={[styles.navBtn, !canGoNext && styles.navBtnOff]}
              onPress={() => canGoNext && step.fwd()}
              disabled={!canGoNext}
              hitSlop={6}
            >
              <ChevronRight size={18} color={canGoNext ? colors.primary : colors.faint} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {mode === 'days' && (
              <>
                <View style={styles.weekRow}>
                  {WEEKDAYS.map((w, i) => (
                    <Text key={`${w}-${i}`} style={styles.weekday}>
                      {w}
                    </Text>
                  ))}
                </View>
                <View style={styles.grid}>
                  {dayCells.map((d, i) => {
                    if (!d) return <View key={`blank-${i}`} style={styles.dayCell} />;
                    const disabled = dayDisabled(d);
                    const active = sameDay(d, selected);
                    const isToday = sameDay(d, today);
                    const weekend = d.getDay() === 0;
                    return (
                      <Pressable
                        key={d.toISOString()}
                        style={styles.dayCell}
                        onPress={() => !disabled && pickDay(d)}
                        disabled={disabled}
                      >
                        <View
                          style={[
                            styles.day,
                            isToday && !active && styles.dayToday,
                            active && styles.dayActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayText,
                              weekend && styles.dayTextWeekend,
                              isToday && !active && styles.dayTextToday,
                              active && styles.dayTextActive,
                              disabled && styles.dayTextOff,
                            ]}
                          >
                            {d.getDate()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {mode === 'months' && (
              <View style={styles.grid}>
                {MONTHS_SHORT.map((label, m) => {
                  const disabled = monthDisabled(m);
                  const active = selected && selected.getFullYear() === year && selected.getMonth() === m;
                  return (
                    <Pressable
                      key={label}
                      style={styles.chipCell}
                      disabled={disabled}
                      onPress={() => {
                        setView(new Date(year, m, 1));
                        setMode('days');
                      }}
                    >
                      <View style={[styles.chip, active && styles.chipActive]}>
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                            disabled && styles.chipTextOff,
                          ]}
                        >
                          {label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {mode === 'years' && (
              <View style={styles.grid}>
                {yearList.map((y) => {
                  const disabled = yearDisabled(y);
                  const active = selected && selected.getFullYear() === y;
                  return (
                    <Pressable
                      key={y}
                      style={styles.chipCell}
                      disabled={disabled}
                      onPress={() => {
                        setView(new Date(y, month, 1));
                        setMode('months');
                      }}
                    >
                      <View style={[styles.chip, active && styles.chipActive]}>
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                            disabled && styles.chipTextOff,
                          ]}
                        >
                          {y}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable style={styles.todayBtn} onPress={() => pickDay(startOfDay(new Date()))}>
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

export default DatePickerSheet;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
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
  preview: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  previewLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.8,
    opacity: 0.75,
  },
  previewValue: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primaryDark,
    marginTop: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnOff: { backgroundColor: colors.surfaceAlt },
  headerLabelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
  },
  headerChevronUp: { transform: [{ rotate: '180deg' }] },
  monthText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  // Fixed height so the sheet doesn't jump between day/month/year grids.
  body: { minHeight: 268 },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: { backgroundColor: colors.primary, ...shadow.brand },
  dayToday: { borderWidth: 1.5, borderColor: colors.primaryLight },
  dayText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  dayTextWeekend: { color: colors.muted },
  dayTextToday: { color: colors.primary, fontWeight: '700' },
  dayTextActive: { color: colors.white, fontWeight: '700' },
  dayTextOff: { color: colors.faint },
  // Month / year tiles: 3 per row
  chipCell: {
    width: `${100 / 3}%`,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  chip: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  chipTextActive: { color: colors.white, fontWeight: '700' },
  chipTextOff: { color: colors.faint },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  todayBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.text },
});
