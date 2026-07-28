package io.playarr.mobile.update

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import io.playarr.mobile.BuildConfig
import java.io.File
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

private const val RELEASE_MANIFEST_URL =
    "https://playarr.app/downloads/android/playarr-android.json"
private const val PLAYARR_HOST = "playarr.app"
private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
private val releaseJson = Json { ignoreUnknownKeys = true }

@Serializable
internal data class AndroidReleaseManifest(
    @SerialName("version_name") val versionName: String,
    @SerialName("version_code") val versionCode: Int,
    @SerialName("apk_url") val apkUrl: String,
    @SerialName("sha256") val sha256: String,
)

internal sealed interface AndroidUpdateEvent {
    data object Checking : AndroidUpdateEvent
    data class UpToDate(val versionName: String) : AndroidUpdateEvent
    data class Downloading(val versionName: String, val progress: Int?) : AndroidUpdateEvent
    data class PermissionRequired(val versionName: String) : AndroidUpdateEvent
    data class Installing(val versionName: String) : AndroidUpdateEvent
    data class Error(val message: String) : AndroidUpdateEvent
}

internal fun decodeAndroidReleaseManifest(body: String): AndroidReleaseManifest =
    releaseJson.decodeFromString(body)

internal fun AndroidReleaseManifest.validate(): AndroidReleaseManifest {
    require(versionName.isNotBlank()) { "The update manifest has no version name." }
    require(versionCode > 0) { "The update manifest has an invalid version code." }
    require(sha256.matches(Regex("[0-9a-fA-F]{64}"))) {
        "The update manifest has an invalid checksum."
    }
    val uri = URI(apkUrl)
    require(
        uri.scheme == "https" &&
            uri.host == PLAYARR_HOST &&
            uri.userInfo == null &&
            (uri.port == -1 || uri.port == 443) &&
            uri.path.matches(
                Regex("/downloads/android/releases/[0-9]+\\.[0-9]+\\.[0-9]+/playarr-android\\.apk"),
            )
    ) { "The update manifest points outside the Playarr Android releases." }
    return copy(sha256 = sha256.lowercase())
}

internal fun AndroidReleaseManifest.isNewerThan(installedVersionCode: Int): Boolean =
    versionCode > installedVersionCode

internal fun sha256Hex(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
}

/**
 * Sideload updater for television installs of the universal Android APK.
 * It trusts only the immutable playarr.app release route, verifies the
 * published checksum, and leaves final installation consent to Android.
 */
internal class AndroidSelfUpdater(
    private val activity: Activity,
    private val scope: CoroutineScope,
    private val onEvent: (AndroidUpdateEvent) -> Unit,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    private var updateJob: Job? = null
    private var pendingInstall: Pair<File, String>? = null
    private var waitingForInstallPermission = false
    private var installerWasLaunched = false

    fun checkForUpdates() {
        if (updateJob?.isActive == true) return
        updateJob = scope.launch {
            pendingInstall?.takeIf { (file, _) -> file.isFile }?.let { (file, versionName) ->
                requestInstall(file, versionName)
                return@launch
            }
            onEvent(AndroidUpdateEvent.Checking)
            runCatching {
                val manifest = withContext(Dispatchers.IO) { fetchManifest() }
                if (!manifest.isNewerThan(BuildConfig.VERSION_CODE)) {
                    onEvent(AndroidUpdateEvent.UpToDate(BuildConfig.VERSION_NAME))
                    return@launch
                }

                onEvent(AndroidUpdateEvent.Downloading(manifest.versionName, null))
                val apk = withContext(Dispatchers.IO) { downloadAndVerify(manifest) }
                pendingInstall = apk to manifest.versionName
                requestInstall(apk, manifest.versionName)
            }.onFailure { error ->
                onEvent(
                    AndroidUpdateEvent.Error(
                        error.message ?: "Could not check for a Playarr update.",
                    ),
                )
            }
        }
    }

    fun resumePendingInstall() {
        if (installerWasLaunched) {
            installerWasLaunched = false
            onEvent(
                AndroidUpdateEvent.Error(
                    "The update was not installed. Select the button to try again.",
                ),
            )
            return
        }
        if (!waitingForInstallPermission) return
        val (file, versionName) = pendingInstall ?: return
        if (!file.isFile) {
            pendingInstall = null
            return
        }
        if (activity.packageManager.canRequestPackageInstalls()) {
            waitingForInstallPermission = false
            requestInstall(file, versionName)
        } else {
            onEvent(AndroidUpdateEvent.PermissionRequired(versionName))
        }
    }

    private fun fetchManifest(): AndroidReleaseManifest {
        val request = Request.Builder()
            .url(RELEASE_MANIFEST_URL)
            .header("Accept", "application/json")
            .build()
        return httpClient.newCall(request).execute().use { response ->
            check(response.isSuccessful) {
                "Playarr returned HTTP ${response.code} while checking for updates."
            }
            decodeAndroidReleaseManifest(response.body.string()).validate()
        }
    }

    private fun downloadAndVerify(manifest: AndroidReleaseManifest): File {
        val updateDirectory = File(activity.cacheDir, "updates").apply { mkdirs() }
        check(updateDirectory.isDirectory) { "Could not prepare the update download folder." }
        val target = File(updateDirectory, "playarr-android-${manifest.versionCode}.apk")
        val partial = File(updateDirectory, "${target.name}.part")
        partial.delete()

        val request = Request.Builder().url(manifest.apkUrl).build()
        httpClient.newCall(request).execute().use { response ->
            check(response.isSuccessful) {
                "Playarr returned HTTP ${response.code} while downloading the update."
            }
            check(response.request.url.scheme == "https" && response.request.url.host == PLAYARR_HOST) {
                "The update download was redirected outside playarr.app."
            }
            val totalBytes = response.body.contentLength().takeIf { it > 0 }
            response.body.byteStream().use { source ->
                partial.outputStream().buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var downloadedBytes = 0L
                    var lastProgress = -1
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloadedBytes += count
                        val progress = totalBytes?.let { ((downloadedBytes * 100) / it).toInt() }
                        if (progress != null && progress >= lastProgress + 5) {
                            lastProgress = progress
                            activity.runOnUiThread {
                                onEvent(
                                    AndroidUpdateEvent.Downloading(
                                        manifest.versionName,
                                        progress.coerceIn(0, 100),
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }

        val actualChecksum = partial.inputStream().buffered().use(::sha256Hex)
        check(actualChecksum == manifest.sha256) {
            partial.delete()
            "The downloaded update did not match Playarr's published checksum."
        }
        target.delete()
        check(partial.renameTo(target)) { "Could not finish saving the update." }
        updateDirectory.listFiles()
            ?.filter { it != target && it.name.startsWith("playarr-android-") }
            ?.forEach(File::delete)
        return target
    }

    private fun requestInstall(file: File, versionName: String) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            waitingForInstallPermission = true
            onEvent(AndroidUpdateEvent.PermissionRequired(versionName))
            val settingsIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                "package:${activity.packageName}".toUri(),
            )
            runCatching { activity.startActivity(settingsIntent) }
                .onFailure {
                    onEvent(
                        AndroidUpdateEvent.Error(
                            "Open Settings and allow Playarr to install updates.",
                        ),
                    )
                }
            return
        }

        val contentUri = FileProvider.getUriForFile(
            activity,
            "${BuildConfig.APPLICATION_ID}.fileprovider",
            file,
        )
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, APK_MIME_TYPE)
            clipData = ClipData.newRawUri("Playarr update", contentUri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching {
            onEvent(AndroidUpdateEvent.Installing(versionName))
            installerWasLaunched = true
            activity.startActivity(installIntent)
        }.onFailure { error ->
            installerWasLaunched = false
            onEvent(
                AndroidUpdateEvent.Error(
                    error.message ?: "Could not open the Android installer.",
                ),
            )
        }
    }
}
