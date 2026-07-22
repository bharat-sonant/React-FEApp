/**
 * CitySelection screen logic — permissions, loading the city list and saving
 * the picked city. The screen stays presentational.
 */
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import {
  fetchCities,
  visibleOf,
  findCityByName,
  DEV_CITY_NAME,
} from '../../services/cityService';
import { connectToCity, resetActiveConfig } from '../../firebase/firebaseService';
import { storage } from '../../utils/storage';

/** Location + Camera are mandatory; notifications are nice-to-have. */
export const requestAppPermissions = async () => {
  if (Platform.OS !== 'android') return true;

  const mandatory = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.CAMERA,
  ];
  const requested = [...mandatory];
  if (Number(Platform.Version) >= 33) {
    requested.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  try {
    const res = await PermissionsAndroid.requestMultiple(requested);
    return mandatory.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
};

export const openAppSettings = () => Linking.openSettings();

/**
 * Load the city list (network, falling back to cache) and pre-select whatever
 * city was chosen last time.
 * @returns { cities (shown in the picker), all (incl. hidden), fromCache, selectedKey }
 */
export const loadCities = async () => {
  const { cities: all, fromCache } = await fetchCities();
  const cities = visibleOf(all);
  const saved = await storage.getCity();
  const selectedKey = saved?.key && cities.some((c) => c.key === saved.key) ? saved.key : null;
  return { cities, all, fromCache, selectedKey };
};

export const filterCities = (cities, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return cities;
  return cities.filter((c) => c.cityName.toLowerCase().includes(q));
};

/**
 * Persist the chosen city and connect to its Firebase project.
 *
 * The CityDetails entry holds that city's own Firebase credentials, so this is
 * where the app actually binds to the right project. Connecting here (rather
 * than at login) means a wrong config or a dead network surfaces immediately,
 * on the screen that caused it.
 *
 * @throws if the city's Firebase project can't be reached.
 */
export const selectCity = async (city) => {
  if (!city) throw new Error('Please select a city');

  await storage.setCity(city);
  resetActiveConfig(); // drop cached config so the next call uses this city

  try {
    await connectToCity();
  } catch (e) {
    // Don't leave a city saved that we couldn't connect to.
    await storage.clearCity();
    resetActiveConfig();
    throw e;
  }
  return true;
};

/**
 * Hidden dev shortcut: tapping the app logo connects to DevTest, which is not
 * listed in the picker.
 * @param all the full city list (hidden included) from loadCities()
 */
export const connectToDevCity = async (all = []) => {
  const dev = findCityByName(all, DEV_CITY_NAME);
  if (!dev) throw new Error(`${DEV_CITY_NAME} is not available in the city list`);
  await selectCity(dev);
  return dev;
};
