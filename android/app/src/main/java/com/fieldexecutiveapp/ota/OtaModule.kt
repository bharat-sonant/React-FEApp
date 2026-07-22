package com.fieldexecutiveapp.ota

import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

/**
 * OTA support, exposed to JS as NativeModules.OtaUpdater. Ported from the IEC
 * app's OtaPackageInstaller, plus getAppVersion + restart so the app needs no
 * extra npm dependencies (react-native-device-info / react-native-restart).
 *
 *   install(zipPath)  — unzip a downloaded ota-package.zip into filesDir/ota/,
 *                       which MainApplication loads on next launch.
 *   getAppVersion()   — the installed versionName, for the update check.
 *   restart()         — full process restart, so MainApplication re-resolves
 *                       the (new) JS bundle path.
 */
class OtaModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OtaUpdater"

    @ReactMethod
    fun getAppVersion(promise: Promise) {
        try {
            val info = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            promise.resolve(info.versionName ?: "")
        } catch (_: Exception) {
            promise.resolve("")
        }
    }

    /** Cold-restart the whole app (re-reads the JS bundle path). */
    @ReactMethod
    fun restart() {
        try {
            val ctx = reactContext.applicationContext
            val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ctx.startActivity(intent)
            Runtime.getRuntime().exit(0)
        } catch (_: Exception) {
            // ignore — worst case the user reopens the app manually
        }
    }

    /**
     * Unzip the downloaded package into filesDir/ota/. Verifies the bundle is
     * present and guards against zip-slip. MainApplication picks it up next boot.
     */
    @ReactMethod
    fun install(zipPath: String, promise: Promise) {
        try {
            val zipFile = File(zipPath)
            if (!zipFile.exists()) {
                promise.reject("OTA_ZIP_MISSING", "OTA package not found: $zipPath")
                return
            }

            val filesDir = reactContext.filesDir
            val tempDir = File(filesDir, "ota_tmp")
            val otaDir = File(filesDir, "ota")
            val expectedBundle = File(tempDir, "index.android.bundle")
            val legacyBundle = File(filesDir, "index.android.bundle")

            deleteRecursively(tempDir)
            tempDir.mkdirs()
            unzipToDirectory(zipFile, tempDir)

            if (!expectedBundle.exists()) {
                deleteRecursively(tempDir)
                promise.reject("OTA_BUNDLE_MISSING", "index.android.bundle missing in OTA package")
                return
            }

            deleteRecursively(otaDir)
            if (!tempDir.renameTo(otaDir)) {
                copyDirectory(tempDir, otaDir)
                deleteRecursively(tempDir)
            }

            if (legacyBundle.exists()) legacyBundle.delete()
            zipFile.delete()
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("OTA_INSTALL_ERROR", error)
        }
    }

    private fun unzipToDirectory(zipFile: File, outputDir: File) {
        ZipInputStream(FileInputStream(zipFile)).use { zipInputStream ->
            var entry = zipInputStream.nextEntry
            while (entry != null) {
                val destination = File(outputDir, entry.name)
                val canonicalOutput = outputDir.canonicalPath + File.separator
                val canonicalDestination = destination.canonicalPath
                if (!canonicalDestination.startsWith(canonicalOutput)) {
                    throw IllegalStateException("Blocked invalid zip entry: ${entry.name}")
                }
                if (entry.isDirectory) {
                    destination.mkdirs()
                } else {
                    destination.parentFile?.mkdirs()
                    FileOutputStream(destination).use { out -> zipInputStream.copyTo(out) }
                }
                zipInputStream.closeEntry()
                entry = zipInputStream.nextEntry
            }
        }
    }

    private fun copyDirectory(source: File, target: File) {
        if (source.isDirectory) {
            if (!target.exists()) target.mkdirs()
            source.list()?.forEach { child -> copyDirectory(File(source, child), File(target, child)) }
        } else {
            source.copyTo(target, overwrite = true)
        }
    }

    private fun deleteRecursively(file: File) {
        if (file.isDirectory) file.listFiles()?.forEach { deleteRecursively(it) }
        file.delete()
    }
}
