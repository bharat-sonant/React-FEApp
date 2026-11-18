/**
 * Working branch city — for Jaipur Office employees whose
 * Employees/{empId}/GeneralDetails.branch is another city (e.g. "Dausa").
 *
 * All their Field Executive data (tasks, KPI / priority, images, location) still
 * lives in the Jaipur Office database. Only the "Other" task list
 * (FieldExecutiveData/Tasks) comes from the branch city's database, read only.
 *
 * Which city's list names a submitted task depends on when it was submitted:
 *   ExternalEmployeeBranchHistory/{empId}/{n} = { city, from, to }  (Jaipur Office DB)
 *   ("yyyy-MM-dd HH:mm:ss", to '' = still there; written by BackOffice employee save)
 *   - before the first entry            → Jaipur Office
 *   - no history at all                 → the current branch from BRANCH_HISTORY_START
 * Same rules as the portal and BackOffice.
 */
import { getApps, initializeApp } from '@react-native-firebase/app';
import { getDatabase, ref as dbRef, get as dbGet } from '@react-native-firebase/database';
import { getActiveConfig, getData } from '../firebase/firebaseService';
import { fetchCities } from './cityService';

// Same date as the portal and BackOffice: change all three together on the app's release day.
export const BRANCH_HISTORY_START = '2026-11-18 00:00:00';

export const SOURCE_CITY_KEY = 'jaipur-office';
const SOURCE_CITY_NAME = 'Jaipur'; // the app's cityName of the Jaipur Office city

// The portal's city list: branch values are its cityNames, its city keys are used in the history.
const PORTAL_CITY_DETAILS_URL =
  'https://firebasestorage.googleapis.com/v0/b/dtdnavigator.appspot.com/o/Common%2FCityDetails.json?alt=media';

const norm = (v) => String(v || '').trim().toLowerCase();
const normUrl = (v) => norm(v).replace(/\/+$/, '');

let portalCities = null;
const getPortalCities = async () => {
  if (portalCities) return portalCities;
  const res = await fetch(PORTAL_CITY_DETAILS_URL);
  if (!res.ok) throw new Error(`Portal CityDetails returned ${res.status}`);
  const json = await res.json();
  portalCities = Array.isArray(json) ? json : Object.values(json || {});
  return portalCities;
};

/** True when the logged-in city is Jaipur Office (the only city with a working branch). */
const isSourceLogin = async () => norm((await getActiveConfig())?.cityName) === norm(SOURCE_CITY_NAME);

/**
 * The employee's current branch city key (e.g. "dausa"), read fresh each time so a
 * branch change applies without logging in again. SOURCE_CITY_KEY when the
 * branch is blank / Jaipur / unknown or the login city is not Jaipur Office.
 */
export const getBranchCityKey = async (userId) => {
  try {
    if (!(await isSourceLogin())) return SOURCE_CITY_KEY;
    const branch = norm(await getData(`Employees/${userId}/GeneralDetails/branch`));
    if (!branch) return SOURCE_CITY_KEY;
    const city = (await getPortalCities()).find((c) => norm(c?.cityName) === branch);
    return city?.city || SOURCE_CITY_KEY;
  } catch (e) {
    console.log('[branch] could not resolve branch city:', e?.message);
    return SOURCE_CITY_KEY;
  }
};

/** Branch history entries sorted by from ([] when none). */
export const getBranchHistory = async (userId) => {
  try {
    if (!(await isSourceLogin())) return [];
    const data = await getData(`ExternalEmployeeBranchHistory/${userId}`);
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
      .filter((k) => k !== 'lastKey' && data[k] && data[k].from)
      .map((k) => data[k])
      .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  } catch (e) {
    console.log('[branch] could not read branch history:', e?.message);
    return [];
  }
};

/**
 * The city key the employee worked in at `at` ("yyyy-MM-dd HH:mm[:ss]"; strings compare in time order).
 * A record saved before a branch change belongs to the old city, after it to the new one.
 */
export const getCityKeyAt = (history, currentCityKey, at) => {
  const time = String(at || '');
  if (!history.length) return time >= BRANCH_HISTORY_START ? currentCityKey : SOURCE_CITY_KEY;
  if (time < String(history[0].from)) return SOURCE_CITY_KEY;
  const entry = history.find((e) => time >= String(e.from) && (!e.to || time < String(e.to)));
  return entry?.city || SOURCE_CITY_KEY;
};

/** Read a path from a city's database (by portal city key). The Jaipur Office / login city uses the default app. */
export const getDataFromCity = async (cityKey, path) => {
  if (!cityKey || cityKey === SOURCE_CITY_KEY) return getData(path);

  const portal = (await getPortalCities()).find((c) => c?.city === cityKey);
  if (!portal?.databaseURL) throw new Error(`No city details for ${cityKey}`);
  // Full credentials (appId) come from the app's city list, matched by database URL
  const { cities } = await fetchCities();
  const cfg = cities.find((c) => normUrl(c.databaseURL) === normUrl(portal.databaseURL));
  if (!cfg?.apiKey || !cfg?.appId) throw new Error(`No app config for ${cityKey}`);

  const name = `branch-${cityKey}`;
  const app =
    getApps().find((a) => a.name === name) ||
    (await initializeApp(
      {
        apiKey: cfg.apiKey,
        appId: cfg.appId,
        projectId: cfg.projectId,
        databaseURL: cfg.databaseURL,
        storageBucket: cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
      },
      name,
    ));
  const snapshot = await dbGet(dbRef(getDatabase(app, cfg.databaseURL), path));
  return snapshot.exists() ? snapshot.val() : null;
};

/**
 * The "Other" task list (FieldExecutiveData/Tasks) of a city. No fallback to another
 * city's list: the same task id means a different task in each city.
 */
export const getTaskCatalogue = (cityKey) => getDataFromCity(cityKey, 'FieldExecutiveData/Tasks');
