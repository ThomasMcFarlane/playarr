package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrProgressGuardTest {
    @Test
    fun `closing mid-buffer before playback started never writes progress`() {
        assertFalse(shouldPersistPlayarrProgress(0L, playbackReached = false, sourceSwitching = false, completed = false))
        assertFalse(shouldPersistPlayarrProgress(12_000L, playbackReached = false, sourceSwitching = false, completed = false))
    }

    @Test
    fun `a session that played writes its position`() {
        assertTrue(shouldPersistPlayarrProgress(518_000L, playbackReached = true, sourceSwitching = false, completed = false))
    }

    @Test
    fun `a source switch that has not landed does not write zero`() {
        assertFalse(shouldPersistPlayarrProgress(0L, playbackReached = true, sourceSwitching = true, completed = false))
    }

    @Test
    fun `completion always writes`() {
        assertTrue(shouldPersistPlayarrProgress(0L, playbackReached = false, sourceSwitching = false, completed = true))
    }

    @Test
    fun `view model gates persistProgress on the guard and marks playback reached`() {
        val source = File("src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
        val persist = source.substringAfter("fun persistProgress(").substringBefore("fun checkpoint()")
        assertTrue(persist.contains("shouldPersistPlayarrProgress("))
        assertTrue(source.contains("playbackReached = true"))
        assertTrue(source.contains("playbackReached = false"))
    }
}
