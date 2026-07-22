/**
 * Firebase access layer.
 *
 * The app picks its city at runtime, and every city lives in its own Firebase
 * project/database. There is no google-services.json; the [DEFAULT] app is
 * initialised from the active city's config at runtime and re-created if the
 * city changes. It has to be the DEFAULT app (not a named one) because the
 * Storage native module resolves the default app — see doEnsure below.
 *
 * Errors are propagated, not swallowed: a silent `null` makes a broken read
 * look identical to "no data", which is very hard to debug.
 */
import { getApps, initializeApp, deleteApp } from '@react-native-firebase/app';
import {
  getDatabase,
  ref as dbRef,
  get as dbGet,
  set as dbSet,
  update as dbUpdate,
  push as dbPush,
  remove as dbRemove,
  serverTimestamp,
} from '@react-native-firebase/database';
import {
  getStorage,
  ref as storageRef,
  putFile,
  getDownloadURL,
} from '@react-native-firebase/storage';
import { storage as prefs } from '../utils/storage';

let activeConfig = null;

/**
 * The city config currently in use. Each CityDetails entry already carries its
 * own Firebase credentials, so the saved city *is* the config.
 */
export const getActiveConfig = async () => {
  if (activeConfig) {
    console.log('[firebase] active config (cached):', activeConfig.cityName, '|', activeConfig.databaseURL);
    return activeConfig;
  }
  const saved = await prefs.getCity();
  if (!saved?.apiKey || !saved?.databaseURL) {
    throw new Error('No city selected — pick a city before using Firebase.');
  }
  activeConfig = saved;
  console.log('[firebase] active config (from storage):', {
    cityName: saved.cityName,
    key: saved.key,
    projectId: saved.projectId,
    databaseURL: saved.databaseURL,
    storageBucket: saved.storageBucket,
  });
  return saved;
};

/** Call after the user changes city so the next call re-resolves the config. */
export const resetActiveConfig = () => {
  activeConfig = null;
};

const DEFAULT = '[DEFAULT]';

// One in-flight ensure promise, so the dashboard's parallel reads / the submit's
// parallel uploads share a single initialisation instead of racing.
let ensuring = null;

const configFor = (cfg) => ({
  apiKey: cfg.apiKey,
  appId: cfg.appId,
  projectId: cfg.projectId,
  databaseURL: cfg.databaseURL,
  storageBucket: cfg.storageBucket,
  messagingSenderId: cfg.messagingSenderId,
});

/**
 * Ensure the [DEFAULT] Firebase app matches this city's config.
 *
 * We use the DEFAULT app (not a named one) because the Storage native module
 * requires a default app to exist — without google-services.json a named-only
 * setup throws "Default FirebaseApp is not initialized" on any storage call.
 *
 * One city is active per session; if the city changes (logout → login elsewhere)
 * the default app is deleted and re-created with the new config.
 */
const doEnsure = async (cfg) => {
  if (!cfg?.apiKey || !cfg?.databaseURL) throw new Error('Invalid city config');

  let app = getApps().find((a) => a.name === DEFAULT);
  if (app && app.options?.databaseURL !== cfg.databaseURL) {
    console.log('[firebase] city changed → replacing default app:', app.options?.databaseURL, '→', cfg.databaseURL);
    await deleteApp(app); // different city — replace it
    app = null;
  }
  if (app) {
    console.log('[firebase] reusing default app:', app.options?.projectId, '|', app.options?.databaseURL);
    return app;
  }

  console.log('[firebase] initializing default app:', {
    projectId: cfg.projectId,
    databaseURL: cfg.databaseURL,
    storageBucket: cfg.storageBucket,
  });
  try {
    const created = await initializeApp(configFor(cfg));
    console.log('[firebase] default app ready:', created.name, '|', created.options?.databaseURL);
    return created;
  } catch (e) {
    // Lost a race — reuse the app that now exists (if it's the right one).
    const now = getApps().find((a) => a.name === DEFAULT);
    if (now && now.options?.databaseURL === cfg.databaseURL) return now;
    throw e;
  }
};

const ensureActiveApp = async (cfg) => {
  if (!ensuring) {
    ensuring = doEnsure(cfg).finally(() => {
      ensuring = null;
    });
  }
  return ensuring;
};

/** The Firebase app for the active city, initialising it on first use. */
export const getCityApp = async () => ensureActiveApp(await getActiveConfig());

const getDb = async () => {
  const cfg = await getActiveConfig();
  return getDatabase(await ensureActiveApp(cfg), cfg.databaseURL);
};

/**
 * A DB reference for an arbitrary city config, without it being saved yet.
 * Used at login, where the city is derived from the typed user id first.
 */
export const getDbForCity = async (cfg) => getDatabase(await ensureActiveApp(cfg), cfg.databaseURL);

/** Read a path from a specific city (used during login). */
export const getDataForCity = async (cfg, path) => {
  const snapshot = await dbGet(dbRef(await getDbForCity(cfg), path));
  return snapshot.exists() ? snapshot.val() : null;
};

// ---- Realtime Database ----

/** Read a path. Returns null when the node doesn't exist. */
export const getData = async (path) => {
  const snapshot = await dbGet(dbRef(await getDb(), path));
  return snapshot.exists() ? snapshot.val() : null;
};

export const saveData = async (path, data) => {
  await dbSet(dbRef(await getDb(), path), data);
};

export const updateData = async (path, data) => {
  await dbUpdate(dbRef(await getDb(), path), data);
};

export const removeData = async (path) => {
  await dbRemove(dbRef(await getDb(), path));
};

/** Push a child under `path`; resolves with the generated key. */
export const pushData = async (path, data) => {
  const reference = await dbPush(dbRef(await getDb(), path), data);
  return reference.key;
};

export { serverTimestamp };

/**
 * Initialise the active city's Firebase app and prove it actually responds.
 * Reads the same tiny node the old app used for its version check, so a bad
 * config / offline device is caught at city selection instead of at login.
 * @throws if the project can't be reached within `timeoutMs`.
 */
export const connectToCity = async (timeoutMs = 15000) => {
  const cfg = await getActiveConfig();

  const check = (async () => {
    await getCityApp();
    // A tiny read — proves credentials + databaseURL are valid and reachable.
    await getData('Settings/LatestVersions/FieldExecutive');
    return true;
  })();

  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`Could not reach ${cfg.cityName}. Check your connection.`)),
      timeoutMs,
    ),
  );

  await Promise.race([check, timeout]);
  return cfg;
};

// ---- Storage ----

/**
 * Upload a local file to the active city's bucket.
 * @param localPath file path or file:// uri
 * @param remotePath path inside the bucket
 * @returns the public download URL
 */
export const uploadFileToStorage = async (localPath, remotePath) => {
  const cfg = await getActiveConfig();
  const app = await ensureActiveApp(cfg);
  // The default app now exists, so storage's native module is happy.
  const bucket = getStorage(app, `gs://${cfg.storageBucket}`);
  const reference = storageRef(bucket, remotePath);
  await putFile(reference, String(localPath).replace(/^file:\/\//, ''));
  return getDownloadURL(reference);
};
