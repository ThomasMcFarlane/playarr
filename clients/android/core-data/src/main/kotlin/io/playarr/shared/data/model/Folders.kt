package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One source root exposed for directory-based browsing. */
@Serializable
data class FolderRoot(
    val id: String,
    val sourceInstanceId: String,
    val sourceName: String,
    val libraryKind: WorkKind,
    val name: String,
    val available: Boolean,
    val unavailableReason: String? = null,
)

/** A source-specific problem which did not prevent other roots being returned. */
@Serializable
data class FolderRootError(
    val sourceInstanceId: String,
    val sourceName: String,
    val message: String,
)

@Serializable
data class FolderRootsResponse(
    val roots: List<FolderRoot>,
    val errors: List<FolderRootError> = emptyList(),
)

@Serializable
data class FolderBreadcrumb(
    val name: String,
    val path: String,
)

@Serializable
enum class FolderEntryType {
    @SerialName("directory")
    Directory,

    @SerialName("media")
    Media,
}

/** One directory or file-derived media item beneath a root. */
@Serializable
data class FolderEntry(
    val entryType: FolderEntryType,
    val name: String,
    val path: String,
    val mediaFileId: String? = null,
    val mediaKind: WorkKind? = null,
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
    val thumbnailUrl: String? = null,
)

@Serializable
data class FolderBrowseResponse(
    val root: FolderRoot,
    val path: String,
    val breadcrumbs: List<FolderBreadcrumb>,
    val entries: List<FolderEntry>,
    val total: Long,
    val offset: Long,
    val limit: Long,
)
