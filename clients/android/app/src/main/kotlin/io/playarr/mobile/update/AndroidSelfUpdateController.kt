package io.playarr.mobile.update

internal sealed interface AndroidUpdateEvent {
    data object Checking : AndroidUpdateEvent
    data class UpToDate(val versionName: String) : AndroidUpdateEvent
    data class Downloading(val versionName: String, val progress: Int?) : AndroidUpdateEvent
    data class PermissionRequired(val versionName: String) : AndroidUpdateEvent
    data class Installing(val versionName: String) : AndroidUpdateEvent
    data class Error(val message: String) : AndroidUpdateEvent
}

internal interface AndroidSelfUpdateController {
    fun checkForUpdates()

    fun resumePendingInstall()
}
