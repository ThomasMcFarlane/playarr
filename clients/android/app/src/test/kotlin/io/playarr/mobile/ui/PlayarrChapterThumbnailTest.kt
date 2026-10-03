package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrChapterThumbnailTest {
    @Test
    fun thumbnailUrlOmitsPositionWhenNotRequested() {
        assertEquals(
            "https://s.example/api/v1/media/m1/thumbnail",
            playarrMediaThumbnailUrl("https://s.example/", "m1"),
        )
    }

    @Test
    fun thumbnailUrlCarriesChapterOffsetAsPositionMs() {
        assertEquals(
            "https://s.example/api/v1/media/m%201/thumbnail?position_ms=900000",
            playarrMediaThumbnailUrl("https://s.example", "m 1", 900_000L),
        )
    }

    @Test
    fun negativeOffsetsClampToZero() {
        assertEquals(
            "https://s.example/api/v1/media/m1/thumbnail?position_ms=0",
            playarrMediaThumbnailUrl("https://s.example", "m1", -5L),
        )
    }
}

class PlayarrEpisodeArtworkUrlTest {
    @Test
    fun episodeStillUrlEncodesIdsAndTrimsServerSlash() {
        assertEquals(
            "https://s.example/api/v1/artwork/episode/a%20b/e1/thumb",
            resolveEpisodeArtworkUrl("https://s.example/", "a b", "e1"),
        )
    }
}
