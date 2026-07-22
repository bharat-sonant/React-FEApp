import React, { useEffect, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {
  ClipboardCheck,
  LayoutGrid,
  MapPin,
  Plus,
  Power,
  X,
} from 'lucide-react-native';
import TodayTasksTab from './components/TodayTasksTab';
import TaskMonitoringTab from './components/TaskMonitoringTab';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../context/ToastContext';
import * as action from '../../Action/Dashboard/Dashboard_Action';
import { subscribeUploads } from '../../services/uploadQueueService';
import { useLocation } from '../../context/LocationContext';
import { colors, radius, shadow, spacing } from '../../theme/theme';

// How long a finished task keeps its "Completed" tag before leaving the list.
// Long enough to register as confirmation, short enough not to clutter.
const COMPLETED_LINGER_MS = 2000;

const TABS = [
  { key: 'today', label: "Today's Task", Icon: LayoutGrid },
  { key: 'monitoring', label: 'Task Monitoring', Icon: ClipboardCheck },
];

const DashboardScreen = ({ navigation, route }) => {
  const { showToast } = useToast();
  const { startTracking, stopTracking } = useLocation();
  const [tab, setTab] = useState('today');
  const [user, setUser] = useState(null);
  const [assigned, setAssigned] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [loading, setLoading] = useState(true); // first load only
  const [refreshing, setRefreshing] = useState(false); // manual sync
  const [fabOpen, setFabOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // cardKey → { current, total } for files still uploading in the background.
  const [uploadProgress, setUploadProgress] = useState(new Map());
  // Tasks completed in this session — kept visible until the next server load.
  const [localDone, setLocalDone] = useState(new Set());
  // Added (unassigned) tasks submitted this session, shown as their own cards.
  const [localTasks, setLocalTasks] = useState([]);
  const fabAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    action.loadUser().then((u) => u && setUser(u));
  }, []);

  // The dashboard is the logged-in home, so tracking runs while the user is here.
  useEffect(() => {
    startTracking();
  }, [startTracking]);

  // Background upload progress, shown as a chip on each task's card.
  useEffect(() => subscribeUploads(setUploadProgress), []);

  // Once a task's uploads finish, let its "Completed" tag sit for a moment as
  // confirmation, then drop it from the list.
  const removalTimers = React.useRef(new Map());
  // Tasks we have actually watched upload. The queue reports asynchronously, so
  // right after a submit the progress map is briefly empty — without this we
  // would read "not uploading" and start the removal countdown before the first
  // file even begins, dropping the card mid-upload.
  const seenUploading = React.useRef(new Set());
  useEffect(() => {
    const timers = removalTimers.current;
    const seen = seenUploading.current;
    uploadProgress.forEach((_, key) => seen.add(key));

    localDone.forEach((key) => {
      // Wait until we have seen this task upload AND finish. If its uploads
      // never showed up, leave the card alone — sync will clear it.
      if (uploadProgress.has(key) || !seen.has(key)) {
        const pending = timers.get(key);
        if (pending) {
          clearTimeout(pending);
          timers.delete(key);
        }
        return;
      }
      if (timers.has(key)) return;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          setLocalDone((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          setLocalTasks((prev) => prev.filter((t) => action.taskCardKey(t) !== key));
        }, COMPLETED_LINGER_MS),
      );
    });
  }, [localDone, uploadProgress]);

  // Never leave a timer running after the screen goes away.
  useEffect(() => {
    const timers = removalTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // TaskExecution hands back the task it just submitted — mark it done locally
  // so the card updates instantly, with no round trip.
  const submitted = route?.params?.submitted;
  useEffect(() => {
    if (!submitted?.id) return;
    const key = action.taskCardKey(submitted);
    console.log('[dashboard] task submitted locally →', key, submitted.title);
    setCompleted((prev) => action.addLocalCompletion(prev, submitted));
    setLocalDone((prev) => new Set(prev).add(key));
    // Added tasks aren't in `assigned`; keep our own copy so they get a card.
    // withLocalTasks drops it again if it turns out to be an assigned task.
    setLocalTasks((prev) =>
      prev.some((t) => action.taskCardKey(t) === key) ? prev : [submitted, ...prev],
    );
    navigation.setParams({ submitted: undefined });
  }, [submitted, navigation]);

  const loadTasks = React.useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const { assigned: a, completed: c } = await action.loadDashboard();
        setAssigned(a);
        setCompleted(c);
        if (isManual) {
          // Only an explicit sync clears completed tasks off the list. The
          // automatic load on mount must not, or it would wipe a card whose
          // upload is still running (its Firebase read resolves after the
          // submit is recorded).
          setLocalDone(new Set());
          setLocalTasks([]);
          showToast('Tasks updated', 'success');
        }
      } catch (e) {
        showToast('Could not load your tasks', 'error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast],
  );

  // Load once on mount. Manual sync (or task submit) triggers a refresh.
  useEffect(() => {
    loadTasks(false);
  }, [loadTasks]);

  useEffect(() => {
    Animated.spring(fabAnim, {
      toValue: fabOpen ? 1 : 0,
      useNativeDriver: true,
      friction: 7,
      tension: 80,
    }).start();
  }, [fabOpen, fabAnim]);

  const doLogout = async () => {
    setShowLogoutConfirm(false);
    await stopTracking();
    await action.performLogout();
    showToast('Logged out', 'info');
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const openTaskForm = (mode, taskData = null) => {
    setFabOpen(false);
    navigation.navigate('TaskExecution', { mode, taskData });
  };

  const fabRotate = fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] });

  // Assigned tasks plus anything added via the FAB this session.
  const allTasks = action.withLocalTasks(assigned, localTasks);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

      {/* Header */}
      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.topBar}>
            <View style={styles.userMeta}>
              <Text style={styles.greeting}>Welcome back,</Text>
              <Text style={styles.userName} numberOfLines={2} ellipsizeMode="tail">
                {user?.employeeName || 'Executive'}
              </Text>
              <View style={styles.siteChip}>
                <MapPin size={12} color={colors.white} />
                <Text style={styles.siteText} numberOfLines={1}>
                  {user?.site?.siteName || 'No Site'}
                </Text>
              </View>
            </View>
            <Pressable style={styles.logoutBtn} onPress={() => setShowLogoutConfirm(true)} hitSlop={8}>
              <Power size={16} color={colors.white} />
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Tab switcher */}
      <View style={styles.tabSwitcher}>
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
              <Icon size={16} color={active ? colors.primary : colors.muted} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
              {active && <View style={styles.tabIndicator} />}
            </Pressable>
          );
        })}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {tab === 'today' ? (
          <TodayTasksTab
            tasks={action.markAssignedDone(allTasks, completed)}
            stats={action.getTaskStats(allTasks, completed, uploadProgress)}
            loading={loading}
            refreshing={refreshing}
            localDone={localDone}
            uploadProgress={uploadProgress}
            onRefresh={() => loadTasks(true)}
            onPickTask={(t) => openTaskForm('PICK', t)}
          />
        ) : (
          <TaskMonitoringTab />
        )}
      </View>

      {/* FAB (Today tab only) */}
      {tab === 'today' && (
        <>
          {fabOpen && (
            <Pressable style={styles.overlay} onPress={() => setFabOpen(false)} />
          )}
          <View style={styles.fabContainer} pointerEvents="box-none">
            {fabOpen && (
              <Animated.View
                style={[
                  styles.fabOptions,
                  { opacity: fabAnim, transform: [{ translateY: fabAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
                ]}
              >
                <Pressable style={styles.subFab} onPress={() => openTaskForm('ADD_KPI')}>
                  <Text style={styles.subFabText}>Add KPI Task</Text>
                  <View style={styles.subFabIcon}>
                    <Plus size={14} color={colors.white} />
                  </View>
                </Pressable>
                <Pressable style={styles.subFab} onPress={() => openTaskForm('ADD_OTHER')}>
                  <Text style={styles.subFabText}>Add Other Task</Text>
                  <View style={styles.subFabIcon}>
                    <Plus size={14} color={colors.white} />
                  </View>
                </Pressable>
              </Animated.View>
            )}
            <Pressable onPress={() => setFabOpen((s) => !s)}>
              <LinearGradient
                colors={fabOpen ? ['#1E293B', '#334155'] : colors.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.masterFab}
              >
                <Animated.View style={{ transform: [{ rotate: fabRotate }] }}>
                  {fabOpen ? <X size={24} color={colors.white} /> : <Plus size={24} color={colors.white} />}
                </Animated.View>
              </LinearGradient>
            </Pressable>
          </View>
        </>
      )}

      <ConfirmDialog
        visible={showLogoutConfirm}
        danger
        icon={<Power size={22} color={colors.danger} />}
        title="Logout"
        message="Are you sure you want to log out of your account?"
        confirmLabel="Logout"
        cancelLabel="Cancel"
        onConfirm={doLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </View>
  );
};

export default DashboardScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerGradient: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...shadow.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  userMeta: { flex: 1, gap: 3 },
  greeting: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  userName: { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: 0.2, lineHeight: 21 },
  siteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  siteText: { color: colors.white, fontSize: 11, fontWeight: '500', maxWidth: 200 },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: -spacing.md,
    borderRadius: radius.md,
    padding: spacing.xs,
    ...shadow.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  tabText: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  tabIndicator: {
    position: 'absolute',
    bottom: 2,
    height: 3,
    width: 28,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  content: { flex: 1, marginTop: spacing.lg },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.4)',
    zIndex: 1,
  },
  fabContainer: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xxl,
    alignItems: 'flex-end',
    zIndex: 2,
  },
  fabOptions: { gap: spacing.md, marginBottom: spacing.md, alignItems: 'flex-end' },
  subFab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
    ...shadow.md,
  },
  subFabText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  subFabIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterFab: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.brand,
  },
});
