package io.playarr.mobile.ui

import io.playarr.shared.data.model.FolderBreadcrumb
import io.playarr.shared.data.model.FolderBrowseResponse
import io.playarr.shared.data.model.FolderEntry
import io.playarr.shared.data.model.FolderRoot
import io.playarr.shared.domain.repository.FolderRepository
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val ROOT_A = "31b51f0d-e8f1-5ed1-bf63-a0cae6215685"
private const val ROOT_B = "11111111-1111-1111-1111-111111111111"

private fun root(id: String = ROOT_A, name: String = "Sample Unsorted") =
    FolderRoot(id = id, sourceName = "Sample Library", libraryKind = "movie", name = name, available = true, scanStatus = "ready", itemCount = 3)

private fun dir(path: String, count: Long = 2) = FolderEntry(entryType = "directory", name = path.substringAfterLast('/'), path = path, itemCount = count)

private fun media(path: String, durationMs: Long = 60_000, watchState: String? = null, positionMs: Long? = null) = FolderEntry(
    entryType = "media",
    name = path.substringAfterLast('/'),
    path = path,
    mediaFileId = "file-$path",
    title = path.substringAfterLast('/').substringBeforeLast('.'),
    durationMs = durationMs,
    watchState = watchState,
    positionMs = positionMs,
    thumbnailUrl = "/api/v1/media/file-$path/thumbnail?position_ms=20000",
)

private class FakeFolderRepository : FolderRepository {
    var roots: List<FolderRoot> = listOf(root())
    var listings: (String, String, String) -> List<FolderEntry> = { _, _, _ -> emptyList() }
    var failure: Throwable? = null
    var total: Long? = null
    val browses = mutableListOf<List<Any>>()

    override suspend fun roots(kind: String?): List<FolderRoot> {
        failure?.let { throw it }
        return roots
    }

    override suspend fun browse(rootId: String, path: String, query: String, sort: String, order: String, type: String, limit: Int, offset: Int): FolderBrowseResponse {
        browses += listOf(rootId, path, query, sort, order, type, limit, offset)
        failure?.let { throw it }
        val all = listings(rootId, path, query)
        val page = all.drop(offset).take(limit)
        return FolderBrowseResponse(
            root = roots.first { it.id == rootId },
            path = path,
            breadcrumbs = listOf(FolderBreadcrumb("Sample Unsorted", "")),
            entries = page,
            total = total ?: all.size.toLong(),
            offset = offset,
            limit = limit,
        )
    }
}

class PlayarrFoldersTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val message: (io.playarr.shared.domain.model.PlayarrError) -> PlayarrMessage = { PlayarrMessage.Dynamic("failed") }

    private fun holder(repo: FolderRepository, initial: FolderUrlState = FolderUrlState()) =
        FolderStateHolder(scope, repo, initial, message)

    // ---- URL state ----------------------------------------------------------------------------------------------

    @Test
    fun `every field round trips through one query string with web parameter names`() {
        val query = "root=$ROOT_A&path=Season%20A%2FDeep&kind=movie&view=list&size=large&sort=modified&order=desc&q=clip&type=media&panel=filters"
        val state = parseFolderQuery(query)
        assertEquals(ROOT_A, state.root)
        assertEquals("Season A/Deep", state.path)
        assertEquals("movie", state.kind)
        assertEquals(FolderViewMode.List, state.view)
        assertEquals(FolderSize.Large, state.size)
        assertEquals(FolderSort.Modified, state.sort)
        assertEquals(FolderOrder.Desc, state.order)
        assertEquals("clip", state.q)
        assertEquals(FolderType.Media, state.type)
        assertEquals(FolderPanel.Filters, state.panel)
        assertEquals(2, state.activeFilterCount)
        assertEquals(query, state.toQuery())
        assertEquals(state, parseFolderQuery(state.toQuery()))
    }

    @Test
    fun `junk is ignored, paths cannot traverse and the default state encodes to nothing`() {
        val state = parseFolderQuery("root=nope&path=..%2Fx&view=cloud&sort=colour&order=up&type=files&kind=film&size=huge&panel=zzz")
        assertEquals(FolderUrlState(), state)
        assertEquals("", FolderUrlState().toQuery())
        assertEquals("", normaliseFolderPath("a\\b"))
        assertEquals("a/b/c", normaliseFolderPath("/a//b/./c/"))
        assertEquals("a/b", parentFolderPath("a/b/c"))
        assertEquals("", parentFolderPath("a"))
        assertEquals(listOf("a", "a/b", "a/b/c"), folderAncestors("a/b/c"))
    }

    // ---- State machine ------------------------------------------------------------------------------------------

    @Test
    fun `a single root opens on its own and lists its top level`() {
        val repo = FakeFolderRepository().apply { listings = { _, _, _ -> listOf(dir("Season A"), media("Sample Clip 01.mp4")) } }
        val holder = holder(repo)
        holder.loadRoots()
        val state = holder.state.value
        assertEquals(ROOT_A, state.url.root)
        val listing = state.listing as FolderListing.Ready
        assertEquals(listOf("Season A", "Sample Clip 01.mp4"), listing.entries.map { it.name })
        assertEquals(listOf(ROOT_A, "", "", "name", "asc", "all", FOLDER_PAGE_SIZE, 0), repo.browses.single())
    }

    @Test
    fun `several roots wait for a choice, and up goes from directory to root list`() {
        val repo = FakeFolderRepository().apply {
            roots = listOf(root(), root(ROOT_B, "Other"))
            listings = { _, path, _ -> if (path.isEmpty()) listOf(dir("Season A")) else listOf(media("Season A/Sample Clip 02.mp4")) }
        }
        val holder = holder(repo)
        holder.loadRoots()
        assertNull(holder.state.value.url.root)
        assertEquals(FolderListing.Idle, holder.state.value.listing)
        holder.openRoot(ROOT_B)
        holder.openDirectory("Season A")
        assertEquals("Season A", holder.state.value.url.path)
        assertTrue(holder.up(2))
        assertEquals("", holder.state.value.url.path)
        assertTrue(holder.up(2))
        assertNull(holder.state.value.url.root)
        assertFalse(holder.up(2))
    }

    @Test
    fun `filters refetch the directory, a new directory clears the search, view changes do not refetch`() {
        val repo = FakeFolderRepository().apply { listings = { _, _, q -> if (q.isEmpty()) listOf(dir("Season A"), media("a.mp4")) else listOf(media("a.mp4")) } }
        val holder = holder(repo)
        holder.loadRoots()
        val before = repo.browses.size
        holder.setView(FolderViewMode.List)
        holder.setSize(FolderSize.Large)
        assertEquals(before, repo.browses.size)
        holder.setQuery("  a  ")
        assertEquals("a", holder.state.value.url.q)
        assertEquals(listOf("a.mp4"), (holder.state.value.listing as FolderListing.Ready).entries.map { it.name })
        holder.setType(FolderType.Media)
        holder.setSort(FolderSort.Size)
        holder.setOrder(FolderOrder.Desc)
        assertEquals(listOf(ROOT_A, "", "a", "size", "desc", "media", FOLDER_PAGE_SIZE, 0), repo.browses.last())
        assertEquals(2, holder.state.value.url.activeFilterCount)
        holder.openDirectory("Season A")
        assertEquals("", holder.state.value.url.q)
        holder.clearFilters()
        assertEquals(FolderType.All, holder.state.value.url.type)
        assertEquals(FolderViewMode.List, holder.state.value.url.view)
    }

    @Test
    fun `paging appends without duplicating and stops when everything is loaded`() {
        val repo = FakeFolderRepository().apply {
            listings = { _, _, _ -> (1..250).map { media("clip-%03d.mp4".format(it)) } }
        }
        val holder = holder(repo)
        holder.loadRoots()
        val first = holder.state.value.listing as FolderListing.Ready
        assertEquals(FOLDER_PAGE_SIZE, first.entries.size)
        assertTrue(first.hasMore)
        holder.loadMore()
        val all = holder.state.value.listing as FolderListing.Ready
        assertEquals(250, all.entries.size)
        assertEquals(250, all.entries.map { it.path }.toSet().size)
        assertFalse(all.hasMore)
        val requests = repo.browses.size
        holder.loadMore()
        assertEquals(requests, repo.browses.size)
        assertEquals(2, mergeFolderPage(listOf(media("1")), listOf(media("1"), media("2"))).size)
    }

    @Test
    fun `a missing directory is reported, other failures are messages and refresh keeps what is shown`() {
        val repo = FakeFolderRepository().apply { listings = { _, _, _ -> listOf(media("a.mp4")) } }
        val holder = holder(repo)
        holder.loadRoots()
        repo.failure = IOException("offline")
        holder.refresh()
        assertEquals(listOf("a.mp4"), (holder.state.value.listing as FolderListing.Ready).entries.map { it.name })
        holder.openDirectory("Gone")
        assertTrue(holder.state.value.listing is FolderListing.Failed)
        val notFound = retrofit2.HttpException(retrofit2.Response.error<Any>(404, okhttp3.ResponseBody.create(null, "")))
        repo.failure = notFound
        holder.openDirectory("Gone2")
        assertEquals(FolderListing.Missing, holder.state.value.listing)
    }

    @Test
    fun `root failures surface and a retry recovers`() {
        val repo = FakeFolderRepository().apply { failure = IOException("offline") }
        val holder = holder(repo)
        holder.loadRoots()
        assertTrue(holder.state.value.roots is FolderRootsLoad.Failed)
        repo.failure = null
        holder.loadRoots()
        assertTrue(holder.state.value.roots is FolderRootsLoad.Ready)
    }

    // ---- Entries ------------------------------------------------------------------------------------------------

    @Test
    fun `entries expose progress, thumbnail position and the playable queue`() {
        val resumed = media("a.mp4", durationMs = 1000, watchState = "part_watched", positionMs = 250)
        assertEquals(0.25f, resumed.progress, 0.0001f)
        assertEquals(20_000L, resumed.thumbnailPositionMs)
        assertEquals(0f, media("b.mp4", watchState = "watched", positionMs = 60_000).progress, 0f)
        val queue = folderPlaybackQueue(listOf(dir("d"), resumed, media("c.mkv")))
        assertEquals(listOf("file-a.mp4", "file-c.mkv"), queue.map { it.mediaFileId })
        assertEquals(listOf("a", "c"), queue.map { it.title })
        assertEquals("1:05", formatFolderDuration(65_000))
        assertEquals("1:02:05", formatFolderDuration(3_725_000))
        assertEquals("", formatFolderDuration(null))
        assertEquals("2.00 KB", formatFolderSize(2048))
    }

    // ---- Shell wiring -------------------------------------------------------------------------------------------

    @Test
    fun `folders is a nav destination only once a root is available`() {
        val kinds = setOf(io.playarr.shared.data.model.WorkKind.Movie)
        assertFalse(visibleExperienceDestinations(kinds, canDownload = true).any { it.route == "folders" })
        assertTrue(visibleExperienceDestinations(kinds, canDownload = true, hasFolders = true).any { it.route == "folders" })
        val groups = televisionDestinationGroups(visibleExperienceDestinations(kinds, canDownload = true, hasFolders = true))
        assertTrue(groups.flatten().any { it.route == "folders" })
    }

    @Test
    fun `the folders screen renders through the shared scaffold and shared buttons`() {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory } ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        val text = File(dir, "PlayarrFolders.kt").readText()
        assertTrue(text.contains("PlayarrPageScaffold("))
        assertTrue(text.contains("PlayarrFiltersSheet("))
        assertFalse("raw Material buttons", Regex("""(^|[^A-Za-z.])(Button|OutlinedButton|TextButton|IconButton)\(""", RegexOption.MULTILINE).containsMatchIn(text))
    }
}
