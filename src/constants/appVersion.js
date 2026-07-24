/**
 * OTA / app-update configuration. Ported from the IEC app.
 *
 * The update system is GitHub-Releases driven (no Firebase needed at startup,
 * which matters here since no city/Firebase is connected before login):
 *
 *   • A release that ships an `ota-package.zip` (or raw `index.android.bundle`)
 *     asset  → seamless JS-bundle hot update (download → apply → restart).
 *   • A newer release tag with NO JS bundle (an APK-only release)
 *     → native change → the app blocks and asks the user to install the new APK.
 *
 * Keep RELEASE_VERSION in sync with android/app/build.gradle `versionName`.
 */

// Master switch for the seamless JS-bundle hot-update path.
export const ENABLE_JS_BUNDLE_OTA = true;

// Must match android/app/build.gradle `versionName`.
export const RELEASE_VERSION = '1.0.0.1';

/**
 * CI publish flags (read by .github/workflows/publish-ota.yml on push to main).
 *   OTA  → publish a JS-bundle update (seamless, no reinstall) — the default.
 *   APK  → publish a signed release APK (for native changes). When APK is on,
 *          OTA is skipped that run (a native release, not a JS hot-fix).
 * Flip these before pushing depending on what the release contains.
 */
export const PUBLISH_OTA_BY_DEFAULT = false;
export const PUBLISH_APK_BY_DEFAULT = true;

/**
 * GitHub "latest release" API for your APK/OTA repo. FILL THIS IN:
 *   https://api.github.com/repos/<owner>/<repo>/releases/latest
 */
export const OTA_RELEASES_URL =
  'https://api.github.com/repos/bharat-sonant/React-FEApp/releases/latest';

/**
 * Optional GitHub token — only needed for a PRIVATE repo (to read the release
 * and download assets). Leave '' for a public repo. NOTE: a token shipped in
 * the bundle is readable by anyone who extracts it; prefer a public repo.
 */
export const OTA_GITHUB_TOKEN = '';

/**
 * Realtime-DB node holding the admin-controlled latest *native* version for
 * this app — e.g. { version: '1.0.0.1' } (a bare version string also works).
 * Read from the ACTIVE CITY's database, so this gate only applies once a city
 * is connected (a returning/logged-in user); before that it is skipped and the
 * check falls back to GitHub-only. Mirrors the IEC app's
 * Settings/LatestVersions/IECNativeApp. See otaService.checkForUpdates().
 */
export const OTA_DB_PATH = 'Settings/LatestVersions/FieldExecutiveNative';
