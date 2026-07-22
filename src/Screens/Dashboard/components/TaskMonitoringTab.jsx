import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CalendarDays, Check, ClipboardCheck, Filter } from 'lucide-react-native';
import DatePickerSheet from '../../../components/DatePickerSheet';
import Loader from '../../../components/Loader';
import { useToast } from '../../../context/ToastContext';
import * as action from '../../../Action/Dashboard/Dashboard_Action';
import { colors, radius, shadow, spacing, statusColors } from '../../../theme/theme';

const STATUS_OPTIONS = ['all', 'Approved', 'Pending', 'Not Approved'];
const STATUS_LABEL = {
  all: 'All',
  Approved: '✓ Approved',
  Pending: '⏳ Pending',
  'Not Approved': '✕ Not Approved',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDate = (d) => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// History is browsable across three years, the current one included.
const YEARS_BACK = 3;
const MAX_DATE = new Date();
const MIN_DATE = new Date(MAX_DATE.getFullYear() - (YEARS_BACK - 1), 0, 1);

const StatusBadge = ({ status }) => {
  const c = statusColors[status] || statusColors.Pending;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={[styles.badgeText, { color: c.fg }]}>{status}</Text>
    </View>
  );
};

const TaskMonitoringTab = () => {
  const { showToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const load = useCallback(
    async (date) => {
      setLoading(true);
      try {
        setHistory(await action.loadMonitoringHistory(date));
      } catch (e) {
        setHistory([]);
        showToast('Could not load task history', 'error');
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    load(selectedDate);
  }, [load, selectedDate]);

  const filtered = useMemo(
    () => action.filterByStatus(history, status),
    [history, status],
  );

  return (
    <View style={styles.wrap}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <View style={styles.dateGroup}>
          <Text style={styles.filterLabel}>Date</Text>
          <Pressable style={styles.dateDisplay} onPress={() => setDateOpen(true)}>
            <CalendarDays size={16} color={colors.primary} />
            <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
          </Pressable>
        </View>

        <View style={styles.statusGroup}>
          <Text style={styles.filterLabel}>Status</Text>
          <Pressable style={styles.filterBtn} onPress={() => setMenuOpen(true)}>
            <Filter size={16} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.empty}>
          <Loader inline size={54} />
        </View>
      ) : filtered.length > 0 ? (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.hTask}>Task</Text>
              <Text style={styles.hStatus}>Status</Text>
            </View>
          }
          stickyHeaderIndices={[0]}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={styles.snoBox}>
                  <Text style={styles.snoText}>#{item.sno}</Text>
                </View>
                <Text style={styles.taskText} numberOfLines={2}>
                  {item.task}
                </Text>
              </View>
              <StatusBadge status={item.status} />
            </View>
          )}
        />
      ) : (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <ClipboardCheck size={22} color={colors.muted} />
          </View>
          <Text style={styles.emptyTitle}>
            {history.length ? 'No matching tasks' : 'No tasks found'}
          </Text>
          <Text style={styles.emptyText}>
            {history.length
              ? 'No tasks match this status. Try a different filter.'
              : 'No tasks were submitted on this date.'}
          </Text>
        </View>
      )}

      <DatePickerSheet
        visible={dateOpen}
        value={selectedDate}
        minDate={MIN_DATE}
        maxDate={MAX_DATE}
        onSelect={setSelectedDate}
        onClose={() => setDateOpen(false)}
      />

      {/* Status filter menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt;
              return (
                <Pressable
                  key={opt}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={() => {
                    setStatus(opt);
                    setMenuOpen(false);
                  }}
                >
                  <Text style={[styles.menuText, active && styles.menuTextActive]}>
                    {STATUS_LABEL[opt]}
                  </Text>
                  {active && <Check size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
};

export default TaskMonitoringTab;

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  dateGroup: { flex: 1 },
  statusGroup: {},
  filterLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  dateText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.bg,
  },
  hTask: { fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 0.4 },
  hStatus: { fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.md, paddingRight: spacing.sm },
  snoBox: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  taskText: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '500' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, maxWidth: 280 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', paddingHorizontal: spacing.xxxl },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    ...shadow.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  menuItemPressed: { backgroundColor: colors.surfaceAlt },
  menuText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  menuTextActive: { color: colors.primary, fontWeight: '700' },
});
