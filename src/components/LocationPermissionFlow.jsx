import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BatteryFull, MapPin } from 'lucide-react-native';
import ConfirmDialog from './ConfirmDialog';
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from '../services/native/locationTracker';
import { colors } from '../theme/theme';

/**
 * Runtime permissions for tracking, with our OWN themed dialogs — no native
 * Alert. The OS grant dialogs (fine location, "Allow all the time") are the
 * system's and can't be skinned; what we replace is the *rationale* that would
 * otherwise pop up as a native Alert before them, plus the battery-optimisation
 * prompt.
 *
 * Sequence (Android):
 *   1. fine + coarse (+ notifications) — system dialog
 *   2. our dialog → then background location (Android 10+)
 *   3. our dialog → then battery-optimisation exemption
 */
const LocationPermissionFlow = () => {
  // 'init' | 'background' | 'battery' | 'done'
  const [step, setStep] = useState('done');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    (async () => {
      try {
        const batch = [
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ];
        if (Platform.Version >= 33) batch.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        const res = await PermissionsAndroid.requestMultiple(batch);
        if (!alive) return;

        const fineGranted =
          res[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;

        if (fineGranted && Platform.Version >= 29) {
          const bgGranted = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
          );
          if (alive && !bgGranted) {
            setStep('background');
            return;
          }
        }
        if (alive) await goBatteryOrDone();
      } catch {
        if (alive) setStep('done');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBatteryOrDone = async () => {
    try {
      const ignoring = await isIgnoringBatteryOptimizations();
      if (!ignoring) {
        setStep('battery');
        return;
      }
    } catch {
      // fall through
    }
    setStep('done');
  };

  const onBackgroundConfirm = async () => {
    setStep('done');
    try {
      // No rationale object → no native Alert; our dialog already explained it.
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
    } catch {
      // ignore
    }
    await goBatteryOrDone();
  };

  const onBatteryConfirm = async () => {
    setStep('done');
    try {
      await requestIgnoreBatteryOptimizations();
    } catch {
      // ignore
    }
  };

  return (
    <>
      <ConfirmDialog
        visible={step === 'background'}
        icon={<MapPin size={22} color={colors.primary} />}
        title="Allow Location All the Time"
        message={
          'Your route is recorded during duty even when the app is in the background. ' +
          'On the next screen, please choose "Allow all the time".'
        }
        confirmLabel="Continue"
        cancelLabel="Not now"
        onConfirm={onBackgroundConfirm}
        onCancel={goBatteryOrDone}
      />
      <ConfirmDialog
        visible={step === 'battery'}
        icon={<BatteryFull size={22} color={colors.primary} />}
        title="Keep Tracking Running"
        message={
          'To keep location tracking alive in the background, allow the app to ignore ' +
          'battery optimisation on the next screen.'
        }
        confirmLabel="Open Settings"
        cancelLabel="Skip"
        onConfirm={onBatteryConfirm}
        onCancel={() => setStep('done')}
      />
    </>
  );
};

export default LocationPermissionFlow;
