package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.AlbumDetail
import io.streamarr.shared.data.model.Availability
import io.streamarr.shared.data.model.CatalogPage
import io.streamarr.shared.data.model.ExternalProvider
import io.streamarr.shared.data.model.PlaybackMode
import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes literal snake_case JSON shaped exactly like
 * `backend/openapi/streamarr.yaml`'s schemas (not just symmetric
 * encode-then-decode round trips) through [StreamarrHttpClient.json], so a
 * mistake in [io.streamarr.shared.data.remote] `wireName()`/naming-strategy
 * plumbing, or in a hand-rolled `KSerializer`, fails here instead of only
 * against a live server this task can't run.
 */
class StreamarrJsonModelTest {

    private val json = StreamarrHttpClient.json

    @Test
    fun `decodes a Work with snake_case fields via the naming strategy, not explicit SerialName`() {
        val work = json.decodeFromString(
            Work.serializer(),
            """
            {
              "id": "11111111-1111-1111-1111-111111111111",
              "kind": "movie",
              "external_refs": [{"provider": "tmdb", "external_id": "603"}],
              "title": "Sample Movie Kilo",
              "sort_title": "Matrix, The",
              "overview": "A hacker learns the truth.",
              "images": [{"kind": "poster", "url": "https://example.com/poster.jpg", "width": 500, "height": 750}],
              "genres": ["Action", "Sci-Fi"],
              "tags": [],
              "added_at": "2026-01-01T00:00:00Z",
              "monitored": true,
              "availability": "available"
            }
            """.trimIndent(),
        )

        assertEquals("Matrix, The", work.sortTitle)
        assertEquals(WorkKind.Movie, work.kind)
        assertEquals(Availability.Available, work.availability)
        assertEquals(ExternalProvider.Tmdb, work.externalRefs.single().provider)
        assertEquals("603", work.externalRefs.single().externalId)
    }

    @Test
    fun `decodes an Other ExternalProvider as a single-key object`() {
        val work = json.decodeFromString(
            Work.serializer(),
            """
            {
              "id": "1", "kind": "author", "external_refs": [{"provider": {"other": "anidb"}, "external_id": "42"}],
              "title": "t", "sort_title": "t", "images": [], "genres": [], "tags": [],
              "added_at": "2026-01-01T00:00:00Z", "monitored": false, "availability": "unknown"
            }
            """.trimIndent(),
        )
        val provider = work.externalRefs.single().provider
        assertTrue(provider is ExternalProvider.Other)
        assertEquals("anidb", (provider as ExternalProvider.Other).name)
    }

    @Test
    fun `decodes site works and TPDB references used by the Playarr navigation`() {
        val work = json.decodeFromString(
            Work.serializer(),
            """
            {
              "id": "site-1", "kind": "site", "external_refs": [{"provider": "tpdb", "external_id": "42"}],
              "title": "Site title", "sort_title": "Site title", "images": [], "genres": [], "tags": [],
              "added_at": "2026-01-01T00:00:00Z", "monitored": true, "availability": "available"
            }
            """.trimIndent(),
        )

        assertEquals(WorkKind.Site, work.kind)
        assertEquals(ExternalProvider.Tpdb, work.externalRefs.single().provider)
    }

    @Test
    fun `decodes CatalogPage`() {
        val page = json.decodeFromString(
            CatalogPage.serializer(),
            """{"items": [], "total": 0}""",
        )
        assertTrue(page.items.isEmpty())
        assertEquals(0L, page.total)
    }

    @Test
    fun `decodes WorkDetail with WorkChildren Movie as a bare string`() {
        val detail = json.decodeFromString(workDetailSerializer, """{"work": $movieWorkJson, "children": "Movie"}""")
        assertEquals(WorkChildren.Movie, detail.children)
        assertEquals(null, detail.mediaFileId)
    }

    @Test
    fun `decodes WorkDetail's media_file_id for a movie's own resolved leaf`() {
        val detail = json.decodeFromString(
            workDetailSerializer,
            """{"work": $movieWorkJson, "children": "Movie", "media_file_id": "mf-1"}""",
        )
        assertEquals("mf-1", detail.mediaFileId)
    }

    @Test
    fun `decodes WorkDetail with WorkChildren Series as a single-key object of SeasonDetailSchema, each episode wrapped with its own media_file_id`() {
        val detail = json.decodeFromString(
            workDetailSerializer,
            """
            {
              "work": $movieWorkJson,
              "children": {
                "Series": [
                  {
                    "season": {"id": "s1", "series_work_id": "w1", "season_number": 1, "monitored": true, "availability": "available"},
                    "episodes": [
                      {
                        "episode": {"id": "e1", "season_id": "s1", "episode_number": 1, "title": "Pilot", "monitored": true, "availability": "available"},
                        "media_file_id": "mf-e1"
                      },
                      {
                        "episode": {"id": "e2", "season_id": "s1", "episode_number": 2, "title": "Second", "monitored": true, "availability": "pending"}
                      }
                    ]
                  }
                ]
              }
            }
            """.trimIndent(),
        )
        val children = detail.children
        assertTrue(children is WorkChildren.Series)
        children as WorkChildren.Series
        assertEquals(1, children.seasons.size)
        assertEquals(1, children.seasons.single().season.seasonNumber)
        val episodes = children.seasons.single().episodes
        assertEquals("Pilot", episodes[0].episode.title)
        assertEquals("mf-e1", episodes[0].mediaFileId)
        assertEquals("Second", episodes[1].episode.title)
        assertEquals(null, episodes[1].mediaFileId)
    }

    @Test
    fun `decodes WorkChildren Author as a list of BookDetailSchema, not a bare list of Book`() {
        val detail = json.decodeFromString(
            workDetailSerializer,
            """
            {
              "work": $movieWorkJson,
              "children": {
                "Author": [
                  {
                    "book": {"id": "b1", "author_work_id": "w1", "title": "Sample Title", "monitored": true, "availability": "available"},
                    "media_file_id": "mf-b1"
                  }
                ]
              }
            }
            """.trimIndent(),
        )
        val children = detail.children
        assertTrue(children is WorkChildren.Author)
        children as WorkChildren.Author
        assertEquals("Sample Title", children.books.single().book.title)
        assertEquals("mf-b1", children.books.single().mediaFileId)
    }

    @Test
    fun `decodes AlbumDetail tracks as TrackDetailSchema with a nullable media_file_id`() {
        val albumDetail = json.decodeFromString(
            AlbumDetail.serializer(),
            """
            {
              "album": {"id": "al1", "artist_work_id": "w1", "title": "Sample Album", "album_type": "studio", "monitored": true, "availability": "available"},
              "tracks": [
                {
                  "track": {"id": "t1", "album_id": "al1", "disc_number": 1, "track_number": 1, "title": "Sample Track One", "availability": "available"},
                  "media_file_id": "mf-t1"
                }
              ]
            }
            """.trimIndent(),
        )
        assertEquals("Sample Track One", albumDetail.tracks.single().track.title)
        assertEquals("mf-t1", albumDetail.tracks.single().mediaFileId)
    }

    @Test
    fun `decodes PlaybackInfoResponse for both direct and hls modes`() {
        val direct = json.decodeFromString(PlaybackInfoResponse.serializer(), """{"mode": "direct", "url": "/stream/a"}""")
        assertEquals(PlaybackMode.Direct, direct.mode)

        val hls = json.decodeFromString(PlaybackInfoResponse.serializer(), """{"mode": "hls", "url": "/hls/a.m3u8"}""")
        assertEquals(PlaybackMode.Hls, hls.mode)
    }

    companion object {
        private val workDetailSerializer = WorkDetail.serializer()
        private val movieWorkJson = """
            {
              "id": "w1", "kind": "movie", "external_refs": [], "title": "t", "sort_title": "t",
              "images": [], "genres": [], "tags": [], "added_at": "2026-01-01T00:00:00Z",
              "monitored": true, "availability": "available"
            }
        """.trimIndent()
    }
}
