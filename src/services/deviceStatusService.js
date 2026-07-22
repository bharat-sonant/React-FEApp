/**
 * Live internet + location (GPS) status, from our own native module.
 *
 * The native side pushes an event the instant either is toggled, so the UI
 * reacts immediately instead of polling. See
 * android/app/src/main/java/com/fieldexecutiveapp/devicestatus/DeviceStatusModule.kt
 */
import { NativeEventEmitter, NativeModules } from 'react-native';

const { DeviceStatus } = NativeModules;

const EVENT = 'deviceStatusChange';

// Assume everything is fine until told otherwise, so a missing module can never
// leave the app stuck behind a blocking overlay.
const ASSUME_OK = { network: true, location: true };

export const isSupported = () => !!DeviceStatus;

/** One-off read of the current state. */
export const getDeviceStatus = async () => {
  if (!DeviceStatus) return ASSUME_OK;
  try {
    const s = await DeviceStatus.getStatus();
    return { network: !!s?.network, location: !!s?.location };
  } catch {
    return ASSUME_OK;
  }
};

/**
 * Watch internet + location. The callback fires straight away with the current
 * state, then on every change.
 * @returns unsubscribe fn
 */
export const subscribeDeviceStatus = (fn) => {
  if (!DeviceStatus) {
    fn(ASSUME_OK);
    return () => {};
  }

  const emitter = new NativeEventEmitter(DeviceStatus);
  const sub = emitter.addListener(EVENT, (s) => {
    fn({ network: !!s?.network, location: !!s?.location });
  });

  // start() also emits the current state, so no separate initial read.
  try {
    DeviceStatus.start();
  } catch {
    fn(ASSUME_OK);
  }

  return () => {
    sub.remove();
    try {
      DeviceStatus.stop();
    } catch {
      // already torn down
    }
  };
};
