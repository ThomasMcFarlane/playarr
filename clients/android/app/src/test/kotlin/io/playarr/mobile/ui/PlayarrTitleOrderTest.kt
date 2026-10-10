package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrTitleOrderTest {
    @Test
    fun `numbers compare by value and case is ignored, as the web collator`() {
        val titles = listOf("100 Sample", "Test Movie B", "2 Sample", "test movie a", "10,000 Sample", "9 Sample", "Écho")
        assertEquals(
            listOf("2 Sample", "9 Sample", "10,000 Sample", "100 Sample", "Écho", "test movie a", "Test Movie B"),
            titles.sortedWith(PlayarrTitleOrder),
        )
    }

    @Test
    fun `a prefix sorts first`() {
        assertEquals(listOf("Sample", "Sample 2"), listOf("Sample 2", "Sample").sortedWith(PlayarrTitleOrder))
    }
}
