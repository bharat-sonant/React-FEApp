/**
 * App warm-up — prefetch the static config the login screen needs (city list +
 * allowed designations) while the splash is showing, so the very first login is
 * instant and nothing is fetched again for the rest of the session.
 *
 * Fire-and-forget: failures are swallowed here because login already has its own
 * network → cache fallback. This is purely an optimisation.
 */
import { fetchCities } from './cityService';
import { getAllowedDesignations } from './designationService';

export const prefetchLoginData = () => {
  // Not awaited by the caller — runs during the splash delay.
  fetchCities().catch(() => {});
  getAllowedDesignations().catch(() => {});
};
