/**
 * City list — fetched from the same CityDetails.json the old native app used.
 *
 * The file is a flat array; each entry carries the full Firebase credentials
 * for that city (dbPath / storageBucket / apiKey / appId / …), which is what
 * lets the app talk to a different Firebase project per city.
 *
 * The list is cached so a flaky network doesn't block login — exactly like the
 * old app, which kept CityDetails in SharedPreferences.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CITY_DETAILS_URL =
  'https://firebasestorage.googleapis.com/v0/b/dtdnavigator.appspot.com/o/CityDetails%2FCityDetails.json?alt=media&token=6cc247c8-3957-49f9-a770-4b8c77b457b6';

const CACHE_KEY = 'fe_cityDetails';

/**
 * Internal-only cities. They stay in the data (the logo shortcut connects to
 * DevTest) but never appear in the picker.
 */
export const HIDDEN_CITY_NAMES = ['Test', 'DevTest', 'Jaipur-Test', 'MNZ-Test', 'MPZ-Test'];

export const DEV_CITY_NAME = 'DevTest';

export const isHiddenCity = (c) => HIDDEN_CITY_NAMES.includes(String(c?.cityName || '').trim());

const isUsable = (c) =>
  c &&
  typeof c.cityName === 'string' &&
  c.cityName.trim() &&
  typeof c.databaseURL === 'string' &&
  c.databaseURL.trim() &&
  typeof c.apiKey === 'string' &&
  c.apiKey.trim();

/** All usable cities (hidden ones included — callers decide what to show). */
const normalise = (raw) => {
  // Tolerate both an array and an object-map of cities.
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list.filter(isUsable).sort((a, b) => a.cityName.localeCompare(b.cityName));
};

/** Only the cities the picker should list. */
export const visibleOf = (cities = []) => cities.filter((c) => !isHiddenCity(c));

/** Look a city up by name, hidden ones included (used by the DevTest shortcut). */
export const findCityByName = (cities = [], name) =>
  cities.find((c) => String(c.cityName || '').trim() === String(name).trim()) || null;

/**
 * Split a login id like "AJM101" into its city code and employee id.
 * The leading letters are the city's empCode ("AJM"); the trailing digits are
 * the employee's node id ("101").
 * @returns { cityCode, empId } or null if the id isn't in that shape.
 */
export const parseLoginId = (loginId) => {
  const m = String(loginId || '').trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  return { cityCode: m[1].toUpperCase(), empId: m[2] };
};

/**
 * Find the city whose empCode matches the login id's prefix.
 * @returns { city, empId } or null.
 */
export const resolveCityFromLoginId = (cities = [], loginId) => {
  const parsed = parseLoginId(loginId);
  if (!parsed) return null;
  const city = cities.find(
    (c) => String(c.empCode || '').trim().toUpperCase() === parsed.cityCode,
  );
  return city ? { city, empId: parsed.empId } : null;
};

export const getCachedCities = async () => {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? normalise(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

// Kept for the whole session so no login ever re-downloads the 47 KB list.
// `inflight` de-dupes concurrent callers (e.g. the startup prefetch and the
// first login) so they share one network request. Cleared on app restart.
let memoCities = null; // { cities, fromCache }
let inflightCities = null; // Promise<{ cities, fromCache }>

const loadCitiesFromNetwork = async () => {
  try {
    const res = await fetch(CITY_DETAILS_URL);
    if (!res.ok) throw new Error(`CityDetails returned ${res.status}`);

    const json = await res.json();
    const cities = normalise(json);
    if (!cities.length) throw new Error('City list is empty');

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json));
    memoCities = { cities, fromCache: false };
    return memoCities;
  } catch (err) {
    const cached = await getCachedCities();
    if (cached?.length) {
      memoCities = { cities: cached, fromCache: true };
      return memoCities;
    }
    throw new Error(
      'Could not load the city list. Check your internet connection and try again.',
    );
  }
};

/**
 * The city list. Returns the session copy instantly once loaded; otherwise
 * fetches (network → disk cache) and remembers it. Concurrent callers share one
 * request.
 * @param {boolean} force skip the session copy and hit the network
 * @returns { cities, fromCache }
 */
export const fetchCities = async ({ force = false } = {}) => {
  if (!force && memoCities) return memoCities;
  if (!force && inflightCities) return inflightCities;

  inflightCities = loadCitiesFromNetwork().finally(() => {
    inflightCities = null;
  });
  return inflightCities;
};
