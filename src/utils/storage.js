/**
 * Thin persistence wrapper — replaces the web app's localStorage / the
 * old native app's SharedPreferences ("path"). Firebase-agnostic.
 *
 * Resilient by design: if the AsyncStorage native module isn't linked yet
 * (e.g. before a fresh native rebuild after install), it transparently falls
 * back to an in-memory store so the UI flow never crashes. Once the app is
 * rebuilt with the native module, real on-disk persistence kicks in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  isLoggedIn: 'fe_isLoggedIn',
  user: 'fe_user',
  city: 'fe_city',
  loginDate: 'fe_loginDate',
};

/** Local calendar day, yyyy-MM-dd — the session is valid only for this day. */
const todayKey = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// Detect whether the AsyncStorage native module is actually available.
const nativeAvailable =
  AsyncStorage && typeof AsyncStorage.setItem === 'function';

// In-memory fallback (session-only) used when the native module is missing.
const memory = new Map();

const store = nativeAvailable
  ? {
      setItem: (k, v) => AsyncStorage.setItem(k, v),
      getItem: (k) => AsyncStorage.getItem(k),
      removeItem: (k) => AsyncStorage.removeItem(k),
    }
  : {
      setItem: async (k, v) => memory.set(k, v),
      getItem: async (k) => (memory.has(k) ? memory.get(k) : null),
      removeItem: async (k) => memory.delete(k),
    };

if (!nativeAvailable) {
  console.warn(
    '[storage] AsyncStorage native module not linked — using in-memory fallback. ' +
      'Run "npx react-native run-android" for persistent storage.',
  );
}

export const storage = {
  async setLoggedIn(user) {
    await store.setItem(KEYS.isLoggedIn, 'true');
    await store.setItem(KEYS.user, JSON.stringify(user || {}));
    await store.setItem(KEYS.loginDate, todayKey());
  },

  async getUser() {
    const raw = await store.getItem(KEYS.user);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  /**
   * Logged in AND the session is from today. A session from a previous day is
   * expired — it's cleared here so the next day requires a fresh login.
   */
  async isLoggedIn() {
    if ((await store.getItem(KEYS.isLoggedIn)) !== 'true') return false;
    const date = await store.getItem(KEYS.loginDate);
    if (date !== todayKey()) {
      await this.logout();
      return false;
    }
    return true;
  },

  async logout() {
    await store.removeItem(KEYS.isLoggedIn);
    await store.removeItem(KEYS.user);
    await store.removeItem(KEYS.loginDate);
  },

  /**
   * Selected city — holds cityName / dbPath / key / storagePath, the same
   * values the old app kept in SharedPreferences and used to pick the
   * city-specific Firebase database and storage bucket.
   */
  async setCity(city) {
    await store.setItem(KEYS.city, JSON.stringify(city || {}));
  },

  async getCity() {
    const raw = await store.getItem(KEYS.city);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  async clearCity() {
    await store.removeItem(KEYS.city);
  },
};

export default storage;
