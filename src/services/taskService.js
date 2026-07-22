/**
 * Dashboard task loading — a faithful port of the old app's LauncherActivity
 * chain. All reads run against the active city's database (set at login).
 *
 *   Assigned = KPI tasks (low priority) + today's Priority tasks (high)
 *   Completed = tasks already submitted today (FieldExecutiveTasks)
 *
 * userId here is the employee number (e.g. "103") — the same id used to log in.
 */
import { getData, updateData } from '../firebase/firebaseService';
import { enqueueUploads } from './uploadQueueService';
import { getUserCurrentLocation } from './locationTrackingService';
import { storage as prefs } from '../utils/storage';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Date parts the old app used: today (yyyy-MM-dd), year (yyyy), month (full name). */
export const getDateParts = (d = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return { today: `${yyyy}-${mm}-${dd}`, year: String(yyyy), month: MONTHS[d.getMonth()] };
};

/** "yyyy-MM-dd HH:mm" — the old app's _at format. */
const dateTimeNow = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** City storage folder, e.g. "gs://dtdnavigator.appspot.com/Ajmer" → "Ajmer". */
const cityFolder = (city) => {
  const seg = String(city?.storagePath || '').split('/').filter(Boolean).pop();
  return seg || city?.cityName || '';
};

/**
 * KPI tasks: FieldExecutiveData/FieldExecutiveKPITasks/{userId}
 * Each child is { taskId: taskName }.
 *
 * Numeric task ids make Firebase return the node as a sparse array
 * (e.g. [null, "Task"]), so null holes and non-task keys are skipped —
 * otherwise a phantom "null" card shows up on the dashboard.
 */
export const getKpiTasks = async (userId) => {
  const snap = await getData(`FieldExecutiveData/FieldExecutiveKPITasks/${userId}`);
  if (!snap || typeof snap !== 'object') return [];
  const out = [];
  for (const [id, name] of Object.entries(snap)) {
    if (id === 'lastKey' || name == null) continue;
    out.push({
      id,
      title: String(name),
      type: 'KPI',
      priority: 'low',
      category: 'KPI',
    });
  }
  return out;
};

/**
 * Priority tasks: FieldExecutiveData/FieldExecutivePriorityTasks/{userId}/{today}
 * Shape: { taskKey: { subKey: { task, ... } } }. "lastKey" entries are skipped.
 */
export const getPriorityTasks = async (userId, today) => {
  const snap = await getData(`FieldExecutiveData/FieldExecutivePriorityTasks/${userId}/${today}`);
  if (!snap || typeof snap !== 'object') return [];

  const out = [];
  for (const [taskKey, group] of Object.entries(snap)) {
    if (!group || typeof group !== 'object') continue;
    for (const [subKey, entry] of Object.entries(group)) {
      if (subKey === 'lastKey' || !entry || typeof entry !== 'object') continue;
      if (entry.task == null) continue;
      out.push({
        id: taskKey,
        subKey, // needed to mark this priority task done on submit
        title: String(entry.task),
        type: 'Priority Task',
        priority: 'high',
        category: 'Priority',
      });
    }
  }
  return out;
};

/**
 * Tasks already submitted today:
 * FieldExecutiveData/FieldExecutiveTasks/{userId}/{year}/{month}/{today}
 * Shape: { taskName: { count: { remark, image1, _at, type } } }.
 */
export const getSubmittedTasks = async (userId, { year, month, today }) => {
  const snap = await getData(
    `FieldExecutiveData/FieldExecutiveTasks/${userId}/${year}/${month}/${today}`,
  );
  if (!snap || typeof snap !== 'object') return [];

  const out = [];
  for (const [taskName, group] of Object.entries(snap)) {
    if (!group || typeof group !== 'object') continue;
    for (const entry of Object.values(group)) {
      if (!entry || typeof entry !== 'object') continue;
      out.push({
        taskKey: taskName, // the key == the assigned task's id
        title: taskName,
        remark: entry.remark != null ? String(entry.remark) : '',
        image1: entry.image1 != null ? String(entry.image1) : '',
        at: entry._at != null ? String(entry._at) : '',
        type: entry.type != null ? String(entry.type) : '',
      });
    }
  }
  return out;
};

const byName = (a, b) => a.title.localeCompare(b.title);

/**
 * A task row's unique identity. The task id alone is NOT unique: the same task
 * can be assigned as a KPI (low) *and* as a Priority (high), and a single
 * priority taskKey can hold several sub-entries. Use this for React list keys,
 * local done-flags and upload chips.
 *
 * Note this is deliberately finer-grained than the done-matching key
 * ("id|priority"), which is all the submitted-task records carry.
 */
export const taskCardKey = (t) => `${t?.id}|${t?.priority}|${t?.subKey ?? ''}`;

/**
 * The global "Other" task catalogue: FieldExecutiveData/Tasks
 * Shape: { pushKey: { name } }. "lastKey" is an admin-side counter, not a task.
 * These are never assigned, so they are always low priority.
 */
export const getOtherTasks = async () => {
  const snap = await getData('FieldExecutiveData/Tasks');
  if (!snap || typeof snap !== 'object') return [];

  const out = [];
  for (const [id, entry] of Object.entries(snap)) {
    if (id === 'lastKey' || !entry || typeof entry !== 'object') continue;
    if (entry.name == null) continue;
    out.push({
      id,
      title: String(entry.name),
      type: 'Other',
      priority: 'low',
      category: 'Other',
    });
  }
  return out.sort(byName);
};

/**
 * The tasks selectable in the "Add …" form:
 *   ADD_KPI   → ONLY this user's KPI tasks (the FieldExecutiveKPITasks node).
 *               Priority tasks are executed from their dashboard card (PICK
 *               mode), so they don't belong in this dropdown.
 *   ADD_OTHER → the global Tasks catalogue.
 */
export const getSelectableTasks = async (mode, userId) => {
  if (mode === 'ADD_OTHER') return getOtherTasks();
  return (await getKpiTasks(userId)).sort(byName);
};

/**
 * Everything the dashboard needs for a logged-in employee.
 * @returns { assigned, completed }
 */
export const getDashboardTasks = async (userId) => {
  const parts = getDateParts();

  const [kpi, priority, completed] = await Promise.all([
    getKpiTasks(userId),
    getPriorityTasks(userId, parts.today),
    getSubmittedTasks(userId, parts),
  ]);

  // Priority (high) first, then KPI — each sorted by name, like the old app.
  // Deliberately NOT deduped: a task assigned as both a KPI and a Priority item
  // is two separate cards to complete. taskCardKey keeps them distinct.
  const assigned = [...priority.sort(byName), ...kpi.sort(byName)];

  return { assigned, completed };
};

/**
 * Submit a completed task — a faithful port of the old app's AddTaskActivity.
 *
 * Writes the record to
 *   FieldExecutiveData/FieldExecutiveTasks/{userId}/{year}/{month}/{today}/{taskKey}/{count}
 * uploads media to the city's storage folder under matching paths, and (for a
 * Priority task) marks it done.
 *
 * Location is mandatory: the current fix + reverse-geocoded address are captured
 * at submit. If no fix can be had (GPS off / timeout) the submit is blocked so a
 * task is never recorded without a location.
 *
 * @param task    { id (taskKey), subKey?, priority ('high'|'low'), category }
 * @param images  [{ uri }]  compressed image files (<=50KB)
 * @param videos  [{ uri }]  compressed video files
 * @param remark  string
 */
export const submitTask = async ({ task, images = [], videos = [], remark = '' }) => {
  const TAG = '[submitTask]';
  try {
    const user = await prefs.getUser();
    const city = await prefs.getCity();
    const userId = user?.userId;
    console.log(TAG, 'start', {
      userId,
      city: city?.cityName,
      storageBucket: city?.storageBucket,
      taskId: task?.id,
      priority: task?.priority,
      images: images.length,
      videos: videos.length,
    });
    if (!userId) throw new Error('Not logged in');
    if (!task?.id) throw new Error('No task selected');
    if (!city?.apiKey) throw new Error('No city config');

    // 0. Current location — mandatory. Fail fast (before any write) if we can't
    //    get a fix, so the task is never saved without a location.
    console.log(TAG, 'step 0: getting current location');
    const locRes = await getUserCurrentLocation();
    if (!locRes?.success || !locRes.location?.latitude) {
      throw new Error('Could not get your location. Please turn on GPS and try again.');
    }
    const latLng = `${locRes.location.latitude},${locRes.location.longitude}`;
    const address = String(locRes.location.address || '').trim();
    console.log(TAG, 'step 0 done: location', { latLng, address });

    const { today, year, month } = getDateParts();
    const taskKey = String(task.id);
    const isHigh = task.priority === 'high';
    const folder = cityFolder(city);
    console.log(TAG, 'dateParts', { today, year, month, taskKey, isHigh, folder });

    // 1. taskCount — 1, or (last numeric child + 1) if this task was done today.
    const basePath = `FieldExecutiveData/FieldExecutiveTasks/${userId}/${year}/${month}/${today}/${taskKey}`;
    console.log(TAG, 'step 1: reading count at', basePath);
    const existing = await getData(basePath);
    let count = 1;
    if (existing && typeof existing === 'object') {
      const nums = Object.keys(existing).map((k) => parseInt(k, 10)).filter((n) => !Number.isNaN(n));
      if (nums.length) count = Math.max(...nums) + 1;
    }
    console.log(TAG, 'step 1 done: count =', count);

    // 2. Task record (filenames only, like the old app) — written now so submit
    //    is instant; the actual files upload in the background queue.
    const record = {
      _at: dateTimeNow(),
      latLng, // "lat,lng" — captured at submit
      address,
      type: isHigh ? 'high' : 'low',
      taskCategory: isHigh ? 'Priority' : task.category || 'KPI',
      remark: String(remark).trim(),
    };
    images.forEach((_, i) => {
      record[`image${i + 1}`] = `image${i + 1}.jpg`;
    });
    videos.forEach((_, i) => {
      record[`video${i + 1}`] = `video${i + 1}.mp4`;
    });

    console.log(TAG, 'step 2: writing record at', `${basePath}/${count}`, record);
    await updateData(`${basePath}/${count}`, record);
    console.log(TAG, 'step 2 done: record written');

    // 3. Priority task → mark it done.
    if (isHigh && task.subKey != null) {
      const pPath = `FieldExecutiveData/FieldExecutivePriorityTasks/${userId}/${today}/${taskKey}/${task.subKey}`;
      console.log(TAG, 'step 3: priority status at', pPath);
      await updateData(pPath, { status: '1' });
      console.log(TAG, 'step 3 done: priority marked');
    }

    // 4. Queue media for background upload (one-by-one). Submit returns now.
    const imageBase = `${folder}/FieldExecutiveData/FieldExecutiveTasksImages/${userId}/${year}/${month}/${today}/${taskKey}/${count}`;
    const videoBase = `${folder}/FieldExecutiveData/FieldExecutiveTasksVideos/${userId}/${year}/${month}/${today}/${taskKey}/${count}`;
    const cardKey = taskCardKey({ id: taskKey, priority: isHigh ? 'high' : 'low', subKey: task.subKey });
    const uploads = [
      ...images.map((img, i) => ({ localPath: img.uri, storagePath: `${imageBase}/image${i + 1}.jpg`, cardKey })),
      // Old app quirk: DB field is "videoN.mp4" but the file is "videosN.mp4".
      ...videos.map((vid, i) => ({ localPath: vid.uri, storagePath: `${videoBase}/videos${i + 1}.mp4`, cardKey })),
    ];
    await enqueueUploads(uploads);
    console.log(TAG, 'step 4 done: queued', uploads.length, 'file(s) for background upload');

    console.log(TAG, 'SUCCESS', { count, queued: uploads.length });
    return { ok: true, count, queued: uploads.length };
  } catch (err) {
    console.error(TAG, 'FAILED:', err?.message, '| code:', err?.code, '| full:', err);
    throw err;
  }
};
