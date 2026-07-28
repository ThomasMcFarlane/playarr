package io.playarr.shared.data.remote

import io.playarr.shared.data.model.AlbumDetail
import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.CatalogPage
import io.playarr.shared.data.model.ClientPlatform
import io.playarr.shared.data.model.ExternalProvider
import io.playarr.shared.data.model.MediaChapter
import io.playarr.shared.data.model.MediaPlaybackOptionsResponse
import io.playarr.shared.data.model.PeerAddressBundle
import io.playarr.shared.data.model.PlaybackMode
import io.playarr.shared.data.model.PlaybackInfoResponse
import io.playarr.shared.data.model.OptionalUserInviteRequest
import io.playarr.shared.data.model.AvailableProfile
import io.playarr.shared.data.model.Playlist
import io.playarr.shared.data.model.PlaylistItem
import io.playarr.shared.data.model.PlaylistMediaType
import io.playarr.shared.data.model.SelfCapabilitiesResponse
import io.playarr.shared.data.model.SearchResponse
import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.WatchState
import io.playarr.shared.data.model.ViewSummary
import io.playarr.shared.data.model.VersionEnvelope
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkCreditsResponse
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes literal snake_case JSON shaped exactly like
 * `backend/openapi/playarr.yaml`'s schemas (not just symmetric
 * encode-then-decode round trips) through [PlayarrHttpClient.json], so a
 * mistake in [io.playarr.shared.data.remote] `wireName()`/naming-strategy
 * plumbing, or in a hand-rolled `KSerializer`, fails here instead of only
 * against a live server this task can't run.
 */
class PlayarrJsonModelTest {

    private val json = PlayarrHttpClient.json

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
              "release_date": "1999-03-31T00:00:00Z",
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
        assertEquals(1999, work.releaseDate?.atZone(java.time.ZoneOffset.UTC)?.year)
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
    fun `decodes the search response object while ignoring remote only results like Web`() {
        val response = json.decodeFromString(
            SearchResponse.serializer(),
            """
            {
              "items": [{
                "id": "movie-1", "kind": "movie", "external_refs": [],
                "title": "Midnight Signal", "sort_title": "Midnight Signal",
                "images": [], "genres": [], "tags": [],
                "added_at": "2026-01-01T00:00:00Z", "monitored": true,
                "availability": "available"
              }],
              "remote_only": [{"origin_peer_id": "peer-1", "work": {"id": "remote-1"}}]
            }
            """.trimIndent(),
        )

        assertEquals(listOf("movie-1"), response.items.map(Work::id))
    }

    @Test
    fun `decodes public view summaries`() {
        val view = json.decodeFromString(
            ViewSummary.serializer(),
            """{"id":"view-1","name":"Recently Added","is_default":true,"default_order":0}""",
        )

        assertEquals("Recently Added", view.name)
        assertTrue(view.isDefault)
        assertEquals(0, view.defaultOrder)
    }

    @Test
    fun `decodes playback source tracks used by native player defaults`() {
        val playback = json.decodeFromString(
            PlaybackInfoResponse.serializer(),
            """
            {
              "mode": "direct",
              "url": "/api/v1/media/mf-1/stream?playback_session_id=s1",
              "session_id": "s1",
              "mime_type": "video/mp4",
              "duration_ms": 7200000,
              "source_offset_ms": 1200000,
              "audio_tracks": [{
                "id": "source-audio-2", "stream_index": 2, "label": "English 5.1",
                "language": "eng", "codec": "ac3", "channels": 6, "is_default": true
              }],
              "selected_audio_track_id": "source-audio-2",
              "subtitle_tracks": [{
                "id": "source-subtitle-3", "stream_index": 3, "label": "English forced",
                "language": "eng", "codec": "subrip", "is_default": false, "forced": true,
                "url": "/api/v1/media/mf-1/subtitles/3?source_offset_ms=0"
              }],
              "selected_subtitle_track_id": null,
              "selected_quality_id": "original",
              "quality_options": [
                {"id":"original","label":"Original","profile":null,"height":null,"video_bitrate_bps":null},
                {"id":"h264-1080p-8mbps","label":"1080p · 8 Mbps","profile":"h264-1080p-8mbps","height":1080,"video_bitrate_bps":8000000}
              ]
            }
            """.trimIndent(),
        )

        assertEquals("source-audio-2", playback.selectedAudioTrackId)
        assertEquals("s1", playback.sessionId)
        assertEquals(7_200_000L, playback.durationMs)
        assertEquals(1_200_000L, playback.sourceOffsetMs)
        assertEquals("h264-1080p-8mbps", playback.qualityOptions.last().profile)
        assertEquals(8_000_000L, playback.qualityOptions.last().videoBitrateBps)
        assertEquals("eng", playback.audioTracks.single().language)
        assertTrue(playback.subtitleTracks.single().forced)
        assertEquals("/api/v1/media/mf-1/subtitles/3?source_offset_ms=0", playback.subtitleTracks.single().url)
    }

    @Test
    fun `decodes rich media detail contracts used by the web detail page`() {
        val credits = json.decodeFromString(
            WorkCreditsResponse.serializer(),
            """
            {
              "cast": [{
                "id": "credit-1",
                "person": {"id": "person-1", "name": "Lead Actor", "headshot_url": "https://example.com/headshot.jpg"},
                "character": "The Lead",
                "department": null,
                "job": null
              }],
              "crew": []
            }
            """.trimIndent(),
        )
        val chapters = json.decodeFromString(
            kotlinx.serialization.builtins.ListSerializer(MediaChapter.serializer()),
            """[{"index":0,"start_ms":0,"end_ms":65432,"title":"Opening Titles"}]""",
        )
        val options = json.decodeFromString(
            MediaPlaybackOptionsResponse.serializer(),
            """
            {
              "quality_options": [{"id":"original","label":"Original"}],
              "audio_tracks": [{"id":"source-audio-1","stream_index":1,"label":"English","is_default":true}],
              "subtitle_tracks": [{
                "id":"source-subtitle-3","stream_index":3,"label":"English SDH","codec":"subrip",
                "is_default":true,"forced":false,"url":"/api/v1/media/mf-1/subtitles/3"
              }],
              "preferences": {"quality_id":"original","audio_track_id":"source-audio-1","subtitle_track_id":null}
            }
            """.trimIndent(),
        )

        assertEquals("Lead Actor", credits.cast.single().person.name)
        assertEquals("The Lead", credits.cast.single().character)
        assertEquals(65_432L, chapters.single().endMs)
        assertEquals("source-audio-1", options.preferences.audioTrackId)
        assertEquals("source-subtitle-3", options.subtitleTracks.single().id)
    }

    @Test
    fun `decodes peer address bundle used by invite links`() {
        val bundle = json.decodeFromString(
            PeerAddressBundle.serializer(),
            """
            {
              "group_id": "11111111-1111-4111-8111-111111111111",
              "group_name": "Home Group",
              "addresses": [
                {"peer_node_id":"node-a","url":"https://home.example.com"},
                {"peer_node_id":"node-b","url":"http://192.168.1.5:8484"}
              ]
            }
            """.trimIndent(),
        )

        assertEquals("Home Group", bundle.groupName)
        assertEquals(listOf("node-a", "node-b"), bundle.addresses.map { it.peerNodeId })
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

    @Test
    fun `decodes watch progress and clamps the rendered fraction`() {
        val progress = json.decodeFromString(
            WatchProgress.serializer(),
            """{"media_file_id":"mf-1","work_id":"w1","position_ms":125000,"duration_ms":100000,"state":"part_watched","updated_at":"2026-07-19T00:00:00Z"}""",
        )

        assertEquals(WatchState.PartWatched, progress.state)
        assertEquals(1f, progress.fraction)
    }

    @Test
    fun `decodes playlist directory and item contracts`() {
        val playlist = json.decodeFromString(
            Playlist.serializer(),
            """{"id":"p1","name":"Friday","is_system":false,"media_type":"video","created_at":"2026-07-19T00:00:00Z","updated_at":"2026-07-19T00:00:00Z","owner_user_id":"u1"}""",
        )
        val item = json.decodeFromString(
            PlaylistItem.serializer(),
            """{"id":"i1","playlist_id":"p1","work_id":"w1","track_id":"e1","position":0,"added_at":"2026-07-19T00:00:00Z"}""",
        )

        assertEquals(PlaylistMediaType.Video, playlist.mediaType)
        assertEquals("e1", item.trackId)
    }

    @Test
    fun `decodes profile picker access state`() {
        val profile = json.decodeFromString(
            AvailableProfile.serializer(),
            """{"id":"u2","username":"guest","display_name":"Guest","is_current":false,"pin_locked":true}""",
        )

        assertEquals("Guest", profile.displayName)
        assertTrue(profile.pinLocked)
    }

    @Test
    fun `decodes the signed in users download capability`() {
        val capabilities = json.decodeFromString(
            SelfCapabilitiesResponse.serializer(),
            """{"can_download":true}""",
        )

        assertTrue(capabilities.canDownload)
    }

    @Test
    fun `decodes the server instance name from the version envelope`() {
        val version = json.decodeFromString(
            VersionEnvelope.serializer(),
            """{"instance_name":"Living Room","server_version":"0.1.0","api_version":"v1","compatibility":[]}""",
        )

        assertEquals("Living Room", version.instanceName)
    }

    @Test
    fun `decodes a compatibility row for every ClientPlatform wire name without throwing`() {
        // Every wire name this closed enum knows about except playarr-admin,
        // which identifies the admin UI rather than a Playarr client and so
        // never appears in a compatibility row. A future platform added to
        // the server's enum but not this one would make this decode throw
        // SerializationException instead of silently dropping the row.
        val wireNames = listOf(
            "android-mobile", "android-tv", "ios", "web",
            "tv-webos", "tv-tizen", "tv-vidaa", "tv-fire", "xbox",
        )
        val compatibilityJson = wireNames.joinToString(",") { wireName ->
            """{"platform":"$wireName","latest_version":"1.0.0","min_supported_version":"1.0.0"}"""
        }
        val version = json.decodeFromString(
            VersionEnvelope.serializer(),
            """{"instance_name":"Living Room","server_version":"0.1.0","api_version":"v1","compatibility":[$compatibilityJson]}""",
        )

        assertEquals(wireNames.size, version.compatibility.size)
        assertEquals(
            setOf(
                ClientPlatform.AndroidMobile, ClientPlatform.AndroidTv, ClientPlatform.Ios, ClientPlatform.Web,
                ClientPlatform.TvWebos, ClientPlatform.TvTizen, ClientPlatform.TvVidaa, ClientPlatform.TvFire, ClientPlatform.Xbox,
            ),
            version.compatibility.map { it.platform }.toSet(),
        )
    }

    @Test
    fun `decodes a missing invite request from literal json null`() {
        val response = json.decodeFromString(OptionalUserInviteRequest.serializer(), "null")

        assertEquals(null, response.value)
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
