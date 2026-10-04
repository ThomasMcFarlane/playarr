package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Wire types for the self-service portable user-data export and import routes. */

@Serializable
enum class UserDataExportStatus {
    @SerialName("queued") Queued,
    @SerialName("running") Running,
    @SerialName("ready") Ready,
    @SerialName("failed") Failed,
    @SerialName("expired") Expired,
}

@Serializable
data class UserDataExportProgress(val stage: String = "", val done: Int = 0, val total: Int = 0)

@Serializable
data class UserDataExportCounts(
    @SerialName("watch_progress") val watchProgress: Int = 0,
    @SerialName("playback_preferences") val playbackPreferences: Int = 0,
    val playlists: Int = 0,
    @SerialName("playlist_items") val playlistItems: Int = 0,
    val skipped: Int = 0,
)

@Serializable
data class UserDataExportJob(
    val id: String,
    val status: UserDataExportStatus,
    @SerialName("created_at") val createdAt: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    val progress: UserDataExportProgress = UserDataExportProgress(),
    val counts: UserDataExportCounts = UserDataExportCounts(),
    @SerialName("size_bytes") val sizeBytes: Long? = null,
    @SerialName("download_url") val downloadUrl: String? = null,
    val error: String? = null,
)

/** A one-time, 15-minute link for another device, shown as a QR code on television. */
@Serializable
data class UserDataTransferLink(
    val path: String = "",
    /** Absolute URL built by the server from the address the request used. */
    val url: String = "",
    @SerialName("expires_at") val expiresAt: String = "",
)

/** An import session whose one-time upload link another device uses (television). */
@Serializable
data class UserDataImportSession(
    val id: String,
    /** `waiting`, `uploading` or `uploaded`; kept as text so a newer server does not break decoding. */
    val status: String = "waiting",
    @SerialName("upload_path") val uploadPath: String? = null,
    @SerialName("upload_url") val uploadUrl: String? = null,
    @SerialName("expires_at") val expiresAt: String = "",
    @SerialName("size_bytes") val sizeBytes: Long? = null,
) {
    val isUploaded: Boolean get() = status == "uploaded"
}

@Serializable
data class UserDataSectionSummary(
    val total: Int = 0,
    @SerialName("will_add") val willAdd: Int = 0,
    @SerialName("will_update") val willUpdate: Int = 0,
    @SerialName("already_present") val alreadyPresent: Int = 0,
    @SerialName("conflicts_kept") val conflictsKept: Int = 0,
    val unmatched: Int = 0,
    val ambiguous: Int = 0,
)

@Serializable
data class UserDataPlaylistSummary(
    val total: Int = 0,
    val new: Int = 0,
    val existing: Int = 0,
    @SerialName("items_total") val itemsTotal: Int = 0,
    @SerialName("items_to_add") val itemsToAdd: Int = 0,
    @SerialName("items_already_present") val itemsAlreadyPresent: Int = 0,
    @SerialName("items_unmatched") val itemsUnmatched: Int = 0,
)

@Serializable
data class UserDataWatchlistSummary(
    val total: Int = 0,
    @SerialName("will_add") val willAdd: Int = 0,
    @SerialName("already_present") val alreadyPresent: Int = 0,
    /** Records that are invalid or of a kind this server does not know. */
    val unmatched: Int = 0,
)

@Serializable
data class UserDataImportSummary(
    @SerialName("watch_progress") val watchProgress: UserDataSectionSummary = UserDataSectionSummary(),
    val playlists: UserDataPlaylistSummary = UserDataPlaylistSummary(),
    /** Null when the server predates the watchlist section. */
    val watchlist: UserDataWatchlistSummary? = null,
    @SerialName("preferred_audio_language_change") val preferredAudioLanguageChange: String? = null,
    @SerialName("playback_preferences_not_applied") val playbackPreferencesNotApplied: Int = 0,
    @SerialName("unmatched_total") val unmatchedTotal: Int = 0,
)

@Serializable
data class UserDataImportSample(
    val section: String,
    val title: String,
    val outcome: String,
    val playlist: String? = null,
    val candidates: List<String> = emptyList(),
)

@Serializable
data class UserDataImportPreview(
    @SerialName("package_sha256") val packageSha256: String,
    @SerialName("schema_version") val schemaVersion: Int = 1,
    @SerialName("generated_at") val generatedAt: String = "",
    @SerialName("source_instance_name") val sourceInstanceName: String = "",
    val summary: UserDataImportSummary = UserDataImportSummary(),
    val samples: List<UserDataImportSample> = emptyList(),
    val warnings: List<String> = emptyList(),
)

@Serializable
data class UserDataImportResult(
    val completed: Boolean,
    @SerialName("progress_added") val progressAdded: Int = 0,
    @SerialName("progress_updated") val progressUpdated: Int = 0,
    @SerialName("progress_unchanged") val progressUnchanged: Int = 0,
    @SerialName("progress_conflicts_kept") val progressConflictsKept: Int = 0,
    @SerialName("playlists_created") val playlistsCreated: Int = 0,
    @SerialName("playlist_items_added") val playlistItemsAdded: Int = 0,
    @SerialName("playlist_items_already_present") val playlistItemsAlreadyPresent: Int = 0,
    @SerialName("preferred_audio_language_updated") val preferredAudioLanguageUpdated: Boolean = false,
    @SerialName("unmatched_total") val unmatchedTotal: Int = 0,
    val failure: String? = null,
    @SerialName("sections_not_attempted") val sectionsNotAttempted: List<String> = emptyList(),
)

/** How an import treats progress that already exists and differs. */
enum class UserDataProgressConflicts(val wire: String) {
    Newest("newest"),
    KeepExisting("keep_existing"),
}
