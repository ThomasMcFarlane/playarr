package io.playarr.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.shared.data.model.FolderBrowseResponse
import io.playarr.shared.data.model.FolderBreadcrumb
import io.playarr.shared.data.model.FolderEntry
import io.playarr.shared.data.model.FolderEntryType
import io.playarr.shared.data.model.FolderRoot
import io.playarr.shared.data.model.FolderRootsResponse
import io.playarr.shared.data.model.WorkKind
import java.util.Locale

internal data class PlayarrFolderBrowserState(
    val roots: ExperienceLoad<FolderRootsResponse> = ExperienceLoad.Loading,
    val selectedRootId: String? = null,
    val browse: ExperienceLoad<FolderBrowseResponse>? = null,
    val requestedPath: String = "",
    val loadingMore: Boolean = false,
)

internal fun PlayarrFolderBrowserState.beginFolderBrowse(
    rootId: String,
    path: String,
): PlayarrFolderBrowserState = copy(
    selectedRootId = rootId,
    browse = ExperienceLoad.Loading,
    requestedPath = path,
    loadingMore = false,
)

internal fun Throwable.folderBrowserMessage(): PlayarrMessage =
    message?.trim()?.takeIf(String::isNotEmpty)?.let(PlayarrMessage::Dynamic)
        ?: PlayarrMessage.Localized(PlayarrString.FoldersUnableToLoad)

internal fun folderParentPath(path: String): String =
    path.trim('/').substringBeforeLast('/', missingDelimiterValue = "")

internal fun folderPlaybackQueueItems(entries: List<FolderEntry>): List<PlayarrPlaybackQueueItem> =
    entries.mapNotNull { entry ->
        val mediaFileId = entry.mediaFileId?.takeIf(String::isNotBlank)
        if (entry.entryType != FolderEntryType.Media || mediaFileId == null) return@mapNotNull null
        PlayarrPlaybackQueueItem(
            mediaFileId = mediaFileId,
            title = entry.title?.takeIf(String::isNotBlank) ?: entry.name,
            subtitle = listOfNotNull(
                entry.artist?.takeIf(String::isNotBlank),
                entry.album?.takeIf(String::isNotBlank),
            ).distinct().joinToString(" · ").takeIf(String::isNotBlank),
            music = entry.mediaKind == WorkKind.Artist ||
                entry.mediaKind == WorkKind.Author ||
                (entry.videoCodec == null && entry.audioCodec != null),
        )
    }

@Composable
internal fun ExperienceFolderBrowser(
    libraryLabel: String,
    state: PlayarrFolderBrowserState,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onOpenFilters: () -> Unit,
    onRetryRoots: () -> Unit,
    onSelectRoot: (String) -> Unit,
    onBrowse: (rootId: String, path: String) -> Unit,
    onLoadMore: (rootId: String, path: String) -> Unit,
    onPlay: (FolderEntry, List<FolderEntry>) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WebSurface)
            .padding(start = if (isTelevision) 118.dp else 0.dp)
            .padding(top = if (isTelevision) 42.dp else 12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = if (isTelevision) 30.dp else 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    playarrString(PlayarrString.FoldersTitle, "library" to libraryLabel),
                    color = WebInk,
                    fontSize = if (isTelevision) 28.sp else 22.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    playarrString(PlayarrString.FoldersDescription),
                    color = WebInkMuted,
                    fontSize = 11.sp,
                )
            }
            IconButton(onClick = onOpenFilters) {
                Icon(
                    Icons.Outlined.FilterList,
                    contentDescription = playarrString(PlayarrString.LibraryFilters),
                    tint = WebInkMuted,
                )
            }
        }

        when (val roots = state.roots) {
            ExperienceLoad.Loading -> FolderStatus(
                message = playarrString(PlayarrString.FoldersLoadingRoots),
                loading = true,
            )
            is ExperienceLoad.Failed -> FolderStatus(
                message = playarrText(roots.message),
                onRetry = onRetryRoots,
            )
            is ExperienceLoad.Ready -> FolderRootsContent(
                response = roots.value,
                state = state,
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                onSelectRoot = onSelectRoot,
                onBrowse = onBrowse,
                onLoadMore = onLoadMore,
                onPlay = onPlay,
            )
        }
    }
}

@Composable
private fun FolderRootsContent(
    response: FolderRootsResponse,
    state: PlayarrFolderBrowserState,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onSelectRoot: (String) -> Unit,
    onBrowse: (rootId: String, path: String) -> Unit,
    onLoadMore: (rootId: String, path: String) -> Unit,
    onPlay: (FolderEntry, List<FolderEntry>) -> Unit,
) {
    if (response.roots.isEmpty()) {
        FolderStatus(message = playarrString(PlayarrString.FoldersNoRoots))
        return
    }

    LazyRow(
        modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
        contentPadding = PaddingValues(horizontal = if (isTelevision) 30.dp else 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(response.roots, key = FolderRoot::id) { root ->
            FolderRootButton(
                root = root,
                selected = root.id == state.selectedRootId,
                onClick = { onSelectRoot(root.id) },
            )
        }
    }

    if (response.errors.isNotEmpty()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = if (isTelevision) 30.dp else 16.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(WebSurfaceSoft)
                .padding(10.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = WebInkMuted)
            Text(
                response.errors.joinToString("\n") { "${it.sourceName}: ${it.message}" },
                color = WebInkMuted,
                fontSize = 10.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    val selectedRoot = response.roots.firstOrNull { it.id == state.selectedRootId }
    if (selectedRoot == null) {
        FolderStatus(message = playarrString(PlayarrString.FoldersNoAvailableRoots))
        return
    }

    when (val browse = state.browse) {
        null, ExperienceLoad.Loading -> FolderStatus(
            message = playarrString(PlayarrString.FoldersLoadingDirectory),
            loading = true,
        )
        is ExperienceLoad.Failed -> FolderStatus(
            message = playarrText(browse.message),
            onRetry = { onBrowse(selectedRoot.id, state.requestedPath) },
        )
        is ExperienceLoad.Ready -> FolderDirectory(
            response = browse.value,
            serverUrl = serverUrl,
            accessToken = accessToken,
            isTelevision = isTelevision,
            loadingMore = state.loadingMore,
            onBrowse = { onBrowse(selectedRoot.id, it) },
            onLoadMore = { onLoadMore(selectedRoot.id, browse.value.path) },
            onPlay = onPlay,
        )
    }
}

@Composable
private fun FolderRootButton(
    root: FolderRoot,
    selected: Boolean,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    Surface(
        color = if (selected) WebSurfaceStrong else WebSurfaceSoft,
        shape = shape,
        modifier = Modifier
            .width(190.dp)
            .scale(rememberPlayarrFocusScale(focused || selected, label = "folderRootFocus"))
            .then(if (focused || selected) Modifier.border(1.dp, WebInkSoft, shape) else Modifier)
            .clip(shape)
            .clickable(enabled = root.available, onClick = onClick)
            .onFocusChangedCompat { focused = it }
            .focusable(enabled = root.available),
    ) {
        Column(Modifier.padding(horizontal = 13.dp, vertical = 10.dp)) {
            Text(
                root.name,
                color = if (root.available) WebInk else WebInkMuted,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                root.sourceName,
                color = WebInkMuted,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            root.unavailableReason?.takeIf { !root.available }?.let {
                Text(it, color = WebInkMuted, fontSize = 9.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun FolderDirectory(
    response: FolderBrowseResponse,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    loadingMore: Boolean,
    onBrowse: (String) -> Unit,
    onLoadMore: () -> Unit,
    onPlay: (FolderEntry, List<FolderEntry>) -> Unit,
) {
    val parentPath = folderParentPath(response.path)
    BackHandler(enabled = response.path.isNotEmpty()) { onBrowse(parentPath) }

    val breadcrumbs = response.breadcrumbs.ifEmpty {
        listOf(FolderBreadcrumb(response.root.name, ""))
    }
    LazyRow(
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        contentPadding = PaddingValues(horizontal = if (isTelevision) 30.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(breadcrumbs, key = FolderBreadcrumb::path) { breadcrumb ->
            TextButton(onClick = { onBrowse(breadcrumb.path) }) {
                Text(
                    breadcrumb.name,
                    color = if (breadcrumb.path == response.path) WebInk else WebInkMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (breadcrumb.path != breadcrumbs.last().path) {
                Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = WebInkMuted)
            }
        }
    }

    Text(
        playarrString(
            PlayarrString.FoldersItemCount,
            "count" to response.total,
        ),
        color = WebInkMuted,
        fontSize = 10.sp,
        modifier = Modifier.padding(horizontal = if (isTelevision) 30.dp else 16.dp),
    )

    if (response.entries.isEmpty()) {
        FolderStatus(message = playarrString(PlayarrString.FoldersEmptyDirectory))
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = if (isTelevision) 30.dp else 16.dp,
            end = if (isTelevision) 30.dp else 16.dp,
            top = 12.dp,
            bottom = if (isTelevision) 80.dp else 116.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(
            items = response.entries,
            key = { entry -> "${entry.entryType}:${entry.path}" },
        ) { entry ->
            FolderEntryRow(
                entry = entry,
                serverUrl = serverUrl,
                accessToken = accessToken,
                onClick = {
                    when (entry.entryType) {
                        FolderEntryType.Directory -> onBrowse(entry.path)
                        FolderEntryType.Media -> onPlay(entry, response.entries)
                    }
                },
            )
        }
        if (response.entries.size.toLong() < response.total) {
            item {
                Button(onClick = onLoadMore, enabled = !loadingMore) {
                    if (loadingMore) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(playarrString(PlayarrString.FoldersLoadMore))
                }
            }
        }
    }
}

@Composable
private fun FolderEntryRow(
    entry: FolderEntry,
    serverUrl: String,
    accessToken: String?,
    onClick: () -> Unit,
) {
    val playable = entry.entryType == FolderEntryType.Directory || !entry.mediaFileId.isNullOrBlank()
    val mediaFileId = entry.mediaFileId
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .scale(rememberPlayarrFocusScale(focused, label = "folderEntryFocus"))
            .clip(shape)
            .background(WebSurfaceSoft.copy(alpha = 0.76f))
            .then(if (focused) Modifier.border(1.dp, WebInkSoft, shape) else Modifier)
            .clickable(enabled = playable, onClick = onClick)
            .onFocusChangedCompat { focused = it }
            .focusable(enabled = playable)
            .padding(9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .width(112.dp)
                .height(64.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(WebSurfaceStrong),
            contentAlignment = Alignment.Center,
        ) {
            when {
                entry.entryType == FolderEntryType.Directory -> {
                    Icon(Icons.Outlined.Folder, contentDescription = null, tint = WebInkMuted, modifier = Modifier.size(32.dp))
                }
                mediaFileId != null && !entry.thumbnailUrl.isNullOrBlank() -> {
                    AuthenticatedMediaThumbnail(
                        mediaFileId = mediaFileId,
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentDescription = entry.title ?: entry.name,
                        thumbnailUrl = entry.thumbnailUrl,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                else -> {
                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, contentDescription = null, tint = WebInkMuted)
                }
            }
        }
        Column(Modifier.weight(1f).padding(horizontal = 13.dp)) {
            Text(
                entry.title?.takeIf(String::isNotBlank) ?: entry.name,
                color = if (playable) WebInk else WebInkMuted,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (entry.entryType == FolderEntryType.Media && entry.title?.takeIf(String::isNotBlank) != null) {
                Text(entry.name, color = WebInkMuted, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(
                folderEntryMetadata(entry),
                color = WebInkMuted,
                fontSize = 10.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(
            if (entry.entryType == FolderEntryType.Directory) {
                Icons.Outlined.ChevronRight
            } else {
                Icons.Outlined.PlayArrow
            },
            contentDescription = null,
            tint = if (playable) WebInkMuted else WebSurfaceStrong,
        )
    }
}

@Composable
private fun FolderStatus(
    message: String,
    loading: Boolean = false,
    onRetry: (() -> Unit)? = null,
) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (loading) CircularProgressIndicator()
            Text(message, color = WebInkMuted)
            if (onRetry != null) {
                Button(onClick = onRetry) { Text(playarrString(PlayarrString.FoldersRetry)) }
            }
        }
    }
}

internal fun folderEntryMetadata(entry: FolderEntry): String {
    if (entry.entryType == FolderEntryType.Directory) return ""
    val people = listOfNotNull(
        entry.artist?.takeIf(String::isNotBlank),
        entry.album?.takeIf(String::isNotBlank),
    ).distinct().joinToString(" · ").takeIf(String::isNotBlank)
    val technical = listOfNotNull(
        entry.container?.takeIf(String::isNotBlank)?.uppercase(Locale.ROOT),
        entry.width?.let { width -> entry.height?.let { height -> "${width}×$height" } },
        entry.videoCodec?.takeIf(String::isNotBlank)?.uppercase(Locale.ROOT),
        entry.audioCodec?.takeIf(String::isNotBlank)?.uppercase(Locale.ROOT),
        formatFolderDuration(entry.durationMs),
        formatFolderSize(entry.sizeBytes),
        entry.modifiedAt?.substringBefore('T')?.takeIf(String::isNotBlank),
    ).distinct().joinToString(" · ").takeIf(String::isNotBlank)
    return listOfNotNull(people, technical).joinToString("\n")
}

internal fun formatFolderDuration(durationMs: Long?): String? {
    val totalSeconds = durationMs?.takeIf { it >= 0 }?.div(1_000) ?: return null
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(Locale.ROOT, hours, minutes, seconds)
    } else {
        "%d:%02d".format(Locale.ROOT, minutes, seconds)
    }
}

internal fun formatFolderSize(sizeBytes: Long?): String? {
    val bytes = sizeBytes?.takeIf { it >= 0 } ?: return null
    if (bytes < 1_024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unit = -1
    while (value >= 1_024 && unit < units.lastIndex) {
        value /= 1_024
        unit++
    }
    return if (value >= 10) {
        "%.0f %s".format(Locale.ROOT, value, units[unit])
    } else {
        "%.1f %s".format(Locale.ROOT, value, units[unit])
    }
}

private fun Modifier.onFocusChangedCompat(onFocused: (Boolean) -> Unit): Modifier =
    onFocusChanged { state -> onFocused(state.isFocused) }
