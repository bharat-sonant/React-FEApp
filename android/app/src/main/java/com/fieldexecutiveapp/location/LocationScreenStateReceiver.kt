package com.fieldexecutiveapp.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Keeps tracking alive across screen lock / unlock:
 *   screen off    → make sure the service is still running
 *   user present  → re-assert it if the system delayed it while locked
 */
class LocationScreenStateReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_SCREEN_OFF,
            Intent.ACTION_USER_PRESENT -> {
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
                    // Background FGS start refused — ignore; the service is likely
                    // already running, and the redelivery is only a safety re-assert.
                }
            }
        }
    }
}
