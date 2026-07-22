package com.fieldexecutiveapp

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.fieldexecutiveapp.devicestatus.DeviceStatusPackage
import com.fieldexecutiveapp.location.LocationPackage
import com.fieldexecutiveapp.ota.OtaPackage
import java.io.File

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Our own native modules — not autolinked because they live in the app.
          add(DeviceStatusPackage())
          add(LocationPackage())
          add(OtaPackage())
        },
      // Load an OTA-delivered JS bundle if one has been applied; otherwise null
      // falls back to the bundle packaged inside the APK.
      jsBundleFilePath = resolveJsBundleFilePath(),
    )
  }

  /**
   * A JS bundle delivered over-the-air, if present:
   *   filesDir/index.android.bundle   (raw-bundle update — takes priority)
   *   filesDir/ota/index.android.bundle (zip-package update)
   * else null → the APK's built-in bundle.
   */
  private fun resolveJsBundleFilePath(): String? {
    val direct = File(filesDir, "index.android.bundle")
    if (direct.exists()) return direct.absolutePath
    val ota = File(filesDir, "ota/index.android.bundle")
    if (ota.exists()) return ota.absolutePath
    return null
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
