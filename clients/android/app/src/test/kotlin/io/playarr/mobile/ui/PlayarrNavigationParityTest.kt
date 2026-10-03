package io.playarr.mobile.ui

import io.playarr.shared.data.model.WorkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrNavigationParityTest {
    private val allKinds = setOf(WorkKind.Series, WorkKind.Movie, WorkKind.Site, WorkKind.Artist)

    @Test
    fun `mobile destinations wait for catalogue access and hide downloads until granted`() {
        assertTrue(visibleExperienceDestinations(availableKinds = null, canDownload = true).isEmpty())
        assertEquals(
            listOf("search", "home", "series", "movies", "sites", "music", "calendar", "playlists", "watchlist"),
            visibleExperienceDestinations(allKinds, canDownload = null).map(ExperienceDestination::route),
        )
        assertEquals(
            listOf("downloads", "search", "home", "series", "movies", "sites", "music", "calendar", "playlists", "watchlist"),
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
        assertEquals(listOf("playlists", "watchlist"), groups.last().map { it.route })
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
