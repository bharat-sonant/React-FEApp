/**
 * Login logic — a faithful port of the old native app's LoginActivity, with one
 * change: the city is no longer picked on a separate screen. It is derived from
 * the login id itself ("AJM101" → city "AJM" + employee "101").
 *
 * Auth flow (old app):
 *   1. read Employees/{empId}/GeneralDetails from that city's database
 *   2. record must have status, password, designationId
 *   3. designationId is in the allowed field-executive list
 *   4. status == 1 (active)
 *   5. password matches: Base64(AES-256-ECB(pwd, key=SHA256(empId))) == stored
 *
 * Not enforced yet:
 *   - version check (Settings/LatestVersions/FieldExecutive) — DB values differ
 *     per city and would lock everyone out until we ship matching versions.
 */
import { fetchCities, resolveCityFromLoginId } from '../../services/cityService';
import { getAllowedDesignations, isDesignationAllowed } from '../../services/designationService';
import { getDataForCity, resetActiveConfig } from '../../firebase/firebaseService';
import { passwordMatches } from '../../utils/crypto';
import { storage } from '../../utils/storage';

/** Login id → uppercase, alphanumeric only (matches the old app's trim/filter). */
export const formatUserId = (value) =>
  String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const validateCredentials = ({ userId, password }) => {
  const uid = formatUserId(userId);
  if (!uid || !String(password || '').trim()) {
    return 'Please enter both User ID and Password';
  }
  if (!/^[A-Za-z]+\d+$/.test(uid)) {
    return 'Enter your ID as city code + number, e.g. AJM101';
  }
  return '';
};

export const getSelectedCity = () => storage.getCity();

/**
 * Perform login.
 * @returns { ok, message, user? }
 */
export const performLogin = async ({ userId, password }) => {
  const loginId = formatUserId(userId);
  const pwd = String(password || '').trim();

  // 1. Resolve the city from the id prefix
  let cities;
  try {
    ({ cities } = await fetchCities());
  } catch {
    return { ok: false, message: 'Cannot reach the server. Check your connection.' };
  }

  const resolved = resolveCityFromLoginId(cities, loginId);
  if (!resolved) {
    return { ok: false, message: 'Invalid user name or password' };
  }
  const { city, empId } = resolved;
  console.log('[login] resolved city from id', loginId, '→', {
    cityName: city.cityName,
    empId,
    projectId: city.projectId,
    databaseURL: city.databaseURL,
  });

  // 2. Read the employee record from that city's database
  let details;
  try {
    details = await getDataForCity(city, `Employees/${empId}/GeneralDetails`);
  } catch {
    return { ok: false, message: `Could not reach ${city.cityName}. Try again.` };
  }

  if (!details || details.status == null || details.password == null || details.designationId == null) {
    return { ok: false, message: 'You are not authorized to use' };
  }

  // 3. Designation must be in the allowed field-executive list (global list from
  //    Common/FieldExecutiveAvailableDesignations.json). Keeps non-field roles out.
  const allowed = await getAllowedDesignations();
  if (!isDesignationAllowed(allowed, details.designationId)) {
    return { ok: false, message: 'You are not authorized to use' };
  }

  // 4. Active account
  const active = String(details.status) === '1';
  if (!active) {
    return { ok: false, message: 'You are not authorized to use' };
  }

  // 5. Password — encrypted with the plain employee id, compared to the stored value
  if (!passwordMatches(pwd, empId, details.password)) {
    return { ok: false, message: 'Invalid user or password' };
  }

  // Success — persist city (its Firebase creds) + user, like the old app's prefs
  await storage.setCity(city);
  resetActiveConfig();

  const user = {
    loginId,
    userId: empId,
    employeeName: details.name || details.userName || empId,
    designationId: String(details.designationId),
    site: { siteName: city.cityName },
    empCode: details.empCode || `${city.empCode}${empId}`,
  };
  await storage.setLoggedIn(user);

  return { ok: true, message: 'Login successful!', user };
};
