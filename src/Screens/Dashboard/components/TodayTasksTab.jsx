import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  RefreshCw,
} from 'lucide-react-native';
import LinearGradient from 'react-native-linear-gradient';
import Loader from '../../../components/Loader';
import { visibleTasks } from '../../../Action/Dashboard/Dashboard_Action';
import { taskCardKey } from '../../../services/taskService';
import { colors, radius, shadow, spacing } from '../../../theme/theme';

// Tap a tile to filter the list to those tasks. Selection is shown subtly —
// just an accent border, no fill, no dot.
const StatCard = ({ Icon, iconColor, iconBg, label, value, valueColor, active, accent, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.statCard,
      active && { borderColor: accent },
      pressed && styles.statCardPressed,
    ]}
  >
    <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
      <Icon size={18} color={iconColor} />
    </View>
    <View style={styles.statTextWrap}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  </Pressable>
);

/**
 * Three states, in order of the work's real progress:
 *   pending    → Pick arrow
 *   uploading  → submitted, but media still going up. Deliberately NOT shown as
 *                "Completed": the task isn't fully saved yet and the user must
 *                not walk away thinking it is.
 *   completed  → record written and every file uploaded
 */
const TaskCard = ({ task, onPress, progress = null }) => {
  const isPriority = task.type === 'Priority Task';
  const submitted = !!task.done;
  const uploading = !!progress;
  const done = submitted && !uploading;
  return (
    <Pressable
      onPress={submitted ? undefined : onPress}
      disabled={submitted}
      style={({ pressed }) => [
        styles.card,
        isPriority && !submitted && styles.priorityCard,
        done && styles.cardDone,
        pressed && !submitted && styles.cardPressed,
      ]}
    >
      <View
        style={[
          styles.sideBar,
          done
            ? styles.sideBarDone
            : uploading
            ? styles.sideBarUploading
            : isPriority
            ? styles.sideBarHigh
            : styles.sideBarNormal,
        ]}
      />
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, done && styles.cardTitleDone]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={styles.cardMeta}>
          <View style={[styles.tag, isPriority ? styles.tagRed : styles.tagGreen]}>
            <Text style={[styles.tagText, isPriority ? styles.tagTextRed : styles.tagTextGreen]}>
              {task.type}
            </Text>
          </View>
          {uploading ? (
            <View style={styles.uploadTag}>
              <Text style={styles.uploadTagText}>
                Uploading {progress.current} / {progress.total}
              </Text>
            </View>
          ) : (
            done && (
              <View style={styles.doneTag}>
                <CheckCircle2 size={11} color={colors.success} />
                <Text style={styles.doneTagText}>Completed</Text>
              </View>
            )
          )}
        </View>
      </View>
      {done ? (
        <View style={styles.doneBtn}>
          <CheckCircle2 size={20} color={colors.success} />
        </View>
      ) : uploading ? (
        <View style={styles.uploadBtn}>
          <Loader inline bare size={22} />
        </View>
      ) : (
        <LinearGradient colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pickBtn}>
          <ChevronRight size={16} color={colors.white} />
        </LinearGradient>
      )}
    </Pressable>
  );
};

const TodayTasksTab = ({
  tasks = [], // full marked list (done flags set)
  stats,
  loading = false,
  refreshing = false,
  localDone,
  uploadProgress,
  onRefresh,
  onPickTask,
}) => {
  // Which tile is selected. Pending is the initial view; there is always one
  // selected (no cleared/all state).
  const [filter, setFilter] = React.useState('pending');
  // Spin the sync icon while a manual refresh is running.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!refreshing) {
      spin.stopAnimation();
      spin.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Which tasks to show:
  //   pending   → pending + tasks finished this session (so a just-submitted one
  //               lingers as "Completed" before dropping off)
  //   completed → every task done today
  const viewTasks = useMemo(() => {
    if (filter === 'completed') return tasks.filter((t) => t.done);
    return visibleTasks(tasks, localDone, uploadProgress);
  }, [filter, tasks, localDone, uploadProgress]);

  const sorted = useMemo(
    () =>
      [...viewTasks].sort((a, b) => {
        if (a.type === 'Priority Task' && b.type !== 'Priority Task') return -1;
        if (a.type !== 'Priority Task' && b.type === 'Priority Task') return 1;
        return 0;
      }),
    [viewTasks],
  );

  const completed = stats?.completed ?? 0;
  const pending = stats?.pending ?? 0;

  const sectionTitle = filter === 'completed' ? 'Completed Today' : 'Pending Tasks';

  return (
    <View style={styles.container}>
      {/* Fixed header — stats + section title stay pinned, do not scroll */}
      <View style={styles.fixedStats}>
        <View style={styles.statsRow}>
          <StatCard
            Icon={CheckCircle2}
            iconColor={colors.success}
            iconBg={colors.successBg}
            label="COMPLETED"
            value={String(completed).padStart(2, '0')}
            active={filter === 'completed'}
            accent="rgba(16, 185, 129, 0.35)"
            onPress={() => setFilter('completed')}
          />
          <StatCard
            Icon={ClipboardList}
            iconColor={colors.danger}
            iconBg={colors.dangerBg}
            label="PENDING"
            value={String(pending).padStart(2, '0')}
            valueColor={colors.danger}
            active={filter === 'pending'}
            accent="rgba(239, 68, 68, 0.35)"
            onPress={() => setFilter('pending')}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{sectionTitle}</Text>
          <View style={styles.headerRight}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{sorted.length}</Text>
            </View>
            <Pressable
              style={styles.syncBtn}
              onPress={onRefresh}
              disabled={refreshing}
              hitSlop={8}
            >
              <Animated.View style={{ transform: [{ rotate }] }}>
                <RefreshCw size={16} color={colors.primary} />
              </Animated.View>
            </Pressable>
          </View>
        </View>
      </View>

      <FlatList
        data={sorted}
        extraData={uploadProgress}
        keyExtractor={taskCardKey}
        contentContainerStyle={sorted.length ? styles.listContent : styles.emptyContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            progress={uploadProgress?.get(taskCardKey(item)) || null}
            onPress={() => onPickTask(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <Loader inline size={54} />
            ) : (
              <>
                <View style={styles.emptyIcon}>
                  <ClipboardList size={22} color={colors.muted} />
                </View>
                <Text style={styles.emptyTitle}>
                  {filter === 'completed'
                    ? 'No completed tasks yet'
                    : filter === 'pending'
                    ? 'No pending tasks'
                    : 'No tasks assigned'}
                </Text>
                <Text style={styles.emptyText}>
                  {filter === 'completed'
                    ? 'Tasks you finish today will show up here.'
                    : filter === 'pending'
                    ? 'You have completed all your tasks. Great work!'
                    : 'You have no tasks for today. Please contact your administrator.'}
                </Text>
              </>
            )}
          </View>
        }
      />
    </View>
  );
};

export default TodayTasksTab;

const styles = StyleSheet.create({
  container: { flex: 1 },
  fixedStats: {
    paddingHorizontal: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 110,
  },
  emptyContent: { flexGrow: 1, paddingHorizontal: spacing.lg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
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
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  statCardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  statTextWrap: { flex: 1 },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: {
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  pillText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  syncBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  priorityCard: {
    borderColor: 'rgba(239, 68, 68, 0.18)',
    backgroundColor: '#FFFBFB',
  },
  cardPressed: { transform: [{ scale: 0.99 }], opacity: 0.92 },
  sideBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: spacing.md,
  },
  sideBarHigh: { backgroundColor: colors.danger },
  sideBarNormal: { backgroundColor: colors.primaryLight },
  sideBarDone: { backgroundColor: colors.success },
  sideBarUploading: { backgroundColor: colors.primary },
  cardDone: { backgroundColor: colors.surface },
  cardInfo: { flex: 1, gap: spacing.sm },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  cardTitleDone: { color: colors.muted },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  tagGreen: { backgroundColor: colors.primaryTint },
  tagRed: { backgroundColor: 'rgba(239, 68, 68, 0.08)' },
  tagText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tagTextGreen: { color: colors.primary },
  tagTextRed: { color: colors.danger },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  timeText: { fontSize: 10, color: colors.muted, fontWeight: '500' },
  pickBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  doneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  doneTagText: { fontSize: 9, fontWeight: '700', color: colors.success, letterSpacing: 0.4 },
  uploadTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  uploadTagText: { fontSize: 9, fontWeight: '700', color: colors.primary, letterSpacing: 0.4 },
  uploadBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    backgroundColor: colors.primarySoft,
  },
  doneBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    backgroundColor: colors.successBg,
  },
});
