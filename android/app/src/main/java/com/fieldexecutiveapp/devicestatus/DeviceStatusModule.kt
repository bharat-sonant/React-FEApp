package com.fieldexecutiveapp.devicestatus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Reports whether the device currently has internet and location switched on,
 * and pushes an event the moment either changes.
 *
 * Written natively rather than pulled in as a dependency: the app has a hard
 * APK size budget, and Android already exposes exactly the two callbacks we
 * need — a ConnectivityManager network callback and the system's
 * PROVIDERS_CHANGED broadcast. Polling from JS would be both slower to react
 * and more expensive.
 *
 * Reading these two states needs no runtime permission; ACCESS_NETWORK_STATE is
 * a normal (install-time) permission.
 */
class DeviceStatusModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DeviceStatus"
        private const val EVENT = "deviceStatusChange"
    }

    override fun getName() = NAME

    private val connectivity by lazy {
        reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    private val locations by lazy {
        reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    }

    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var locationReceiver: BroadcastReceiver? = null

    /**
     * Networks currently usable for internet, maintained by the callback.
     *
     * Deliberately NOT re-queried via activeNetwork inside onLost: while a
     * network is being torn down the system can still hand back the dying
     * network and its old capabilities, so the check reads "online" and — since
     * no further callback follows — stays stuck there. Tracking what the
     * callback tells us is the only reliable reading.
     */
    private val usableNetworks = mutableSetOf<Network>()

    /**
     * VALIDATED, not just INTERNET: a Wi-Fi network that is connected but has no
     * working internet would otherwise read as online, and every Firebase write
     * would hang instead of telling the user to fix their connection.
     */
    private fun NetworkCapabilities.usable(): Boolean =
        hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

    private fun hasNetwork(): Boolean {
        // Once the callback is live it owns the answer.
        if (networkCallback != null) {
            return synchronized(usableNetworks) { usableNetworks.isNotEmpty() }
        }
        // Before that (or if registering failed) fall back to a direct query.
        val active = connectivity.activeNetwork ?: return false
        val caps = connectivity.getNetworkCapabilities(active) ?: return false
        return caps.usable()
    }

    private fun hasLocation(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            locations.isLocationEnabled
        } else {
            locations.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }

    private fun statusMap(): WritableMap =
        Arguments.createMap().apply {
            putBoolean("network", hasNetwork())
            putBoolean("location", hasLocation())
        }

    private fun emit() {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT, statusMap())
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            promise.resolve(statusMap())
        } catch (e: Exception) {
            promise.reject("DEVICE_STATUS", e.message, e)
        }
    }

    /** Begin watching. Safe to call more than once. */
    @ReactMethod
    fun start() {
        if (networkCallback == null) {
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    // Capabilities arrive in onCapabilitiesChanged; seed from a
                    // query here so a network that never re-reports still counts.
                    val caps = connectivity.getNetworkCapabilities(network)
                    synchronized(usableNetworks) {
                        if (caps != null && caps.usable()) usableNetworks.add(network)
                    }
                    emit()
                }

                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    synchronized(usableNetworks) {
                        if (caps.usable()) usableNetworks.add(network)
                        else usableNetworks.remove(network)
                    }
                    emit()
                }

                override fun onLost(network: Network) {
                    synchronized(usableNetworks) { usableNetworks.remove(network) }
                    emit()
                }
            }
            try {
                // Seed from the current state before the callback takes over.
                connectivity.activeNetwork?.let { active ->
                    val caps = connectivity.getNetworkCapabilities(active)
                    if (caps != null && caps.usable()) {
                        synchronized(usableNetworks) { usableNetworks.add(active) }
                    }
                }
                // registerNetworkCallback, not registerDefaultNetworkCallback:
                // we want to hear about every internet-capable network, so
                // losing one while another is up doesn't read as offline.
                val request = NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build()
                connectivity.registerNetworkCallback(request, cb)
                networkCallback = cb
            } catch (_: Exception) {
                // Some OEM builds throw here; hasNetwork() then falls back to a
                // direct query, and JS can still poll via getStatus().
                usableNetworks.clear()
            }
        }

        if (locationReceiver == null) {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) = emit()
            }
            try {
                ContextCompat.registerReceiver(
                    reactContext,
                    receiver,
                    IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION),
                    ContextCompat.RECEIVER_NOT_EXPORTED,
                )
                locationReceiver = receiver
            } catch (_: Exception) {
                // ignore — getStatus() still works
            }
        }

        emit() // hand JS the current state immediately
    }

    @ReactMethod
    fun stop() {
        networkCallback?.let {
            try {
                connectivity.unregisterNetworkCallback(it)
            } catch (_: Exception) {
            }
        }
        networkCallback = null
        synchronized(usableNetworks) { usableNetworks.clear() }

        locationReceiver?.let {
            try {
                reactContext.unregisterReceiver(it)
            } catch (_: Exception) {
            }
        }
        locationReceiver = null
    }

    // Required so JS can attach a NativeEventEmitter without warnings.
    @ReactMethod fun addListener(eventName: String) = Unit

    @ReactMethod fun removeListeners(count: Int) = Unit

    override fun invalidate() {
        stop()
        super.invalidate()
    }
}
