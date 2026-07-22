/**
 * OTA update service. Ported from the IEC app, driven by GitHub Releases so it
 * needs no Firebase connection at startup (none exists before login here).
 *
 * checkForUpdates() looks at the repo's latest release and decides:
 *   • ota-package.zip / index.android.bundle asset, new id → seamless JS update
 *   • newer tag with no JS asset (APK-only release)       → mandatory native block
 *   • same version                                        → up to date
 *
 * Native side: NativeModules.OtaUpdater (getAppVersion / install / restart).
 */
import { BackHandler, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ENABLE_JS_BUNDLE_OTA,
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
    const res = await fetch(OTA_RELEASES_URL, {
      headers: OTA_GITHUB_TOKEN ? { Authorization: `token ${OTA_GITHUB_TOKEN}` } : {},
    });
    if (!res.ok) return false;

    const release = await res.json();
    const latestVersion = normalizeVersion(release?.tag_name);
    const installed = await getInstalledVersion();
    if (!latestVersion || latestVersion === installed) return false;

    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const jsAsset =
      assets.find((a) => a?.name === 'ota-package.zip') ||
      assets.find((a) => a?.name === 'index.android.bundle');

    // Seamless JS-bundle update.
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

    // No JS bundle for a newer version → the native app itself changed → block
    // and ask the user to install the new APK.
    onUpdateFound?.({
      version: latestVersion,
      type: 'native',
      mandatory: true,
      apply: restartApp, // button exits; user reinstalls the APK
    });
    return true;
  } catch (e) {
    onError?.(e?.message || String(e));
    return false;
  }
};
