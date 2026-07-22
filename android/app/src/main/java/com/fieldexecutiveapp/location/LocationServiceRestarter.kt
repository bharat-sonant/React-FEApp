package com.fieldexecutiveapp.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts LocationForegroundService if the system kills it. The service's
 * onDestroy() broadcasts ACTION to trigger this.
 *
 * NOTE: unlike the IEC app (where this receiver was broadcast but never
 * registered — dead code), it IS declared in the manifest here so the restart
 * path actually works.
 */
class LocationServiceRestarter : BroadcastReceiver() {

    companion object {
        const val ACTION = "com.fieldexecutiveapp.RESTART_LOCATION_SERVICE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
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
            // A background FGS start can be refused (Android 12+ without a battery
            // exemption). Nothing to do here; START_STICKY / the next tick retries.
        }
    }
}
