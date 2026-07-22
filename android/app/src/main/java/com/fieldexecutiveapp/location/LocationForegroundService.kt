package com.fieldexecutiveapp.location

import android.app.*
import android.content.pm.ServiceInfo
import android.content.Intent
import android.location.Location
import android.os.*
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.*
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.MutableData
import com.google.firebase.database.Transaction
import com.google.firebase.database.ValueEventListener
import java.text.SimpleDateFormat
import java.util.*

/**
 * Foreground service that tracks location and pushes updates to JS. Ported from
 * the IEC app.
 *
 * Emits two events:
 *   onLocationUpdate — every accepted raw fix { latitude, longitude, accuracy, speed }
 *   onMinuteSnapshot — once per snapshot window { path, distanceInMeters, time, date, timestamp }
 *
 * Adaptive power: drops to a slower, balanced-power request when the device has
 * been still for a few fixes, and restores high accuracy once it moves again.
 */
class LocationForegroundService : Service() {

    companion object {
        var reactContext: ReactApplicationContext? = null
        private const val CHANNEL_ID = "fe_location_channel"
        private const val NOTIF_ID = 2001
        private const val DAILY_CUTOFF_HOUR = 23

        // A dedicated named Firebase app for the service, separate from the JS
        // [DEFAULT] app, so the two never clash. Offline persistence is set once
        // per process (this resets on a cold restart, which is correct).
        private const val FB_APP_NAME = "feLocation"
        private var persistenceSet = false

        private const val DEFAULT_GPS_INTERVAL_MS = 5_000L
        private const val DEFAULT_ACCURACY_THRESHOLD_M = 100f
        private const val DEFAULT_SNAPSHOT_INTERVAL_MS = 60_000L
        private const val DEFAULT_MIN_DISTANCE_M = 10f
        private const val DEFAULT_STILL_INTERVAL_MS = 30_000L
        private const val DEFAULT_STILL_SPEED_KMH = 3.0f
        private const val DEFAULT_STILL_FIX_COUNT = 3
        private const val DEFAULT_MOVE_FIX_COUNT = 2

        // Adaptive displacement floor: small when walking, larger when driving,
        // so a slow walk still accumulates yet vehicle GPS jitter is filtered.
        private const val DEFAULT_WALK_THRESHOLD_M = 4f
        private const val DEFAULT_DRIVE_THRESHOLD_M = 12f
        private const val DEFAULT_WALK_SPEED_MAX_KMH = 8f
        // A segment faster than this between two fixes is a GPS glitch, not travel.
        private const val DEFAULT_MAX_PLAUSIBLE_KMH = 180f
        // The very first fix of a session must be at least this accurate, so the
        // route doesn't open with a wild cell-tower jump.
        private const val DEFAULT_FIRST_FIX_MAX_ACC_M = 100f

        // Self-heal: re-arm a wake alarm each start. If the service is somehow
        // killed without START_STICKY / onTaskRemoved reviving it (aggressive
        // OEMs), this alarm resurrects it. Re-armed every start, so it acts like
        // a periodic heartbeat while alive.
        private const val WATCHDOG_INTERVAL_MS = 90_000L

        // On a quick kill+restart, restore the last accepted point as the distance
        // baseline so the route stays continuous (no phantom straight-line gap).
        // Beyond this age the gap is real, so we start fresh instead of bridging.
        private const val RESTORE_MAX_AGE_MS = 120_000L
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var wakeLock: PowerManager.WakeLock? = null

    private var gpsIntervalMs = DEFAULT_GPS_INTERVAL_MS
    private var accuracyThresholdM = DEFAULT_ACCURACY_THRESHOLD_M
    private var snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS
    private var minDistanceM = DEFAULT_MIN_DISTANCE_M
    private var stillIntervalMs = DEFAULT_STILL_INTERVAL_MS
    private var stillSpeedKmh = DEFAULT_STILL_SPEED_KMH
    private var stillFixCount = DEFAULT_STILL_FIX_COUNT
    private var moveFixCount = DEFAULT_MOVE_FIX_COUNT
    private var walkThresholdM = DEFAULT_WALK_THRESHOLD_M
    private var driveThresholdM = DEFAULT_DRIVE_THRESHOLD_M
    private var walkSpeedMaxKmh = DEFAULT_WALK_SPEED_MAX_KMH
    private var maxPlausibleKmh = DEFAULT_MAX_PLAUSIBLE_KMH
    private var firstFixMaxAccuracyM = DEFAULT_FIRST_FIX_MAX_ACC_M

    private var isLowPowerMode = false
    private var stillStreak = 0
    private var movingStreak = 0
    private var lastAdaptiveLoc: Location? = null

    // True once tracking is fully initialised. A redelivery (watchdog, screen
    // receiver, START_STICKY) then only re-asserts the foreground state instead
    // of wiping the in-progress minute + baseline.
    private var isRunning = false

    private val minutePoints = mutableListOf<Location>()
    private var minuteDistance = 0f
    private var lastPoint: Location? = null
    private var firstPointAdded = false

    // Listens for today's punch-out; when it appears, tracking stops for the day.
    private var attendanceRef: DatabaseReference? = null
    private var attendanceListener: ValueEventListener? = null

    // Firebase server-clock offset (server - device), so a user changing their
    // phone's date/time can't make data save under the wrong date/time.
    @Volatile private var serverTimeOffsetMs = 0L
    private var serverOffsetRef: DatabaseReference? = null
    private var serverOffsetListener: ValueEventListener? = null

    private val handler = Handler(Looper.getMainLooper())
    private val minuteTick = object : Runnable {
        override fun run() {
            if (isPastDailyCutoff()) {
                stopForDailyCutoff()
                return
            }
            flushMinuteSnapshot()
            handler.postDelayed(this, snapshotIntervalMs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
        buildLocationCallback()
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FieldExecutive:LocationTracking")
            .apply { acquire(12 * 60 * 60 * 1000L) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A redelivery to an already-running service (watchdog heartbeat, screen
        // lock/unlock, or START_STICKY re-delivery): DO NOT reset the buffer or the
        // baseline — that would wipe the current minute and break route continuity.
        // Just re-assert the foreground state and re-arm the watchdog.
        if (isRunning) {
            if (LocationModule.shouldPreventRestartForTracking(applicationContext) || isPastDailyCutoff()) {
                stopTrackingForToday()
                return START_NOT_STICKY
            }
            ensureForeground()
            scheduleWatchdog()
            return START_STICKY
        }

        LocationModule.clearRuntimeStopFlags(applicationContext)
        firstPointAdded = false
        minutePoints.clear()
        minuteDistance = 0f
        // Bridge a quick kill+restart: keep the last accepted point as the distance
        // baseline so the route doesn't jump. Null (fresh start) if it's too old.
        lastPoint = restoreLastPoint()

        val prefs = applicationContext.getSharedPreferences("fe_tracking_config", 0)
        gpsIntervalMs = prefs.getLong("gpsIntervalMs", DEFAULT_GPS_INTERVAL_MS)
        accuracyThresholdM = prefs.getFloat("accuracyThresholdM", DEFAULT_ACCURACY_THRESHOLD_M)
        snapshotIntervalMs = prefs.getLong("snapshotIntervalMs", DEFAULT_SNAPSHOT_INTERVAL_MS)
        minDistanceM = prefs.getFloat("minDistanceM", DEFAULT_MIN_DISTANCE_M)
        stillIntervalMs = prefs.getLong("stillIntervalMs", DEFAULT_STILL_INTERVAL_MS)
        stillSpeedKmh = prefs.getFloat("stillSpeedKmh", DEFAULT_STILL_SPEED_KMH)
        stillFixCount = prefs.getInt("stillFixCount", DEFAULT_STILL_FIX_COUNT).coerceAtLeast(1)
        moveFixCount = prefs.getInt("moveFixCount", DEFAULT_MOVE_FIX_COUNT).coerceAtLeast(1)
        walkThresholdM = prefs.getFloat("walkThresholdM", DEFAULT_WALK_THRESHOLD_M)
        driveThresholdM = prefs.getFloat("driveThresholdM", DEFAULT_DRIVE_THRESHOLD_M)
        walkSpeedMaxKmh = prefs.getFloat("walkSpeedMaxKmh", DEFAULT_WALK_SPEED_MAX_KMH)
        maxPlausibleKmh = prefs.getFloat("maxPlausibleKmh", DEFAULT_MAX_PLAUSIBLE_KMH)
        firstFixMaxAccuracyM = prefs.getFloat("firstFixMaxAccuracyM", DEFAULT_FIRST_FIX_MAX_ACC_M)

        isLowPowerMode = false
        stillStreak = 0
        movingStreak = 0
        lastAdaptiveLoc = null

        if (LocationModule.shouldPreventRestartForTracking(applicationContext)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (isPastDailyCutoff()) {
            stopForDailyCutoff()
            return START_NOT_STICKY
        }

        ensureForeground()
        isRunning = true

        // Track the server clock, then flush anything buffered.
        attachServerTimeListener()
        drainBufferToFirebase()

        // Stop the moment the user punches out today.
        attachPunchOutListener()

        startLocationUpdates(highAccuracy = true)
        handler.postDelayed(minuteTick, snapshotIntervalMs)
        // Arm the self-heal watchdog (re-armed on every start).
        scheduleWatchdog()
        return START_STICKY
    }

    /** (Re)enter the foreground with the location service type. Never crashes. */
    private fun ensureForeground() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIF_ID,
                    buildNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
                )
            } else {
                startForeground(NOTIF_ID, buildNotification())
            }
        } catch (_: Exception) {
            // Rare: a background FGS-start window closed. START_STICKY / the
            // watchdog will try again shortly.
        }
    }

    /**
     * Schedule a wake alarm that re-launches the service if it isn't running.
     * Re-armed on every start, so while alive it behaves like a periodic
     * heartbeat; if the process is killed, the last-armed alarm still fires once
     * and brings tracking back. Skipped if the user stopped or we're past cutoff.
     */
    private fun scheduleWatchdog() {
        if (LocationModule.shouldPreventRestartForTracking(applicationContext) || isPastDailyCutoff()) return
        val intent = Intent(applicationContext, LocationServiceRestarter::class.java)
            .setAction(LocationServiceRestarter.ACTION)
            .setPackage(packageName)
        val pending = PendingIntent.getBroadcast(
            this,
            2,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val am = getSystemService(ALARM_SERVICE) as AlarmManager
        val at = System.currentTimeMillis() + WATCHDOG_INTERVAL_MS
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, pending)
            }
        } catch (_: Exception) {}
    }

    /** Cancel the self-heal watchdog — used when tracking stops for the day. */
    private fun cancelWatchdog() {
        try {
            val intent = Intent(applicationContext, LocationServiceRestarter::class.java)
                .setAction(LocationServiceRestarter.ACTION)
                .setPackage(packageName)
            val pending = PendingIntent.getBroadcast(
                this,
                2,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            (getSystemService(ALARM_SERVICE) as AlarmManager).cancel(pending)
        } catch (_: Exception) {}
    }

    /** Persist the last accepted point so a quick restart can bridge the gap. */
    private fun persistLastPoint(loc: Location) {
        try {
            applicationContext.getSharedPreferences("fe_loc_state", 0).edit()
                .putString("lastLat", loc.latitude.toString())
                .putString("lastLng", loc.longitude.toString())
                .putFloat("lastAcc", loc.accuracy)
                .putLong("lastTime", System.currentTimeMillis())
                .apply()
        } catch (_: Exception) {}
    }

    /** The last accepted point if recent enough to bridge a restart gap, else null. */
    private fun restoreLastPoint(): Location? {
        return try {
            val p = applicationContext.getSharedPreferences("fe_loc_state", 0)
            val lat = p.getString("lastLat", null)?.toDoubleOrNull() ?: return null
            val lng = p.getString("lastLng", null)?.toDoubleOrNull() ?: return null
            val t = p.getLong("lastTime", 0L)
            if (t <= 0L || System.currentTimeMillis() - t > RESTORE_MAX_AGE_MS) return null
            Location("restored").apply {
                latitude = lat
                longitude = lng
                accuracy = p.getFloat("lastAcc", 30f)
                time = t
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * The user swiped the app away. Schedule a near-immediate restart so tracking
     * resumes — unless it was a deliberate stop or we're past the daily cutoff.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!LocationModule.shouldPreventRestartForTracking(applicationContext) && !isPastDailyCutoff()) {
            val restart = Intent(applicationContext, LocationForegroundService::class.java)
            val flags = PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
            val pending = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PendingIntent.getForegroundService(this, 1, restart, flags)
            } else {
                PendingIntent.getService(this, 1, restart, flags)
            }
            val am = getSystemService(ALARM_SERVICE) as AlarmManager
            val at = System.currentTimeMillis() + 1000
            // Exact + allow-while-idle when we can: fires even in Doze, and an exact
            // alarm grants a brief foreground-service-start allowance on Android 12+.
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                } else {
                    am.set(AlarmManager.RTC_WAKEUP, at, pending)
                }
            } catch (_: Exception) {
                try { am.set(AlarmManager.RTC_WAKEUP, at, pending) } catch (_: Exception) {}
            }
            // Backup path: the broadcast-driven watchdog, in case the direct
            // service restart is throttled.
            scheduleWatchdog()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        isRunning = false
        fusedClient.removeLocationUpdates(locationCallback)
        handler.removeCallbacks(minuteTick)
        detachListeners()
        flushMinuteSnapshot()
        wakeLock?.let { if (it.isHeld) it.release() }
        sendBroadcast(Intent(LocationServiceRestarter.ACTION).setPackage(packageName))
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = null

    private fun buildLocationCallback() {
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return

                if (isPastDailyCutoff()) {
                    stopForDailyCutoff()
                    return
                }

                val prev = lastPoint

                // Accuracy gate. The session's very first fix (prev == null) must
                // be reasonably accurate too, so the route can't open with a wild
                // cell-tower jump — but with a looser cap so we still start.
                if (prev == null) {
                    if (loc.accuracy > firstFixMaxAccuracyM) return
                } else if (loc.accuracy > accuracyThresholdM) {
                    return
                }

                emitCurrentLocation(loc)
                evaluatePowerMode(loc)

                if (prev != null) {
                    val moved = prev.distanceTo(loc)
                    val dtSec = ((loc.time - prev.time).coerceAtLeast(1L)).toFloat() / 1000f
                    val segKmh = (moved / dtSec) * 3.6f

                    // Impossible speed between two fixes ⇒ GPS glitch. Drop it
                    // WITHOUT moving the baseline, so it can't inject false distance.
                    if (segKmh > maxPlausibleKmh) return

                    // Adaptive floor: small while walking, larger while driving.
                    val speedKmh = if (loc.hasSpeed()) loc.speed * 3.6f else segKmh
                    val floorM = if (speedKmh < walkSpeedMaxKmh) walkThresholdM else driveThresholdM

                    // Below the floor: keep the baseline (do NOT drift lastPoint),
                    // so slow continuous walking still accumulates across fixes.
                    if (moved < floorM) return

                    minuteDistance += moved
                }

                minutePoints.add(loc)
                lastPoint = loc
                // Persist the baseline so a quick kill+restart keeps the route continuous.
                persistLastPoint(loc)

                // Flush the very first fix straight away so the DB gets a point
                // without waiting a full minute.
                if (!firstPointAdded) {
                    firstPointAdded = true
                    flushMinuteSnapshot()
                }
            }
        }
    }

    private fun startLocationUpdates(highAccuracy: Boolean) {
        val interval = if (highAccuracy) gpsIntervalMs else stillIntervalMs
        isLowPowerMode = !highAccuracy

        // Balance: ALWAYS request high-accuracy fixes; save battery by polling
        // less often when still, not by dropping to coarse (network) accuracy.
        // Coarse fixes would just be rejected by the accuracy gate, leaving gaps
        // and missing the moment movement resumes.
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
            .setMinUpdateIntervalMillis(interval)
            .build()

        try {
            fusedClient.removeLocationUpdates(locationCallback)
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())

            // Seed ONLY at session start (no baseline yet). A mid-session mode
            // switch must not re-seed or wipe the current minute's distance.
            if (lastPoint == null) {
                fusedClient.lastLocation.addOnSuccessListener { loc ->
                    if (loc != null && lastPoint == null) {
                        val ageMs = System.currentTimeMillis() - loc.time
                        if (ageMs <= 120_000 && loc.accuracy <= firstFixMaxAccuracyM) {
                            lastPoint = loc
                            minutePoints.add(loc)
                            firstPointAdded = true
                            flushMinuteSnapshot()
                            emitCurrentLocation(loc)
                        }
                    }
                }
            }
        } catch (_: SecurityException) {
            // Location permission not granted yet.
        }
    }

    private fun evaluatePowerMode(loc: Location) {
        if (loc.accuracy > accuracyThresholdM * 1.5f) {
            lastAdaptiveLoc = loc
            return
        }

        val previous = lastAdaptiveLoc
        val speedKmh = if (loc.hasSpeed()) {
            (loc.speed * 3.6f).coerceAtLeast(0f)
        } else if (previous != null) {
            val dtSec = ((loc.time - previous.time).coerceAtLeast(1L)).toFloat() / 1000f
            val movedM = previous.distanceTo(loc)
            ((movedM / dtSec) * 3.6f).coerceAtLeast(0f)
        } else {
            0f
        }

        val movedM = previous?.distanceTo(loc) ?: 0f
        val isStillFix = speedKmh < stillSpeedKmh && movedM < minDistanceM

        if (isStillFix) {
            stillStreak += 1
            movingStreak = 0
            if (!isLowPowerMode && stillStreak >= stillFixCount) {
                startLocationUpdates(highAccuracy = false)
                stillStreak = 0
            }
        } else {
            movingStreak += 1
            stillStreak = 0
            if (isLowPowerMode && movingStreak >= moveFixCount) {
                startLocationUpdates(highAccuracy = true)
                movingStreak = 0
            }
        }

        lastAdaptiveLoc = loc
    }

    private fun emitCurrentLocation(loc: Location) {
        val ctx = reactContext ?: return
        val map = Arguments.createMap().apply {
            putDouble("latitude", loc.latitude)
            putDouble("longitude", loc.longitude)
            putDouble("accuracy", loc.accuracy.toDouble())
            putDouble("speed", if (loc.hasSpeed()) loc.speed.toDouble() else 0.0)
        }
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onLocationUpdate", map)
    }

    private fun flushMinuteSnapshot() {
        if (minutePoints.isEmpty()) return

        val path = minutePoints.joinToString("~") { "(${it.latitude},${it.longitude})" }
        val dist = minuteDistance.toDouble()
        // Server clock, NOT device clock — so a wrong phone date/time can't file
        // this snapshot under the wrong day/minute.
        val now = serverNow()
        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(now)
        val month = SimpleDateFormat("MMMM", Locale.getDefault()).format(now)
        val year = SimpleDateFormat("yyyy", Locale.getDefault()).format(now)
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(now)

        minutePoints.clear()
        minuteDistance = 0f
        // Keep lastPoint as the distance baseline across the minute boundary, so
        // the segment straddling two minutes is still counted (no per-minute reset).

        // Notify JS for any live UI (distance today, etc.). Saving does NOT
        // depend on this — the service writes to Firebase itself below.
        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(
                "onMinuteSnapshot",
                Arguments.createMap().apply {
                    putString("path", path)
                    putDouble("distanceInMeters", dist)
                    putString("time", time)
                    putString("date", date)
                    putDouble("timestamp", now.time.toDouble())
                },
            )

        // Write straight to Firebase from native. Falls back to the on-disk
        // buffer only if there's no config yet or the DB can't be reached.
        if (!saveSnapshotToFirebase(path, dist, year, month, date, time)) {
            bufferSnapshotToPrefs(path, dist, time, date)
        }
    }

    /**
     * The service's own Firebase handle — a named app built from the city creds
     * JS persisted via setSaveConfig. Re-initialised transparently after a cold
     * process restart, so writes never need JS to be alive.
     */
    private fun getDb(): Pair<FirebaseDatabase, String>? {
        val prefs = applicationContext.getSharedPreferences("fe_loc_save", 0)
        val basePath = prefs.getString("basePath", null) ?: return null
        val apiKey = prefs.getString("apiKey", null) ?: return null
        val appId = prefs.getString("appId", null) ?: return null
        val projectId = prefs.getString("projectId", null) ?: return null
        val dbUrl = prefs.getString("databaseURL", null) ?: return null

        return try {
            val app = try {
                FirebaseApp.getInstance(FB_APP_NAME)
            } catch (_: IllegalStateException) {
                val options = FirebaseOptions.Builder()
                    .setApiKey(apiKey)
                    .setApplicationId(appId)
                    .setProjectId(projectId)
                    .setDatabaseUrl(dbUrl)
                    .build()
                FirebaseApp.initializeApp(applicationContext, options, FB_APP_NAME)
            }
            val db = FirebaseDatabase.getInstance(app, dbUrl)
            if (!persistenceSet) {
                // Must be set before any getReference on this instance. Offline
                // writes then survive a process kill and sync on reconnect.
                try {
                    db.setPersistenceEnabled(true)
                } catch (_: Exception) {}
                persistenceSet = true
            }
            Pair(db, basePath)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Write one snapshot: the minute's route + distance, plus a running daily
     * total (incremented atomically). Returns false if there's no usable DB yet,
     * so the caller can buffer instead.
     */
    private fun saveSnapshotToFirebase(
        path: String,
        dist: Double,
        year: String,
        month: String,
        date: String,
        time: String,
    ): Boolean {
        val (db, basePath) = getDb() ?: return false
        return try {
            val root = db.getReference("$basePath/$year/$month/$date")
            root.child(time).setValue(
                mapOf("lat-lng" to path, "distance-in-meter" to dist),
            )
            root.child("last-update-time").setValue(time)
            root.child("TotalCoveredDistance").runTransaction(object : Transaction.Handler {
                override fun doTransaction(current: MutableData): Transaction.Result {
                    val prev = current.getValue(Double::class.java) ?: 0.0
                    current.value = prev + dist
                    return Transaction.success(current)
                }

                override fun onComplete(e: DatabaseError?, committed: Boolean, s: DataSnapshot?) {}
            })
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Push any buffered snapshots (from a spell with no config/DB) to Firebase. */
    private fun drainBufferToFirebase() {
        val prefs = applicationContext.getSharedPreferences("fe_loc_buffer", MODE_PRIVATE)
        val json = prefs.getString("snapshots", "[]") ?: "[]"
        val arr = try {
            org.json.JSONArray(json)
        } catch (_: Exception) {
            return
        }
        if (arr.length() == 0) return
        if (getDb() == null) return // still no config — leave the buffer for later

        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val date = obj.optString("date", "")
            // Recover year/month from the buffered date; fall back to now.
            val (y, mo) = try {
                val d = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).parse(date)!!
                Pair(
                    SimpleDateFormat("yyyy", Locale.getDefault()).format(d),
                    SimpleDateFormat("MMMM", Locale.getDefault()).format(d),
                )
            } catch (_: Exception) {
                Pair(
                    SimpleDateFormat("yyyy", Locale.getDefault()).format(Date()),
                    SimpleDateFormat("MMMM", Locale.getDefault()).format(Date()),
                )
            }
            saveSnapshotToFirebase(
                obj.optString("path", ""),
                obj.optDouble("distanceInMeters", 0.0),
                y,
                mo,
                date,
                obj.optString("time", ""),
            )
        }
        prefs.edit().putString("snapshots", "[]").commit()
    }

    /** Server-time now (device clock corrected by the Firebase offset). */
    private fun serverNow(): Date = Date(System.currentTimeMillis() + serverTimeOffsetMs)

    private fun isPastDailyCutoff(): Boolean {
        val calendar = Calendar.getInstance().apply { time = serverNow() }
        return calendar.get(Calendar.HOUR_OF_DAY) >= DAILY_CUTOFF_HOUR
    }

    private fun stopForDailyCutoff() = stopTrackingForToday()

    /**
     * Stop tracking for the rest of today — used by both the 11 PM cutoff and a
     * punch-out. Marks the today auto-stop flag so restart attempts are ignored
     * until an explicit start (login) or a new day.
     */
    private fun stopTrackingForToday() {
        isRunning = false
        LocationModule.markAutoCutoffStopFlag(applicationContext)
        cancelWatchdog()
        fusedClient.removeLocationUpdates(locationCallback)
        handler.removeCallbacks(minuteTick)
        detachListeners()
        flushMinuteSnapshot()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    /**
     * Watch today's punch-out node. The moment
     *   Attendance/{empId}/{year}/{Month}/{date}/outDetails/serverTime
     * gets a value, the user has punched out → stop tracking for the day.
     */
    private fun attachPunchOutListener() {
        if (attendanceListener != null) return
        val db = getDb()?.first ?: return
        val empId = applicationContext.getSharedPreferences("fe_loc_save", 0)
            .getString("empId", null) ?: return

        val now = serverNow()
        val year = SimpleDateFormat("yyyy", Locale.getDefault()).format(now)
        val month = SimpleDateFormat("MMMM", Locale.getDefault()).format(now)
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(now)

        val ref = db.getReference("Attendance/$empId/$year/$month/$date/outDetails/serverTime")
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (snapshot.value != null) stopTrackingForToday()
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        ref.addValueEventListener(listener)
        attendanceRef = ref
        attendanceListener = listener
    }

    /** Keep the Firebase server-clock offset current. */
    private fun attachServerTimeListener() {
        if (serverOffsetListener != null) return
        val db = getDb()?.first ?: return
        val ref = db.getReference(".info/serverTimeOffset")
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                (snapshot.getValue(Double::class.java))?.let { serverTimeOffsetMs = it.toLong() }
            }

            override fun onCancelled(error: DatabaseError) {}
        }
        ref.addValueEventListener(listener)
        serverOffsetRef = ref
        serverOffsetListener = listener
    }

    private fun detachListeners() {
        attendanceListener?.let { attendanceRef?.removeEventListener(it) }
        attendanceRef = null
        attendanceListener = null
        serverOffsetListener?.let { serverOffsetRef?.removeEventListener(it) }
        serverOffsetRef = null
        serverOffsetListener = null
    }

    private fun bufferSnapshotToPrefs(path: String, dist: Double, time: String, date: String): Boolean {
        return try {
            val prefs = applicationContext.getSharedPreferences("fe_loc_buffer", MODE_PRIVATE)
            val existing = prefs.getString("snapshots", "[]")!!
            val arr = org.json.JSONArray(existing)
            arr.put(org.json.JSONObject().apply {
                put("path", path)
                put("distanceInMeters", dist)
                put("time", time)
                put("date", date)
            })
            prefs.edit().putString("snapshots", arr.toString()).commit()
        } catch (_: Exception) {
            false
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Location Tracking",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Tracks your location during duty"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Field Executive - Active")
            .setContentText("Location tracking in progress")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
}
