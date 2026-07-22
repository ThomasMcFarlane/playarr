package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.WorkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrNavigationParityTest {
    private val allKinds = setOf(WorkKind.Series, WorkKind.Movie, WorkKind.Site, WorkKind.Artist)

    @Test
    fun `mobile destinations follow Playarr Web order and hide downloads until granted`() {
        assertEquals(
            listOf("search", "home", "series", "movies", "sites", "music", "playlists"),
            visibleExperienceDestinations(allKinds, canDownload = null).map(ExperienceDestination::route),
        )
        assertEquals(
            listOf("downloads", "search", "home", "series", "movies", "sites", "music", "playlists"),
            visibleExperienceDestinations(allKinds, canDownload = true).map(ExperienceDestination::route),
        )
        assertFalse(visibleExperienceDestinations(allKinds, canDownload = false).any { it.route == "downloads" })
    }

    @Test
    fun `television grouping retains every visible destination`() {
        val visible = visibleExperienceDestinations(allKinds, canDownload = true)
        val groups = televisionDestinationGroups(visible)

        assertEquals(listOf("downloads", "search"), groups.first().map(ExperienceDestination::route))
        assertEquals(visible.map(ExperienceDestination::route).toSet(), groups.flatten().map(ExperienceDestination::route).toSet())
        assertEquals(visible.size, groups.sumOf(List<ExperienceDestination>::size))
        assertTrue(groups.last().single().route == "playlists")
    }

    @Test
    fun `profile transitions restore top-level and nested routes`() {
        assertEquals("search", restorableExperienceRoute("search"))
        assertEquals(
            "experience-detail/work%2Fone?mediaFileId=media%20one",
            restorableExperienceRoute(
                route = "experience-detail/{workId}?mediaFileId={mediaFileId}",
                workId = "work/one",
                mediaFileId = "media one",
            ),
        )
        assertEquals(
            "playlists/list%2Fone",
            restorableExperienceRoute("playlists/{playlistId}", playlistId = "list/one"),
        )
    }

    @Test
    fun `profile and player routes retain the previous return destination`() {
        assertEquals(null, restorableExperienceRoute("profiles"))
        assertEquals(null, restorableExperienceRoute("experience-player/{mediaFileId}", mediaFileId = "media"))
    }
}
