package io.streamarr.shared.download

import androidx.media3.exoplayer.offline.Download
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadStateMappingTest {

    @Test
    fun `queued and restarting both map to Queued`() {
        assertEquals(DownloadState.Queued, Download.STATE_QUEUED.toDownloadState())
        assertEquals(DownloadState.Queued, Download.STATE_RESTARTING.toDownloadState())
    }

    @Test
    fun `stopped maps to Paused`() {
        assertEquals(DownloadState.Paused, Download.STATE_STOPPED.toDownloadState())
    }

    @Test
    fun `downloading completed failed and removing map one-to-one`() {
        assertEquals(DownloadState.Downloading, Download.STATE_DOWNLOADING.toDownloadState())
        assertEquals(DownloadState.Completed, Download.STATE_COMPLETED.toDownloadState())
        assertEquals(DownloadState.Failed, Download.STATE_FAILED.toDownloadState())
        assertEquals(DownloadState.Removing, Download.STATE_REMOVING.toDownloadState())
    }

    @Test
    fun `an unrecognised state value falls back to Queued rather than throwing`() {
        assertEquals(DownloadState.Queued, Int.MAX_VALUE.toDownloadState())
    }
}
