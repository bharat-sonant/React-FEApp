/**
 * Background media upload queue.
 *
 * Task submit is fast: the DB record is written immediately, and the media files
 * are pushed to this persistent queue and uploaded one-by-one in the background.
 * The queue survives app restarts, so an interrupted upload resumes next launch.
 *
 * Pattern mirrors IEC_APP_New's pendingUploadService (AsyncStorage queue + a
 * serialising lock + per-item retry).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { uploadFileToStorage } from '../firebase/firebaseService';

const KEY = 'fe_uploadQueue';
const MAX_RETRIES = 5;

// Serialise all reads/writes of the queue so concurrent enqueues/processing
// never clobber each other.
let lock = Promise.resolve();
let processing = false;

// Listeners that want to know which tasks still have media uploading, so the
// dashboard can show an "Uploading…" chip without polling.
const listeners = new Set();

/**
 * Per-task upload progress, as a Map of cardKey → { current, total }.
 *
 * `total` is stamped on each item at enqueue time, because finished items are
 * removed from the queue — counting what's left is the only thing the queue can
 * tell us, so the total has to be remembered. With R of N left, the file being
 * worked on right now is number N - R + 1.
 */
const progressOf = (queue) => {
  const counts = new Map();
  queue.forEach((it) => {
    if (it.cardKey == null) return;
    const key = String(it.cardKey);
    const prev = counts.get(key);
    if (prev) prev.remaining += 1;
    else counts.set(key, { remaining: 1, total: Number(it.total) || 0 });
  });

  const out = new Map();
  counts.forEach(({ remaining, total }, key) => {
    // Fall back to "remaining" if an older queued item has no total stamped.
    const n = total || remaining;
    out.set(key, { current: Math.min(n, Math.max(1, n - remaining + 1)), total: n });
  });
  return out;
};

/**
 * Subscribe to upload progress: a Map of cardKey → { current, total }.
 *
 * Fires immediately with the current state, then on every queue change. Read
 * from the persisted queue rather than session state, so it stays correct
 * across an app restart.
 *
 * @returns unsubscribe fn
 */
export const subscribeUploads = (fn) => {
  listeners.add(fn);
  readQueue().then((q) => fn(progressOf(q)));
  return () => listeners.delete(fn);
};

const notify = async () => {
  if (!listeners.size) return;
  const progress = progressOf(await readQueue());
  listeners.forEach((fn) => {
    try {
      fn(progress);
    } catch {
      // a listener throwing must not break the queue
    }
  });
};

const withLock = (fn) => {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

const readQueue = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeQueue = (queue) => AsyncStorage.setItem(KEY, JSON.stringify(queue));

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Number of files still waiting to upload. */
export const getPendingUploadCount = async () => (await readQueue()).length;

/**
 * Queue media for background upload.
 * @param items [{ localPath, storagePath, cardKey? }]  cardKey = "taskId|priority|subKey"
 */
export const enqueueUploads = async (items = []) => {
  if (!items.length) return;
  await withLock(async () => {
    const queue = await readQueue();
    items.forEach((it) => {
      queue.push({
        id: makeId(),
        retries: 0,
        localPath: it.localPath,
        storagePath: it.storagePath,
        cardKey: it.cardKey != null ? String(it.cardKey) : null,
        // How many files this submission has in total, for "1 / 5" progress.
        total: items.length,
      });
    });
    await writeQueue(queue);
  });
  notify();
  // Kick the processor (fire-and-forget).
  processQueue();
};

const deleteLocal = async (localPath) => {
  try {
    await RNFS.unlink(String(localPath).replace(/^file:\/\//, ''));
  } catch {
    // file already gone / not removable — ignore
  }
};

/**
 * Upload queued files one-by-one until the queue is empty. Safe to call any
 * time — it no-ops if already running. On failure an item is retried later
 * (moved to the back), or dropped after MAX_RETRIES.
 */
export const processQueue = async () => {
  if (processing) return;
  processing = true;
  try {
    // Guard against an unbounded loop; far above any real queue size.
    for (let guard = 0; guard < 2000; guard += 1) {
      const item = await withLock(async () => (await readQueue())[0] || null);
      if (!item) break;

      try {
        await uploadFileToStorage(item.localPath, item.storagePath);
        console.log('[uploadQueue] uploaded', item.storagePath);
        await withLock(async () => {
          const q = await readQueue();
          await writeQueue(q.filter((x) => x.id !== item.id));
        });
        await deleteLocal(item.localPath);
        notify();
      } catch (e) {
        console.warn('[uploadQueue] failed', item.storagePath, e?.message);
        await withLock(async () => {
          const q = await readQueue();
          const idx = q.findIndex((x) => x.id === item.id);
          if (idx === -1) return;
          const [it] = q.splice(idx, 1);
          it.retries = (it.retries || 0) + 1;
          if (it.retries < MAX_RETRIES) q.push(it); // retry later, at the back
          await writeQueue(q);
        });
        notify();
        // Stop this run on a failure (likely offline); a later trigger resumes.
        break;
      }
    }
  } finally {
    processing = false;
  }
};

/** Drop everything (used on logout so pending uploads don't cross cities). */
export const clearUploadQueue = async () => {
  await withLock(() => writeQueue([]));
  notify();
};
