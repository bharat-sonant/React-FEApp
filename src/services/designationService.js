/**
 * Allowed field-executive designations.
 *
 * The old app downloaded Common/FieldExecutiveAvailableDesignations.json from
 * the root of the dtdnavigator storage bucket (a single global list, shared by
 * every city) and only let a user in if their designationId was in it. This is
 * the authorization filter that keeps non-field roles (drivers, etc.) out.
 *
 * The list is cached so a flaky network doesn't block login — the old app kept
 * it in SharedPreferences the same way.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DESIGNATIONS_URL =
  'https://firebasestorage.googleapis.com/v0/b/dtdnavigator.appspot.com/o/Common%2FFieldExecutiveAvailableDesignations.json?alt=media';

const CACHE_KEY = 'fe_allowedDesignations';

const normalise = (raw) =>
  (Array.isArray(raw) ? raw : []).map((x) => String(x).trim()).filter(Boolean);

// Session copy + in-flight de-dup, same as the city list.
let memoAllowed = null;
let inflightAllowed = null;

const loadDesignationsFromNetwork = async () => {
  try {
    const res = await fetch(DESIGNATIONS_URL);
    if (!res.ok) throw new Error(`Designations returned ${res.status}`);
    const list = normalise(await res.json());
    if (list.length) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(list));
      memoAllowed = list;
      return list;
    }
    throw new Error('Empty designation list');
  } catch {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      const list = cached ? normalise(JSON.parse(cached)) : [];
      if (list.length) {
        memoAllowed = list;
        return list;
      }
      return null;
    } catch {
      return null;
    }
  }
};

/**
 * The allowed designation ids. Returns the session copy instantly once loaded;
 * otherwise fetches (network → disk cache). Concurrent callers share one request.
 * Returns null only when there is neither network nor cache.
 * @param {boolean} force skip the session copy and hit the network
 */
export const getAllowedDesignations = async ({ force = false } = {}) => {
  if (!force && memoAllowed) return memoAllowed;
  if (!force && inflightAllowed) return inflightAllowed;

  inflightAllowed = loadDesignationsFromNetwork().finally(() => {
    inflightAllowed = null;
  });
  return inflightAllowed;
};

export const isDesignationAllowed = (allowed, designationId) =>
  Array.isArray(allowed) && allowed.includes(String(designationId).trim());
