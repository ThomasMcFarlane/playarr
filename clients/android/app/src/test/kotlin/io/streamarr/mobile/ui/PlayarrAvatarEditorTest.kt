package io.streamarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrAvatarEditorTest {
    @Test
    fun `landscape image uses the same centered cover crop as web`() {
        val rect = playarrAvatarDrawRect(1_000, 500, PlayarrAvatarCrop(), 512)

        assertEquals(-256f, rect.x, 0.001f)
        assertEquals(0f, rect.y, 0.001f)
        assertEquals(1_024f, rect.width, 0.001f)
        assertEquals(512f, rect.height, 0.001f)
    }

    @Test
    fun `zoom and offsets use the web bounded pan range`() {
        val rect = playarrAvatarDrawRect(
            imageWidth = 1_000,
            imageHeight = 500,
            crop = PlayarrAvatarCrop(zoom = 2f, offsetX = 1f, offsetY = -1f),
            size = 512,
        )

        assertEquals(0f, rect.x, 0.001f)
        assertEquals(-512f, rect.y, 0.001f)
        assertEquals(2_048f, rect.width, 0.001f)
        assertEquals(1_024f, rect.height, 0.001f)
    }

    @Test
    fun `crop inputs clamp to web limits`() {
        val expected = playarrAvatarDrawRect(500, 1_000, PlayarrAvatarCrop(3f, -1f, 1f), 512)
        val clamped = playarrAvatarDrawRect(500, 1_000, PlayarrAvatarCrop(8f, -4f, 9f), 512)

        assertEquals(expected, clamped)
    }
}
