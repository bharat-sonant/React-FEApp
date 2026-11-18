/**
 * Task Monitoring — the tasks this employee submitted on a chosen date, with
 * their approval status. A port of the old app's TaskMoniterningActivity.
 *
 * Records live at
 *   FieldExecutiveData/FieldExecutiveTasks/{userId}/{yyyy}/{MMMM}/{yyyy-MM-dd}/{taskId}/{count}
 * and are written by submitTask (see taskService).
 *
 * `approvedStatus` is never written by the app — an admin sets it in Firebase.
 */
import { getData } from '../firebase/firebaseService';
import { getDateParts } from './taskService';
import { getBranchCityKey, getBranchHistory, getCityKeyAt, getTaskCatalogue } from './branchCityService';

/**
 * Old app's rule, kept exactly:
 *   no approvedStatus field → Pending
 *   approvedStatus == 0     → Not Approved
 *   anything else           → Approved
 */
export const approvalStatus = (entry) => {
  if (!entry || entry.approvedStatus == null) return 'Pending';
  return Number(entry.approvedStatus) === 0 ? 'Not Approved' : 'Approved';
};

/**
 * Task ids are keys; the readable name lives elsewhere. Build one lookup from
 * every catalogue a submitted task could have come from:
 *
 *   FieldExecutiveData/Tasks/{id}/name          "Other" tasks (global)
 *   FieldExecutiveKPITasks/{userId}/{id}        KPI tasks (value IS the name)
 *   FieldExecutivePriorityTasks/{userId}/{date} Priority tasks for that day
 *
 * The old app only ever looked in Tasks/, so KPI and Priority rows showed no
 * name at all — that is a bug, not behaviour worth reproducing.
 */
const buildNameLookup = async (userId, today, other) => {
  const [kpi, priority] = await Promise.all([
    getData(`FieldExecutiveData/FieldExecutiveKPITasks/${userId}`).catch(() => null),
    getData(`FieldExecutiveData/FieldExecutivePriorityTasks/${userId}/${today}`).catch(() => null),
  ]);

  const names = new Map();

  if (other && typeof other === 'object') {
    for (const [id, entry] of Object.entries(other)) {
      if (id === 'lastKey') continue;
      if (entry && typeof entry === 'object' && entry.name != null) names.set(id, String(entry.name));
    }
  }

  if (kpi && typeof kpi === 'object') {
    for (const [id, name] of Object.entries(kpi)) {
      if (name != null && !names.has(id)) names.set(id, String(name));
    }
  }

  if (priority && typeof priority === 'object') {
    for (const [taskKey, group] of Object.entries(priority)) {
      if (!group || typeof group !== 'object') continue;
      for (const [subKey, entry] of Object.entries(group)) {
        if (subKey === 'lastKey' || !entry || typeof entry !== 'object') continue;
        if (entry.task != null && !names.has(taskKey)) names.set(taskKey, String(entry.task));
      }
    }
  }

  return names;
};

/**
 * Submitted tasks for one date, newest first.
 * @param userId employee number
 * @param date   a Date
 * @returns [{ id, sno, task, status, at, remark, category, count }]
 */
export const getMonitoringTasks = async (userId, date = new Date()) => {
  const { today, year, month } = getDateParts(date);
  const path = `FieldExecutiveData/FieldExecutiveTasks/${userId}/${year}/${month}/${today}`;
  console.log('[monitoring] loading', path);

  const snap = await getData(path);
  if (!snap || typeof snap !== 'object') return [];

  // The "Other" list that names a record is the one of the city the employee was in
  // when it was submitted (see branchCityService).
  const [history, currentCityKey] = await Promise.all([getBranchHistory(userId), getBranchCityKey(userId)]);
  const cityKeyOf = (entry) => getCityKeyAt(history, currentCityKey, entry._at != null ? String(entry._at) : `${today} 00:00`);
  const cityKeys = new Set();
  for (const group of Object.values(snap)) {
    if (!group || typeof group !== 'object') continue;
    for (const entry of Object.values(group)) {
      if (entry && typeof entry === 'object') cityKeys.add(cityKeyOf(entry));
    }
  }
  const lookups = new Map();
  await Promise.all(
    [...cityKeys].map(async (cityKey) => {
      const other = await getTaskCatalogue(cityKey).catch(() => null);
      lookups.set(cityKey, await buildNameLookup(userId, today, other));
    }),
  );

  const rows = [];
  for (const [taskId, group] of Object.entries(snap)) {
    if (!group || typeof group !== 'object') continue;
    for (const [count, entry] of Object.entries(group)) {
      if (!entry || typeof entry !== 'object') continue;
      const names = lookups.get(cityKeyOf(entry)) || new Map();
      rows.push({
        id: `${taskId}-${count}`,
        task: names.get(taskId) || taskId,
        status: approvalStatus(entry),
        at: entry._at != null ? String(entry._at) : '',
        remark: entry.remark != null ? String(entry.remark) : '',
        category: entry.taskCategory != null ? String(entry.taskCategory) : '',
        count,
      });
    }
  }

  // Newest submission first; _at is "yyyy-MM-dd HH:mm" so it sorts as a string.
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return rows.map((r, i) => ({ ...r, sno: i + 1 }));
};
