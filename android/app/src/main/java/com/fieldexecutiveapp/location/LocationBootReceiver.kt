package com.fieldexecutiveapp.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Resumes location tracking after a device reboot, so a phone restart mid-duty
 * doesn't silently kill tracking for the rest of the day.
 *
 * The service saves to Firebase natively (config persisted in prefs), so it can
 * run headlessly without the app/JS being opened. It only resumes if the user
 * was on duty (tracking active) and hasn't stopped / passed the daily cutoff.
 */
class LocationBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                if (!LocationModule.isTrackingActive(context)) return
                if (LocationModule.shouldPreventRestartForTracking(context)) return
                if (LocationModule.isPastDailyCutoff()) return

                val serviceIntent = Intent(context, LocationForegroundService::class.java)
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                } catch (_: Exception) {
                    // A background FGS start may be refused right after boot on some
                    // OEMs; nothing more we can safely do without the app in front.
                }
            }
        }
    }
}
