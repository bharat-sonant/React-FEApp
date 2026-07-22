/**
 * Location tracking — domain layer. Ported from the IEC app and adapted to this
 * app's session (AsyncStorage) + Firebase.
 *
 * IMPORTANT: saving is done NATIVELY. JS only hands the native service the
 * destination once (Firebase path + the active city's DB creds); the service
 * then writes every minute snapshot to Firebase itself, so tracking keeps
 * saving even when the JS bridge / app is killed.
 *
 * Path (unchanged from the old native Field Executive app, so the admin portal
 * keeps reading it):
 *   FieldExecutiveData/FiledExecutiveLocationHistory/{empId}/{yyyy}/{MMMM}/{yyyy-MM-dd}/{HH:mm}
 *      { 'lat-lng': "(lat,lng)~...", 'distance-in-meter': <n> }
 *   ...{date} root:
 *      { TotalCoveredDistance: <running>, 'last-update-time': "HH:mm" }
 *
 * NOTE the key is misspelled "FiledExecutive…" — kept exactly; it's what the
 * backend reads. Do not "fix" it.
 */
import { storage } from '../utils/storage';
import {
  setTrackingConfig,
  setSaveConfig,
  startLocationTracking as nativeStart,
  stopLocationTracking as nativeStop,
  subscribeToLocation,
  subscribeToMinuteSnapshot,
  getCurrentLocation,
  getLocalityFromLatLng,
} from './native/locationTracker';

const LOCATION_ROOT = 'FieldExecutiveData/FiledExecutiveLocationHistory'; // sic — matches backend

const asString = (v) => (v == null ? '' : String(v).trim());

/** The empId used for the tracking path — same value the tasks use. */
const getEmpId = async () => asString((await storage.getUser())?.userId);

// ---- Tuning defaults (same as IEC's LocationContext) ----
const DEFAULT_CONFIG = {
  gpsIntervalMs: 10000,
  accuracyThresholdM: 50,
  minDistanceM: 10,
  snapshotIntervalMs: 60000,
  stillIntervalMs: 30000,
  stillSpeedKmh: 3.0,
  stillFixCount: 3,
  // Restore high accuracy on the FIRST movement fix after a still spell, so a
  // turn taken right after stopping isn't cut by the slower low-power interval.
  moveFixCount: 1,
};

/**
 * Start tracking for the logged-in user. Hands the native service everything it
 * needs to save snapshots on its own, then starts it.
 */
export const startUserLocationTracking = async (config = DEFAULT_CONFIG) => {
  try {
    const empId = await getEmpId();
    if (!empId) throw new Error('User not logged in');

    const city = await storage.getCity();
    if (!city?.databaseURL || !city?.apiKey) throw new Error('No city config');

    // Where + how the native service saves (Firebase creds + base path), plus
    // empId so native can watch this user's punch-out node.
    setSaveConfig({
      basePath: `${LOCATION_ROOT}/${empId}`,
      empId,
      apiKey: city.apiKey,
      appId: city.appId,
      projectId: city.projectId,
      databaseURL: city.databaseURL,
    });

    setTrackingConfig(config);
    // Battery-optimisation exemption is asked for (with a themed dialog) by
    // LocationPermissionFlow, not here.
    nativeStart();
    return { success: true, empId };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
};

export const stopUserLocationTracking = () => {
  try {
    nativeStop();
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
};

export const subscribeToUserLocation = (callback) => subscribeToLocation(callback);

/**
 * Live minute snapshots — for any UI that wants "distance today" etc. Saving is
 * handled natively; subscribing here is optional and does NOT persist anything.
 */
export const subscribeToTravelSnapshots = (callback) => subscribeToMinuteSnapshot(callback);

// ---- Current location (with a short cache + reverse geocode) ----
let cachedLocation = null;
let lastLocationTime = 0;
const LOCATION_CACHE_MS = 5000;

/**
 * Reverse geocode the fix into an address. Network is guaranteed here (the app
 * is blocked when offline), so this normally returns in ~1-2s; the timeout is
 * just a safety cap for a slow/failed geocoder, not the common case. One quick
 * retry, since the platform Geocoder occasionally returns empty on the first try.
 */
const geocodeWithTimeout = async (lat, lng, ms = 5000) => {
  const once = () =>
    Promise.race([
      getLocalityFromLatLng(lat, lng).then((s) => String(s || '').trim()).catch(() => ''),
      new Promise((resolve) => setTimeout(() => resolve(''), ms)),
    ]);
  const first = await once();
  if (first) return first;
  return once(); // retry once before giving up
};

export const getUserCurrentLocation = async () => {
  try {
    const now = Date.now();
    if (cachedLocation && now - lastLocationTime < LOCATION_CACHE_MS) {
      return { success: true, location: cachedLocation };
    }

    // Fast native fix (last-known first) — no waiting on the live update stream.
    const location = await getCurrentLocation();
    if (!location?.latitude || !location?.longitude) {
      return { success: false, error: 'No location data' };
    }

    // Address is best-effort: the fix (latLng) is what matters; a slow or failed
    // geocode just leaves the address blank rather than blocking submit.
    const address = await geocodeWithTimeout(location.latitude, location.longitude);

    const result = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? 0,
      speed: location.speed ?? 0,
      address,
    };
    cachedLocation = result;
    lastLocationTime = now;
    return { success: true, location: result };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
};
