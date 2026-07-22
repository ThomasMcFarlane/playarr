package io.streamarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPlaybackQueueTest {
    @Test
    fun `queue retains ordered context and moves within its boundaries`() {
        val queue = playarrPlaybackQueue("second", listOf("first", "second", "third"))

        assertTrue(queue.canPrevious)
        assertTrue(queue.canNext)
        assertEquals("first", queue.move(-1).currentMediaFileId)
        assertEquals("third", queue.move(1).currentMediaFileId)
        assertEquals("first", queue.move(-10).currentMediaFileId)
        assertEquals("third", queue.move(10).currentMediaFileId)
    }

    @Test
    fun `standalone playback creates a one item queue`() {
        val queue = playarrPlaybackQueue("only", emptyList())

        assertEquals("only", queue.currentMediaFileId)
        assertFalse(queue.canPrevious)
        assertFalse(queue.canNext)
    }
}
