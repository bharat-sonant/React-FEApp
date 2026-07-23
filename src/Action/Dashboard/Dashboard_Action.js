/**
 * Dashboard logic — user/session, real assigned + completed tasks, and logout.
 */
import { storage } from '../../utils/storage';
import { resetActiveConfig } from '../../firebase/firebaseService';
import { getDashboardTasks, taskCardKey } from '../../services/taskService';
import { clearUploadQueue } from '../../services/uploadQueueService';
import { getMonitoringTasks } from '../../services/monitoringService';

export const loadUser = async () => (await storage.getUser()) || null;

/**
 * The logged-in employee's tasks from their city's database.
 *   assigned  = KPI (low) + today's Priority (high), priority first
 *   completed = tasks already submitted today
 * @returns { assigned, completed }
 */
export const loadDashboard = async () => {
  const user = await storage.getUser();
  const city = await storage.getCity();
  const empId = user?.userId;
  console.log('[dashboard] loading tasks for', {
    empId,
    employee: user?.employeeName,
    city: city?.cityName,
    databaseURL: city?.databaseURL,
  });
  if (!empId) return { assigned: [], completed: [] };
  return getDashboardTasks(empId);
};

export { taskCardKey };

/**
 * Flag each assigned task that has already been submitted today.
 *
 * KPI (low): matched by taskId + type against today's submitted records —
 * they have no per-assignment node, so this is all the data there is.
 *
 * Priority (high): the subKey's own `status` flag (statusDone) is
 * authoritative — a re-assignment of the same task is a NEW subKey with no
 * status, so it stays pending instead of inheriting an earlier submission's
 * "done" (submitted records carry no subKey, so a taskKey match can't tell
 * the two assignments apart). Local (pre-sync) completions DO carry the
 * subKey, so they flip exactly the sub-entry that was submitted.
 */
export const markAssignedDone = (assigned = [], completed = []) => {
  const doneSet = new Set(
    completed.map((c) => `${c.taskKey}|${c.type}|${c.subKey ?? ''}`),
  );
  return assigned.map((t) => ({
    ...t,
    done:
      t.priority === 'high'
        ? Boolean(t.statusDone) || doneSet.has(`${t.id}|high|${t.subKey ?? ''}`)
        : doneSet.has(`${t.id}|low|`),
  }));
};

/**
 * Add a just-submitted task to the completed list locally, so the card flips to
 * "Completed" immediately instead of waiting for the next sync. The entry is
 * shaped like a server one so markAssignedDone/getTaskStats treat it the same.
 */
export const addLocalCompletion = (completed = [], task) => {
  if (!task?.id) return completed;
  const entry = {
    taskKey: String(task.id),
    title: task.title || String(task.id),
    type: task.priority === 'high' ? 'high' : 'low',
    // Which priority sub-entry was completed — so markAssignedDone flips only
    // that assignment, not a re-assignment sharing the same taskKey.
    subKey: task.subKey ?? null,
    remark: '',
    image1: '',
    at: '',
  };
  const key = `${entry.taskKey}|${entry.type}|${entry.subKey ?? ''}`;
  if (completed.some((c) => `${c.taskKey}|${c.type}|${c.subKey ?? ''}` === key)) {
    return completed;
  }
  return [...completed, entry];
};

/**
 * Tasks submitted via "Add KPI / Add Other" are not assigned, so they have no
 * card on the dashboard — the user submits one, lands back here and sees
 * nothing, with no clue their images are still uploading.
 *
 * Show them as session-local cards, newest first, so the uploading → Completed
 * flow looks exactly like an assigned task's. They drop off on the next sync,
 * like any other completed task. Anything already in `assigned` is skipped so a
 * picked task never doubles up.
 */
export const withLocalTasks = (assigned = [], localTasks = []) => {
  if (!localTasks.length) return assigned;
  const have = new Set(assigned.map(taskCardKey));
  return [...localTasks.filter((t) => !have.has(taskCardKey(t))), ...assigned];
};

/**
 * The cards to show. Completed tasks drop off the list on every server load —
 * only the ones finished in this session stay visible, so the user sees their
 * submit land. The Completed tile still counts them all.
 *
 * A task stays if either:
 *   localDone  — it was submitted in this session (cleared on the next sync)
 *   uploading  — its media is still in the background queue. This is the
 *                safety net: a card must never vanish while its images are
 *                still uploading, or the user would think the work is fully
 *                saved when it isn't.
 */
export const visibleTasks = (marked = [], localDone, uploading) =>
  marked.filter((t) => {
    if (!t.done) return true;
    const key = taskCardKey(t);
    return Boolean(localDone?.has(key) || uploading?.has(key));
  });

/**
 * Stat tiles: completed today vs. still pending. A task whose media is still
 * uploading counts as pending — it is not finished until every file is up, and
 * the tile must not disagree with the card.
 */
export const getTaskStats = (assigned = [], completed = [], uploading) => {
  const marked = markAssignedDone(assigned, completed);
  const done = marked.filter((t) => t.done && !uploading?.has(taskCardKey(t))).length;
  return { completed: done, pending: marked.length - done };
};

/** Submitted tasks + approval status for the picked date. */
export const loadMonitoringHistory = async (date = new Date()) => {
  const user = await storage.getUser();
  if (!user?.userId) return [];
  return getMonitoringTasks(user.userId, date);
};

export const filterByStatus = (history = [], status = 'all') =>
  status === 'all' ? history : history.filter((h) => h.status === status);

/** Old app cleared every pref and returned to city selection. */
export const performLogout = async () => {
  await clearUploadQueue(); // drop pending uploads so they don't cross cities
  await storage.logout();
  await storage.clearCity();
  resetActiveConfig();
};
