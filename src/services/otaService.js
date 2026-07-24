/**
 * OTA update service. Ported from the IEC app, driven by GitHub Releases so it
 * needs no Firebase connection at startup (none exists before login here).
 *
 * checkForUpdates() looks at the repo's latest release and decides:
 *   • DB / installed / release-tag version mismatch       → mandatory native block
 *   • ota-package.zip / index.android.bundle asset, new id → seamless JS update
 *   • newer tag with no JS asset (APK-only release)       → mandatory native block
 *   • same version                                        → up to date
 *
 * The version mismatch gate reads the admin-controlled latest native version
 * from the active city's Realtime DB (OTA_DB_PATH), mirroring the IEC app. It
 * is best-effort: Firebase is only reachable once a city is connected, so for a
 * not-yet-logged-in user the DB read fails and this gate is skipped.
 *
 * Native side: NativeModules.OtaUpdater (getAppVersion / install / restart).
 */
import { BackHandler, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getData } from '../firebase/firebaseService';
import {
  ENABLE_JS_BUNDLE_OTA,
  OTA_DB_PATH,
  OTA_GITHUB_TOKEN,
  OTA_RELEASES_URL,
} from '../constants/appVersion';

const { OtaUpdater } = NativeModules;

const OTA_PACKAGE_PATH = `${RNFS.DocumentDirectoryPath}/ota-package.zip`;
const LEGACY_BUNDLE_PATH = `${RNFS.DocumentDirectoryPath}/index.android.bundle`;
const LAST_ASSET_KEY = 'FE_LAST_BUNDLE_ASSET_ID';

const normalizeVersion = (v) => String(v ?? '').replace(/^v/i, '').trim();

const downloadHeaders = () =>
  OTA_GITHUB_TOKEN
    ? { Authorization: `token ${OTA_GITHUB_TOKEN}`, Accept: 'application/octet-stream' }
    : {};

const safeDelete = async (path) => {
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  } catch {
    // ignore
  }
};

const getInstalledVersion = async () => {
  try {
    return normalizeVersion(await OtaUpdater?.getAppVersion?.());
  } catch {
    return '';
  }
};

/**
 * The admin-controlled latest native version from the active city's Realtime
 * DB (OTA_DB_PATH). Firebase is only reachable once a city is connected, so
 * before login this throws and we return '' — the DB gate is then skipped.
 * The node may be a bare version string or an object like { version: '...' }.
 */
const getDbVersion = async () => {
  try {
    const payload = await getData(OTA_DB_PATH);
    const raw = typeof payload === 'string' ? payload : payload?.version;
    console.log('[ota] db read', OTA_DB_PATH, '→', JSON.stringify(payload));
    return normalizeVersion(raw);
  } catch (e) {
    console.log('[ota] db read failed (no city / offline?):', e?.message || String(e));
    return '';
  }
};

export const restartApp = () => {
  try {
    OtaUpdater?.restart?.();
  } catch {
    BackHandler.exitApp();
  }
};

/**
 * Download the release asset and apply it, then restart.
 * @param onProgress (percent 0-100)
 */
const downloadAndApply = async (url, assetName, assetId, { onProgress, onComplete, onError } = {}) => {
  try {
    const isRawBundle = assetName === 'index.android.bundle';
    const toFile = isRawBundle ? LEGACY_BUNDLE_PATH : OTA_PACKAGE_PATH;
    await safeDelete(toFile);

    const result = await RNFS.downloadFile({
      fromUrl: url,
      toFile,
      headers: downloadHeaders(),
      background: true,
      progress: (res) => {
        if (res.contentLength > 0) {
          onProgress?.(Math.min(100, Math.round((res.bytesWritten / res.contentLength) * 100)));
        }
      },
      progressInterval: 250,
    }).promise;

    if (result.statusCode !== 200) throw new Error(`Download failed (${result.statusCode})`);

    if (!isRawBundle) {
      if (!OtaUpdater?.install) throw new Error('OtaUpdater native module unavailable');
      await OtaUpdater.install(OTA_PACKAGE_PATH);
      await safeDelete(LEGACY_BUNDLE_PATH); // a zip update supersedes any raw bundle
      await safeDelete(OTA_PACKAGE_PATH);
    }

    if (assetId) await AsyncStorage.setItem(LAST_ASSET_KEY, assetId);
    onComplete?.();
    setTimeout(restartApp, 800);
  } catch (e) {
    onError?.(e?.message || String(e));
  }
};

/**
 * Check for an update. Calls onUpdateFound({ version, type, mandatory, apply })
 * when one exists. Returns true if an update was surfaced (so the caller can
 * hold navigation), false otherwise.
 */
export const checkForUpdates = async (callbacks = {}) => {
  const { onUpdateFound, onProgress, onComplete, onError } = callbacks;
  if (__DEV__ || Platform.OS !== 'android') return false;

  try {
    // ---- DB-driven mandatory native gate (IEC parity) ----
    // The admin controls the latest native version in the active city's DB
    // (OTA_DB_PATH). If the installed APK is behind it, the native build is
    // stale → block until the user installs the new APK. This runs FIRST and
    // needs no GitHub release, so "Version Expired" works even before any
    // release is published. Skipped when no city is connected (dbVersion is '').
    const dbVersion = await getDbVersion();
    const installed = await getInstalledVersion();
    console.log('[ota] version gate:', { dbVersion, installed });
    if (dbVersion && installed && dbVersion !== installed) {
      console.log('[ota] version expired → native block', { dbVersion, installed });
      onUpdateFound?.({
        version: dbVersion,
        type: 'native',
        mandatory: true,
        apply: restartApp, // button exits; user reinstalls the APK
      });
      return true;
    }

    const res = await fetch(OTA_RELEASES_URL, {
      headers: OTA_GITHUB_TOKEN ? { Authorization: `token ${OTA_GITHUB_TOKEN}` } : {},
    });
    if (!res.ok) {
      console.log('[ota] release fetch not ok:', res.status);
      return false;
    }

    const release = await res.json();
    const latestVersion = normalizeVersion(release?.tag_name);
    if (!latestVersion) return false;

    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const jsAsset =
      assets.find((a) => a?.name === 'ota-package.zip') ||
      assets.find((a) => a?.name === 'index.android.bundle');

    // Seamless JS-bundle update — driven purely by the asset id, like the IEC
    // app: a fresh ota-package.zip published on the SAME release tag is still
    // an update. No version comparison here (a JS OTA never changes the
    // installed versionName anyway).
    if (ENABLE_JS_BUNDLE_OTA && jsAsset) {
      const assetId = String(jsAsset.id);
      const applied = await AsyncStorage.getItem(LAST_ASSET_KEY);
      if (assetId === applied) return false; // this bundle is already live

      const url = OTA_GITHUB_TOKEN ? jsAsset.url : jsAsset.browser_download_url;
      onUpdateFound?.({
        version: latestVersion,
        type: 'js',
        mandatory: false,
        apply: () => downloadAndApply(url, jsAsset.name, assetId, { onProgress, onComplete, onError }),
      });
      return true;
    }

    // APK-only release (no JS asset): a native change. Fallback for when the DB
    // gate above was skipped (no city connected). Block only when the release
    // tag has moved past the installed APK's versionName.
    if (!installed || latestVersion === installed) return false;
    onUpdateFound?.({
      version: latestVersion,
      type: 'native',
      mandatory: true,
      apply: restartApp, // button exits; user reinstalls the APK
    });
    return true;
  } catch (e) {
    console.log('[ota] check error:', e?.message || String(e));
    onError?.(e?.message || String(e));
    return false;
  }
};
