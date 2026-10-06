package io.playarr.mobile.ui

import java.io.IOException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrRemoteFailureTest {
    @Test
    fun `a network error on this phone is reported as no connection, not as a device failure`() {
        assertEquals(PlayarrString.RemoteNoConnection, remoteSendFailure(IOException("Network is unreachable")))
        assertEquals(PlayarrString.RemoteNoConnection, remoteSendFailure(UnknownHostException("host")))
    }

    @Test
    fun `any other failure stays the generic device failure`() {
        assertEquals(PlayarrString.RemoteFailed, remoteSendFailure(IllegalStateException("boom")))
    }

    @Test
    fun `the new remote messages are translated into every language`() {
        listOf(PlayarrString.RemoteNoConnection, PlayarrString.RemoteNoResponse).forEach { string ->
            assertEquals(false, string.english.isBlank() || string.thai.isBlank() || string.japanese.isBlank())
        }
    }
}
