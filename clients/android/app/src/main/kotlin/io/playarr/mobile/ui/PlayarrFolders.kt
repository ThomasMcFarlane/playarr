package io.playarr.mobile.ui

import io.playarr.shared.designsystem.page.PlayarrPageId
import io.playarr.shared.designsystem.page.PlayarrEmptyState
import io.playarr.shared.designsystem.page.PlayarrErrorState
import io.playarr.shared.designsystem.page.PlayarrLoadingState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import io.playarr.shared.data.events.LiveArea
import io.playarr.shared.data.events.LiveTarget
import io.playarr.shared.data.model.FolderEntry
import io.playarr.shared.data.model.FolderRoot
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonSize
import io.playarr.shared.designsystem.component.PlayarrButtonVariant

private val FOLDERS_LIVE_INTEREST = setOf(LiveTarget(LiveArea.Library), LiveTarget(LiveArea.Progress))

/**
 * Folders library view: browse the root folders an administrator enabled as a directory tree, play and resume
 * files. Route state matches the web client's query parameters (`root`, `path`, `view`, `size`, `sort`, `order`,
 * `q`, `type`, `panel`), see [FolderUrlState].
 */
@Composable
internal fun ExperienceFoldersScreen(
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onBack: () -> Unit,
    onPlay: (entry: FolderEntry, queue: List<PlayarrPlaybackQueueItem>) -> Unit,
    viewModel: FoldersViewModel = hiltViewModel(),
) {
    val holder = viewModel.folders
    val state by holder.state.collectAsState()
    LiveRefreshEffect(viewModel.liveBus, FOLDERS_LIVE_INTEREST, { holder.fetchStartedMs }, holder::refresh)
    val url = state.url
    val rootCount = (state.roots as? FolderRootsLoad.Ready)?.roots?.size ?: 0
    val root = state.currentRoot
    val detail = when {
        root != null -> root.name
        rootCount > 1 -> playarrString(PlayarrString.FoldersChooseRoot)
        else -> null
    }
    PlayarrPageScaffold(
        pageId = PlayarrPageId.Folders,
        title = playarrString(PlayarrString.FoldersTitle),
        subtitle = detail,
        onBack = { if (!holder.up(rootCount)) onBack() },
        isTelevision = isTelevision,
        filters = if (root == null) {
            null
        } else {
            PlayarrFilterAction(
                label = playarrString(PlayarrString.LibraryFilters),
                active = url.panel == FolderPanel.Filters,
                badge = url.activeFilterCount,
                onClick = { holder.openPanel(FolderPanel.Filters) },
            )
        },
    ) {
        when (val roots = state.roots) {
            FolderRootsLoad.Loading -> PlayarrLoadingState(playarrString(PlayarrString.FoldersLoading))
            is FolderRootsLoad.Failed -> PlayarrErrorState(roots.message, holder::loadRoots)
            is FolderRootsLoad.Ready -> when {
                roots.roots.isEmpty() -> PlayarrEmptyState(
                    playarrString(PlayarrString.FoldersNoRootsTitle),
                    playarrString(PlayarrString.FoldersNoRootsDescription),
                )
                root == null -> FolderRootChooser(roots.roots, isTelevision, holder::openRoot)
                else -> FolderBrowser(state, root, serverUrl, accessToken, isTelevision, holder, onPlay)
            }
        }
    }
    if (root != null && url.panel == FolderPanel.Filters) FolderFiltersSheet(state.url, holder)
}

@Composable
private fun FolderRootChooser(roots: List<FolderRoot>, isTelevision: Boolean, onChoose: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(roots, key = FolderRoot::id) { root ->
            val status = when {
                root.available -> playarrString(PlayarrString.FoldersRootItems, "count" to root.itemCount)
                root.scanStatus == "scanning" -> playarrString(PlayarrString.FoldersRootScanning)
                else -> playarrString(PlayarrString.FoldersRootNotScanned)
            }
            FolderRow(
                label = playarrString(PlayarrString.FoldersOpenFolder, "name" to root.name),
                isTelevision = isTelevision,
                onClick = { onChoose(root.id) },
            ) {
                FolderGlyph(Modifier.size(if (isTelevision) 64.dp else 48.dp))
                Column(Modifier.padding(start = 14.dp)) {
                    Text(root.name, color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${root.sourceName} · $status", color = WebInkSoft, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.FolderBrowser(
    state: FolderUiState,
    root: FolderRoot,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    holder: FolderStateHolder,
    onPlay: (FolderEntry, List<PlayarrPlaybackQueueItem>) -> Unit,
) {
    val url = state.url
    FolderBreadcrumbs(root.name, url.path, (state.listing as? FolderListing.Ready), holder::openDirectory)
    when (val listing = state.listing) {
        FolderListing.Idle, FolderListing.Loading -> PlayarrLoadingState(playarrString(PlayarrString.FoldersLoading))
        is FolderListing.Failed -> PlayarrErrorState(listing.message) { holder.openDirectory(url.path) }
        FolderListing.Missing -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(32.dp)) {
                Text(playarrString(PlayarrString.FoldersMissingTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
                PlayarrButton(onClick = { holder.openDirectory(parentFolderPath(url.path)) }) {
                    Text(playarrString(PlayarrString.FoldersBackToParent))
                }
            }
        }
        is FolderListing.Ready -> if (listing.entries.isEmpty()) {
            val filtered = url.activeFilterCount > 0
            Box(Modifier.weight(1f).fillMaxWidth()) {
                PlayarrEmptyState(
                    playarrString(if (filtered) PlayarrString.FoldersNoMatchTitle else PlayarrString.FoldersEmptyTitle),
                    playarrString(if (filtered) PlayarrString.FoldersNoMatchDescription else PlayarrString.FoldersEmptyDescription),
                )
            }
        } else {
            val queue = remember(listing.entries) { folderPlaybackQueue(listing.entries) }
            val open: (FolderEntry) -> Unit = { entry ->
                if (entry.isDirectory) holder.openDirectory(entry.path) else onPlay(entry, queue)
            }
            val more: (@Composable () -> Unit)? = if (listing.hasMore) {
                {
                    PlayarrButton(onClick = holder::loadMore, enabled = !listing.loadingMore, variant = PlayarrButtonVariant.Secondary) {
                        Text(playarrString(PlayarrString.FoldersLoadMore))
                    }
                }
            } else {
                null
            }
            if (url.view == FolderViewMode.Cover) {
                val min = when (url.size) {
                    FolderSize.Small -> if (isTelevision) 190.dp else 140.dp
                    FolderSize.Medium -> if (isTelevision) 250.dp else 170.dp
                    FolderSize.Large -> if (isTelevision) 330.dp else 230.dp
                }
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(min),
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    gridItems(listing.entries, key = { it.entryType + ":" + it.path }) { entry ->
                        FolderCard(entry, true, serverUrl, accessToken, isTelevision) { open(entry) }
                    }
                    if (more != null) item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.padding(vertical = 12.dp)) { more() } }
                }
            } else {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(listing.entries, key = { it.entryType + ":" + it.path }) { entry ->
                        FolderCard(entry, false, serverUrl, accessToken, isTelevision) { open(entry) }
                    }
                    if (more != null) item { Box(Modifier.padding(vertical = 12.dp)) { more() } }
                }
            }
        }
    }
}

@Composable
private fun FolderBreadcrumbs(rootName: String, path: String, listing: FolderListing.Ready?, onOpen: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        LazyRow(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            item {
                PlayarrButton(onClick = { onOpen("") }, variant = PlayarrButtonVariant.Ghost, size = PlayarrButtonSize.Small) {
                    Text(rootName, color = WebInk, fontWeight = if (path.isEmpty()) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                }
            }
            items(folderAncestors(path)) { ancestor ->
                Text("/", color = WebInkMuted)
                PlayarrButton(onClick = { onOpen(ancestor) }, variant = PlayarrButtonVariant.Ghost, size = PlayarrButtonSize.Small) {
                    Text(
                        ancestor.substringAfterLast('/'),
                        color = WebInk,
                        fontWeight = if (ancestor == path) FontWeight.Bold else FontWeight.Normal,
                        maxLines = 1,
                    )
                }
            }
        }
        if (listing != null) {
            Text(
                if (listing.hasMore) {
                    playarrString(PlayarrString.FoldersShown, "shown" to listing.entries.size, "total" to listing.data.total)
                } else {
                    playarrString(PlayarrString.FoldersItems, "count" to listing.data.total)
                },
                color = WebInkSoft,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 12.dp),
            )
        }
    }
}

@Composable
private fun FolderGlyph(modifier: Modifier = Modifier) {
    Icon(Icons.Outlined.Folder, contentDescription = null, tint = WebInkSoft, modifier = modifier)
}

/** A focusable row/tile with the shared D-pad ring; [label] is its accessibility description. */
@Composable
private fun FolderRow(label: String, isTelevision: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    Surface(
        onClick = onClick,
        interactionSource = source,
        color = WebSurfaceStrong,
        shape = shape,
        modifier = Modifier
            .fillMaxWidth()
            .border(BorderStroke(if (focused) 3.dp else 1.dp, if (focused) WebAccent else WebInk.copy(alpha = 0.14f)), shape)
            .semantics { contentDescription = label },
    ) {
        Row(Modifier.padding(if (isTelevision) 14.dp else 10.dp), verticalAlignment = Alignment.CenterVertically) { content() }
    }
}

@Composable
private fun FolderCard(
    entry: FolderEntry,
    cover: Boolean,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onClick: () -> Unit,
) {
    val resumable = entry.isMedia && entry.watchState == "part_watched"
    val watched = entry.isMedia && entry.watchState == "watched"
    val name = entry.displayName
    val label = when {
        entry.isDirectory -> playarrString(PlayarrString.FoldersOpenFolder, "name" to name)
        resumable -> playarrString(PlayarrString.FoldersResumeItem, "name" to name)
        else -> playarrString(PlayarrString.FoldersPlayItem, "name" to name)
    }
    val meta = if (entry.isDirectory) {
        playarrString(PlayarrString.FoldersItems, "count" to (entry.itemCount ?: 0L))
    } else {
        listOfNotNull(
            formatFolderDuration(entry.durationMs).takeIf(String::isNotEmpty),
            entry.height?.let { "${it}p" },
            entry.artist?.takeIf(String::isNotBlank),
            entry.sizeBytes?.let(::formatFolderSize),
        ).joinToString(" · ")
    }
    val thumb: @Composable (Modifier) -> Unit = { modifier ->
        Box(modifier.background(WebSurfaceSoft, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            when {
                entry.isDirectory -> FolderGlyph(Modifier.size(40.dp))
                entry.thumbnailUrl != null && entry.mediaFileId != null && cover -> AuthenticatedMediaThumbnail(
                    mediaFileId = entry.mediaFileId!!,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    contentDescription = "",
                    modifier = Modifier.fillMaxSize(),
                    positionMs = entry.thumbnailPositionMs,
                )
                else -> Icon(Icons.Outlined.PlayArrow, contentDescription = null, tint = WebInkSoft, modifier = Modifier.size(36.dp))
            }
            if (entry.progress > 0f) {
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp).background(WebInk.copy(alpha = 0.3f))) {
                    Box(Modifier.fillMaxWidth(entry.progress).fillMaxHeight().background(WebAccent))
                }
            }
        }
    }
    val text: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (meta.isNotEmpty()) Text(meta, color = WebInkSoft, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (resumable) Text(playarrString(PlayarrString.FoldersResume), color = WebAccent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (watched) Text(playarrString(PlayarrString.FoldersWatched), color = WebInkMuted, fontSize = 12.sp)
        }
    }
    FolderRow(label, isTelevision, onClick) {
        if (cover) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                thumb(Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                text()
            }
        } else {
            thumb(Modifier.width(if (isTelevision) 140.dp else 96.dp).aspectRatio(16f / 9f))
            Box(Modifier.padding(start = 12.dp)) { text() }
        }
    }
}

/** Binary units, one decimal above the smallest (matches the web `formatBytes`). */
internal fun formatFolderSize(bytes: Long): String {
    if (bytes < 0) return ""
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    val decimals = if (unit == 0) 0 else if (value < 10) 2 else if (value < 100) 1 else 0
    return "%.${decimals}f %s".format(java.util.Locale.ROOT, value, units[unit])
}

@Composable
private fun FolderFiltersSheet(url: FolderUrlState, holder: FolderStateHolder) {
    var search by remember(url.q) { mutableStateOf(url.q) }
    LaunchedEffect(search) {
        if (search.trim() != url.q) {
            kotlinx.coroutines.delay(300)
            holder.setQuery(search)
        }
    }
    PlayarrFiltersSheet(
        title = playarrString(PlayarrString.LibraryFilters),
        kicker = playarrString(PlayarrString.FoldersTitle),
        closeLabel = playarrString(PlayarrString.LibraryCloseFilters),
        onClose = { holder.openPanel(null) },
    ) {
        PlayarrFilterSection(playarrString(PlayarrString.FoldersSearch)) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                singleLine = true,
                placeholder = { Text(playarrString(PlayarrString.FoldersSearchPlaceholder)) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        PlayarrFilterSection(playarrString(PlayarrString.FoldersShow)) {
            PlayarrViewToggle(
                options = listOf(
                    FolderType.All to playarrString(PlayarrString.FoldersTypeAll),
                    FolderType.Directories to playarrString(PlayarrString.FoldersTypeDirectories),
                    FolderType.Media to playarrString(PlayarrString.FoldersTypeMedia),
                ),
                value = url.type,
                onChange = holder::setType,
            )
        }
        PlayarrFilterSection(playarrString(PlayarrString.FoldersView)) {
            PlayarrViewToggle(
                options = listOf(
                    FolderViewMode.Cover to playarrString(PlayarrString.FoldersViewCover),
                    FolderViewMode.List to playarrString(PlayarrString.FoldersViewList),
                ),
                value = url.view,
                onChange = holder::setView,
            )
        }
        if (url.view == FolderViewMode.Cover) {
            PlayarrFilterSection(playarrString(PlayarrString.FoldersSize)) {
                PlayarrViewToggle(
                    options = listOf(
                        FolderSize.Small to playarrString(PlayarrString.FoldersSizeSmall),
                        FolderSize.Medium to playarrString(PlayarrString.FoldersSizeMedium),
                        FolderSize.Large to playarrString(PlayarrString.FoldersSizeLarge),
                    ),
                    value = url.size,
                    onChange = holder::setSize,
                )
            }
        }
        PlayarrFilterSection(playarrString(PlayarrString.FoldersSortBy)) {
            PlayarrViewToggle(
                options = listOf(
                    FolderSort.Name to playarrString(PlayarrString.FoldersSortName),
                    FolderSort.Modified to playarrString(PlayarrString.FoldersSortModified),
                    FolderSort.Size to playarrString(PlayarrString.FoldersSortSize),
                    FolderSort.Duration to playarrString(PlayarrString.FoldersSortDuration),
                ),
                value = url.sort,
                onChange = holder::setSort,
            )
        }
        PlayarrFilterSection(playarrString(PlayarrString.FoldersOrder)) {
            PlayarrViewToggle(
                options = listOf(
                    FolderOrder.Asc to playarrString(PlayarrString.FoldersOrderAsc),
                    FolderOrder.Desc to playarrString(PlayarrString.FoldersOrderDesc),
                ),
                value = url.order,
                onChange = holder::setOrder,
            )
        }
        if (url.activeFilterCount > 0) {
            PlayarrChoice(playarrString(PlayarrString.FoldersClearFilters), false, holder::clearFilters)
        }
    }
}
