/**
 * Thin JS wrapper over the native LocationTracker module (Android only).
 * Ported from the IEC app.
 *
 * See android/app/src/main/java/com/fieldexecutiveapp/location/*
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const { LocationTracker } = NativeModules;

const emitter =
  Platform.OS === 'android' && LocationTracker ? new NativeEventEmitter(LocationTracker) : null;

export const isLocationTrackerAvailable = () => !!LocationTracker;

/**
 * Persist tuning config. Must be called BEFORE startLocationTracking().
 *   gpsIntervalMs, accuracyThresholdM, minDistanceM, snapshotIntervalMs,
 *   stillIntervalMs, stillSpeedKmh, stillFixCount, moveFixCount
 */
export const setTrackingConfig = (config) => {
  if (Platform.OS === 'android' && config && LocationTracker?.setTrackingConfig) {
    LocationTracker.setTrackingConfig(config);
  }
};

/**
 * Tell native WHERE + HOW to save snapshots, so it can write to Firebase itself
 * (no JS round-trip). Persisted natively, survives a process restart.
 *   { basePath, apiKey, appId, projectId, databaseURL }
 */
export const setSaveConfig = (config) => {
  if (Platform.OS === 'android' && config && LocationTracker?.setSaveConfig) {
    LocationTracker.setSaveConfig(config);
  }
};

/** Launch the system battery-optimisation exemption flow. */
export const requestIgnoreBatteryOptimizations = async () => {
  if (Platform.OS !== 'android' || !LocationTracker?.requestIgnoreBatteryOptimizations) return false;
  try {
    return await LocationTracker.requestIgnoreBatteryOptimizations();
  } catch {
    return false;
  }
};

export const isIgnoringBatteryOptimizations = async () => {
  if (Platform.OS !== 'android' || !LocationTracker?.isIgnoringBatteryOptimizations) return false;
  try {
    return await LocationTracker.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
};

/** Start the foreground tracking service. setTrackingConfig() first if needed. */
export const startLocationTracking = () => {
  if (Platform.OS === 'android' && LocationTracker) {
    LocationTracker.clearTrackingStopFlags?.();
    LocationTracker.startTracking();
  }
};

/** Stop the foreground tracking service (logout / end duty). */
export const stopLocationTracking = () => {
  if (Platform.OS === 'android' && LocationTracker) {
    LocationTracker.markManualStop?.();
    LocationTracker.stopTracking();
  }
};

/**
 * Real-time location updates. callback({ latitude, longitude, accuracy, speed }).
 * @returns unsubscribe fn
 */
export const subscribeToLocation = (callback) => {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onLocationUpdate', callback);
  return () => sub.remove();
};

/**
 * Per-minute travel snapshots.
 * callback({ path: "(lat,lng)~(lat,lng)~...", distanceInMeters, timestamp, date, time }).
 * @returns unsubscribe fn
 */
export const subscribeToMinuteSnapshot = (callback) => {
  if (!emitter) return () => {};
  const sub = emitter.addListener('onMinuteSnapshot', callback);
  return () => sub.remove();
};

/** Snapshots buffered to disk while the JS bridge was dead. */
export const getPendingSnapshots = () => {
  if (Platform.OS !== 'android' || !LocationTracker?.getPendingSnapshots) return Promise.resolve([]);
  return LocationTracker.getPendingSnapshots();
};

export const clearPendingSnapshots = () => {
  if (Platform.OS === 'android' && LocationTracker?.clearPendingSnapshots) {
    LocationTracker.clearPendingSnapshots();
  }
};

/**
 * A location fix as fast as possible (last-known first). Resolves
 * { latitude, longitude, accuracy, speed } or null. Guarded with a timeout so a
 * cold fresh-fix request can never hang task submit.
 */
export const getCurrentLocation = (timeoutMs = 6000) => {
  if (Platform.OS !== 'android' || !LocationTracker?.getCurrentLocation) return Promise.resolve(null);
  return Promise.race([
    LocationTracker.getCurrentLocation().catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
};

export const getLocalityFromLatLng = async (latitude, longitude) => {
  if (Platform.OS !== 'android' || !LocationTracker?.getLocalityFromLatLng) return '';
  try {
    const locality = await LocationTracker.getLocalityFromLatLng(Number(latitude), Number(longitude));
    return String(locality || '');
  } catch {
    return '';
  }
};
