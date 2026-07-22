import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SplashScreen from './src/Screens/SplashScreen/SplashScreen';
import RootNavigator from './src/navigation/RootNavigator';
import { ToastProvider } from './src/context/ToastContext';
import { LocationProvider } from './src/context/LocationContext';
import DeviceStatusGate from './src/components/DeviceStatusGate';
import UpdateModal from './src/components/UpdateModal';
import { prefetchLoginData } from './src/services/bootstrapService';
import { processQueue } from './src/services/uploadQueueService';
import { checkForUpdates } from './src/services/otaService';
import { storage } from './src/utils/storage';
import { colors } from './src/theme/theme';

const App = () => {
  const [showSplash, setShowSplash] = useState(true);
  // null until we know; then 'Dashboard' (already logged in) or 'Login'.
  const [initialRoute, setInitialRoute] = useState(null);

  // OTA update state. When `update` is set, the modal is shown and routing waits.
  const [update, setUpdate] = useState(null); // { version, type, mandatory, apply }
  const [otaProgress, setOtaProgress] = useState(null);
  const [otaDownloading, setOtaDownloading] = useState(false);
  const [otaError, setOtaError] = useState('');

  useEffect(() => {
    // Warm up the city list + designations during the splash, so login is
    // instant and neither is fetched again this session.
    prefetchLoginData();

    // Persist the session: stay logged in until the user explicitly logs out.
    storage.isLoggedIn().then((loggedIn) => {
      setInitialRoute(loggedIn ? 'Dashboard' : 'Login');
      // Resume any media uploads left pending from a previous run.
      if (loggedIn) processQueue();
    });

    // Check for an app update (GitHub Releases). If one is found the modal
    // shows and holds; otherwise the app proceeds normally.
    checkForUpdates({
      onUpdateFound: (info) => setUpdate(info),
      onProgress: (p) => {
        setOtaDownloading(true);
        setOtaProgress(p);
      },
      onError: (msg) => {
        setOtaDownloading(false);
        setOtaError(msg);
      },
    }).catch(() => {});

    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const onUpdatePress = () => {
    setOtaError('');
    if (update?.type === 'native') {
      update.apply?.(); // exits the app; user reinstalls
      return;
    }
    setOtaDownloading(true);
    update?.apply?.();
  };

  // Keep the splash until the 2s elapse AND we know where to land.
  const showLoading = showSplash || initialRoute === null;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
      {showLoading ? (
        <SplashScreen />
      ) : (
        <ToastProvider>
          <LocationProvider>
            <RootNavigator initialRoute={initialRoute} />
            {/* Sits above every screen: nothing works without net, and tasks
                need location. Hides itself once both are back on. */}
            <DeviceStatusGate />
          </LocationProvider>
        </ToastProvider>
      )}

      {/* App-update dialog — shown over the splash or the app. */}
      <UpdateModal
        visible={!!update}
        type={update?.type}
        version={update?.version}
        mandatory={update?.mandatory}
        progress={otaProgress}
        downloading={otaDownloading}
        error={otaError}
        onUpdate={onUpdatePress}
      />
    </SafeAreaProvider>
  );
};

export default App;
