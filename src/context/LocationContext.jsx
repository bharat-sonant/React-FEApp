import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import LocationPermissionFlow from '../components/LocationPermissionFlow';
import {
  startUserLocationTracking,
  stopUserLocationTracking,
  subscribeToUserLocation,
} from '../services/locationTrackingService';

const LocationContext = createContext(null);

/**
 * Owns the location tracking lifecycle. Ported from the IEC app.
 *
 * Saving is done NATIVELY — the service writes each minute snapshot to Firebase
 * itself. JS here only starts/stops the service and keeps a live location for
 * the UI; it does not persist anything.
 */
export const LocationProvider = ({ children }) => {
  const [tracking, setTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const locSubRef = useRef(null);

  const startTracking = useCallback(async () => {
    if (locSubRef.current) return { success: true }; // already running

    // Live location for the UI only — the native service does the saving.
    locSubRef.current = subscribeToUserLocation((loc) => {
      if (loc?.latitude && loc?.longitude) setCurrentLocation(loc);
    });

    const res = await startUserLocationTracking();
    setTracking(res.success);
    return res;
  }, []);

  const stopTracking = useCallback(async () => {
    stopUserLocationTracking();
    locSubRef.current?.();
    locSubRef.current = null;
    setTracking(false);
    setCurrentLocation(null);
  }, []);

  // Clean up the subscription if the provider ever unmounts.
  useEffect(
    () => () => {
      locSubRef.current?.();
    },
    [],
  );

  return (
    <LocationContext.Provider value={{ tracking, currentLocation, startTracking, stopTracking }}>
      {children}
      {/* Themed permission prompts (no native Alert). */}
      <LocationPermissionFlow />
    </LocationContext.Provider>
  );
};

export const useLocation = () => {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within a LocationProvider');
  return ctx;
};
