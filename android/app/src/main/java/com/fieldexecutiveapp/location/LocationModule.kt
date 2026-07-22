package com.fieldexecutiveapp.location

import android.content.Context
import android.content.Intent
import android.location.Geocoder
import android.location.Location
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.Locale

/**
 * Bridge for the background location tracker. Ported from the IEC app.
 *
 * Exposed to JS as NativeModules.LocationTracker. The heavy lifting (GPS fixes,
 * per-minute snapshots, adaptive power) lives in LocationForegroundService; this
 * module just starts/stops it, stores tuning config, and exposes helpers.
 */
class LocationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val RUNTIME_PREFS = "fe_tracking_runtime"
        private const val KEY_MANUAL_STOP = "manual_stop"
        private const val KEY_AUTO_STOP_DATE = "auto_stop_date"
        // True between an explicit start (login/duty) and stop (logout). Lets a
        // post-reboot BOOT_COMPLETED decide whether to resume tracking headlessly.
        private const val KEY_TRACKING_ACTIVE = "tracking_active"
        private const val DAILY_CUTOFF_HOUR = 23

        fun todayKey(nowMs: Long = System.currentTimeMillis()): String {
            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            return fmt.format(java.util.Date(nowMs))
        }

        private fun prefs(context: Context) = context.getSharedPreferences(RUNTIME_PREFS, 0)

        /** Clears only the manual-stop flag (used on a service restart). */
        fun clearRuntimeStopFlags(context: Context) {
            prefs(context).edit().remove(KEY_MANUAL_STOP).apply()
        }

        /**
         * Clears BOTH the manual-stop and the today auto-stop flags. Used on an
         * explicit user-initiated start (login), so that re-logging in the same
         * day after a punch-out / 11 PM cutoff can start tracking again. The hard
         * isPastDailyCutoff() check still blocks tracking after 11 PM regardless.
         */
        fun clearAllStopFlags(context: Context) {
            prefs(context).edit()
                .remove(KEY_MANUAL_STOP)
                .remove(KEY_AUTO_STOP_DATE)
                .apply()
        }

        fun markManualStopFlag(context: Context) {
            prefs(context).edit().putBoolean(KEY_MANUAL_STOP, true).apply()
        }

        fun markAutoCutoffStopFlag(context: Context) {
            prefs(context).edit()
                .remove(KEY_MANUAL_STOP)
                .putString(KEY_AUTO_STOP_DATE, todayKey())
                .apply()
        }

        /** True if tracking was stopped by the user, or already auto-stopped today. */
        fun shouldPreventRestartForTracking(context: Context): Boolean {
            val sharedPrefs = prefs(context)
            if (sharedPrefs.getBoolean(KEY_MANUAL_STOP, false)) return true
            return sharedPrefs.getString(KEY_AUTO_STOP_DATE, null) == todayKey()
        }

        fun isPastDailyCutoff(nowMs: Long = System.currentTimeMillis()): Boolean {
            val calendar = java.util.Calendar.getInstance().apply { timeInMillis = nowMs }
            return calendar.get(java.util.Calendar.HOUR_OF_DAY) >= DAILY_CUTOFF_HOUR
        }

        fun markTrackingActive(context: Context) {
            prefs(context).edit().putBoolean(KEY_TRACKING_ACTIVE, true).apply()
        }

        fun markTrackingInactive(context: Context) {
            prefs(context).edit().putBoolean(KEY_TRACKING_ACTIVE, false).apply()
        }

        /** True while the user is on duty — a reboot should resume tracking. */
        fun isTrackingActive(context: Context): Boolean {
            return prefs(context).getBoolean(KEY_TRACKING_ACTIVE, false)
        }
    }

    override fun getName() = "LocationTracker"

    override fun initialize() {
        super.initialize()
        // Keep the service's reactContext fresh whenever the JS bridge reconnects
        // (e.g. after an OEM process restart), so events still reach JS.
        reactContext.addLifecycleEventListener(object : LifecycleEventListener {
            override fun onHostResume() {
                LocationForegroundService.reactContext = reactContext
            }
            override fun onHostPause() {}
            override fun onHostDestroy() {}
        })
    }

    /**
     * Persist tuning config. Call BEFORE startTracking() so the service reads it.
     *   gpsIntervalMs, accuracyThresholdM, minDistanceM, snapshotIntervalMs,
     *   stillIntervalMs, stillSpeedKmh, stillFixCount, moveFixCount
     */
    @ReactMethod
    fun setTrackingConfig(config: ReadableMap) {
        val prefs = reactContext.applicationContext
            .getSharedPreferences("fe_tracking_config", 0).edit()
        if (config.hasKey("gpsIntervalMs"))
            prefs.putLong("gpsIntervalMs", config.getDouble("gpsIntervalMs").toLong())
        if (config.hasKey("accuracyThresholdM"))
            prefs.putFloat("accuracyThresholdM", config.getDouble("accuracyThresholdM").toFloat())
        if (config.hasKey("minDistanceM"))
            prefs.putFloat("minDistanceM", config.getDouble("minDistanceM").toFloat())
        if (config.hasKey("snapshotIntervalMs"))
            prefs.putLong("snapshotIntervalMs", config.getDouble("snapshotIntervalMs").toLong())
        if (config.hasKey("stillIntervalMs"))
            prefs.putLong("stillIntervalMs", config.getDouble("stillIntervalMs").toLong())
        if (config.hasKey("stillSpeedKmh"))
            prefs.putFloat("stillSpeedKmh", config.getDouble("stillSpeedKmh").toFloat())
        if (config.hasKey("stillFixCount"))
            prefs.putInt("stillFixCount", config.getInt("stillFixCount"))
        if (config.hasKey("moveFixCount"))
            prefs.putInt("moveFixCount", config.getInt("moveFixCount"))
        if (config.hasKey("walkThresholdM"))
            prefs.putFloat("walkThresholdM", config.getDouble("walkThresholdM").toFloat())
        if (config.hasKey("driveThresholdM"))
            prefs.putFloat("driveThresholdM", config.getDouble("driveThresholdM").toFloat())
        if (config.hasKey("walkSpeedMaxKmh"))
            prefs.putFloat("walkSpeedMaxKmh", config.getDouble("walkSpeedMaxKmh").toFloat())
        if (config.hasKey("maxPlausibleKmh"))
            prefs.putFloat("maxPlausibleKmh", config.getDouble("maxPlausibleKmh").toFloat())
        if (config.hasKey("firstFixMaxAccuracyM"))
            prefs.putFloat("firstFixMaxAccuracyM", config.getDouble("firstFixMaxAccuracyM").toFloat())
        prefs.apply()
    }

    /**
     * Where + how to save snapshots, so the native service can write to Firebase
     * itself without a JS round-trip. Persisted, so it survives a process restart.
     *   basePath — e.g. "FieldExecutiveData/FiledExecutiveLocationHistory/103"
     *   apiKey, appId, projectId, databaseURL — the active city's Firebase creds
     */
    @ReactMethod
    fun setSaveConfig(config: ReadableMap) {
        val prefs = reactContext.applicationContext
            .getSharedPreferences("fe_loc_save", 0).edit()
        config.getString("basePath")?.let { prefs.putString("basePath", it) }
        config.getString("empId")?.let { prefs.putString("empId", it) }
        config.getString("apiKey")?.let { prefs.putString("apiKey", it) }
        config.getString("appId")?.let { prefs.putString("appId", it) }
        config.getString("projectId")?.let { prefs.putString("projectId", it) }
        config.getString("databaseURL")?.let { prefs.putString("databaseURL", it) }
        prefs.apply()
    }

    /** Start the foreground service — tracking begins. */
    @ReactMethod
    fun startTracking() {
        clearAllStopFlags(reactContext.applicationContext)
        markTrackingActive(reactContext.applicationContext)
        LocationForegroundService.reactContext = reactContext
        val intent = Intent(reactContext, LocationForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    /** Stop the foreground service — tracking ends. */
    @ReactMethod
    fun stopTracking() {
        markTrackingInactive(reactContext.applicationContext)
        val intent = Intent(reactContext, LocationForegroundService::class.java)
        reactContext.stopService(intent)
        LocationForegroundService.reactContext = null
    }

    @ReactMethod
    fun clearTrackingStopFlags() {
        clearAllStopFlags(reactContext.applicationContext)
    }

    @ReactMethod
    fun markManualStop() {
        markManualStopFlag(reactContext.applicationContext)
    }

    /**
     * Launch the system battery-optimization exemption flow, falling back through
     * progressively more generic settings screens if a device lacks the first.
     */
    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val packageName = reactContext.packageName
            val activity = reactContext.currentActivity

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    (activity ?: reactContext).startActivity(intent)
                    promise.resolve(true)
                    return
                } catch (e: Exception) {
                    try {
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.parse("package:$packageName")
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        (activity ?: reactContext).startActivity(intent)
                        promise.resolve(true)
                        return
                    } catch (e2: Exception) {
                        try {
                            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                                .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                            reactContext.startActivity(intent)
                            promise.resolve(true)
                            return
                        } catch (e3: Exception) {
                            try {
                                val intent = Intent(Settings.ACTION_SETTINGS)
                                    .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                                reactContext.startActivity(intent)
                                promise.resolve(true)
                            } catch (e4: Exception) {
                                promise.resolve(false)
                            }
                        }
                    }
                }
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val context = reactContext.applicationContext
            val pm = context.getSystemService(android.os.PowerManager::class.java)
            promise.resolve(pm?.isIgnoringBatteryOptimizations(context.packageName) == true)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Snapshots buffered to disk while the JS bridge was dead (app killed, service
     * alive). Read and clear these on the next tracking start/stop.
     */
    @ReactMethod
    fun getPendingSnapshots(promise: Promise) {
        try {
            val prefs = reactContext.applicationContext.getSharedPreferences("fe_loc_buffer", 0)
            val json = prefs.getString("snapshots", "[]")!!
            val arr = org.json.JSONArray(json)
            val result = Arguments.createArray()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val map = Arguments.createMap()
                map.putString("path", obj.getString("path"))
                map.putDouble("distanceInMeters", obj.getDouble("distanceInMeters"))
                map.putString("time", obj.optString("time", ""))
                map.putString("date", obj.optString("date", ""))
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.resolve(Arguments.createArray())
        }
    }

    @ReactMethod
    fun clearPendingSnapshots() {
        try {
            reactContext.applicationContext
                .getSharedPreferences("fe_loc_buffer", 0)
                .edit().putString("snapshots", "[]").commit()
        } catch (_: Exception) {}
    }

    private fun locationMap(loc: Location): WritableMap = Arguments.createMap().apply {
        putDouble("latitude", loc.latitude)
        putDouble("longitude", loc.longitude)
        putDouble("accuracy", loc.accuracy.toDouble())
        putDouble("speed", if (loc.hasSpeed()) loc.speed.toDouble() else 0.0)
    }

    /**
     * A location fix as fast as possible — for task submit.
     *
     * Tries the OS's last known fix first (instant, and since tracking is running
     * it is usually only seconds old). Only if that's missing/stale does it ask
     * for a fresh single fix. Never waits on the live update stream.
     *
     * Resolves { latitude, longitude, accuracy, speed } or null if unavailable.
     */
    @ReactMethod
    fun getCurrentLocation(promise: Promise) {
        try {
            val client = LocationServices.getFusedLocationProviderClient(reactContext)
            client.lastLocation
                .addOnSuccessListener { last ->
                    val fresh = last != null && System.currentTimeMillis() - last.time <= 60_000
                    if (fresh) {
                        promise.resolve(locationMap(last!!))
                        return@addOnSuccessListener
                    }
                    // No recent cache — request one fresh fix.
                    val cts = CancellationTokenSource()
                    client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                        .addOnSuccessListener { cur ->
                            when {
                                cur != null -> promise.resolve(locationMap(cur))
                                last != null -> promise.resolve(locationMap(last)) // stale, still useful
                                else -> promise.resolve(null)
                            }
                        }
                        .addOnFailureListener {
                            if (last != null) promise.resolve(locationMap(last)) else promise.resolve(null)
                        }
                }
                .addOnFailureListener { promise.resolve(null) }
        } catch (_: SecurityException) {
            promise.resolve(null)
        } catch (_: Exception) {
            promise.resolve(null)
        }
    }

    /** Reverse geocode lat/lng to a locality string. */
    @ReactMethod
    fun getLocalityFromLatLng(lat: Double, lng: Double, promise: Promise) {
        try {
            val geocoder = Geocoder(reactContext.applicationContext, Locale.ENGLISH)
            @Suppress("DEPRECATION")
            val addresses = geocoder.getFromLocation(lat, lng, 1)
            val full = addresses?.firstOrNull()?.getAddressLine(0)?.trim().orEmpty()
            if (full.isEmpty()) {
                promise.resolve("")
                return
            }
            val locality = when {
                full.contains(", India") -> full.substringBefore(", India").trim()
                else -> full
            }
            promise.resolve(locality)
        } catch (_: Exception) {
            promise.resolve("")
        }
    }

    // Required stubs for NativeEventEmitter.
    @ReactMethod fun addListener(eventName: String) {}

    @ReactMethod fun removeListeners(count: Int) {}
}
