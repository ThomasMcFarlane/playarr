package io.playarr.shared.data.model

import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of the unsorted-folders schemas in `backend/openapi/playarr.yaml`
 * (`FolderRootsResponse`, `FolderRootResponse`, `FolderBrowseResponse`, `FolderEntryResponse`).
 * Responses are path-free: roots are opaque ids and entries carry root-relative paths only.
 * Enum-like fields stay raw wire strings so an unknown future value degrades one entry instead
 * of failing the decode.
 */
@Serializable
data class FolderRootsResponse(val roots: List<FolderRoot> = emptyList())

@Serializable
data class FolderRoot(
    val id: String,
    val sourceInstanceId: String = "",
    val sourceName: String = "",
    val libraryKind: String = "",
    val name: String,
    val available: Boolean = false,
    val scanStatus: String = "pending",
    val lastScannedAt: String? = null,
    val itemCount: Long = 0,
)

@Serializable
data class FolderBreadcrumb(val name: String, val path: String = "")

@Serializable
data class FolderEntry(
    /** `directory` or `media`. */
    val entryType: String,
    val name: String,
    /** Root-relative path; pass it as `path` to open a directory. */
    val path: String,
    /** Playback id for media entries; use the normal playback routes. */
    val mediaFileId: String? = null,
    val mediaKind: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val container: String? = null,
    val videoCodec: String? = null,
    val audioCodec: String? = null,
    val durationMs: Long? = null,
    val bitrateBps: Long? = null,
    val sizeBytes: Long? = null,
    val width: Int? = null,
    val height: Int? = null,
    val modifiedAt: String? = null,
    /** Playable files below a directory. */
    val itemCount: Long? = null,
    /** The caller's own state: `part_watched`, `watched` or `unseen`. */
    val watchState: String? = null,
    val positionMs: Long? = null,
    /** Server-relative thumbnail path (includes the chosen frame position). */
    val thumbnailUrl: String? = null,
) {
    val isDirectory: Boolean get() = entryType == "directory"
    val isMedia: Boolean get() = entryType == "media" && mediaFileId != null
    val displayName: String get() = if (isDirectory) name else title?.takeIf(String::isNotBlank) ?: name

    /** Fraction watched (0..1) for a part-watched entry, else 0. */
    val progress: Float
        get() {
            val position = positionMs ?: return 0f
            val duration = durationMs ?: return 0f
            if (watchState != "part_watched" || duration <= 0L) return 0f
            return (position.toFloat() / duration.toFloat()).coerceIn(0f, 1f)
        }

    /** Frame position the server chose for [thumbnailUrl] (`?position_ms=`), if any. */
    val thumbnailPositionMs: Long?
        get() = thumbnailUrl?.substringAfter("position_ms=", "")?.takeWhile(Char::isDigit)?.toLongOrNull()
}

@Serializable
data class FolderBrowseResponse(
    val root: FolderRoot,
    val path: String = "",
    val breadcrumbs: List<FolderBreadcrumb> = emptyList(),
    val entries: List<FolderEntry> = emptyList(),
    val total: Long = 0,
    val offset: Int = 0,
    val limit: Int = 0,
)
