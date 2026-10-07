package io.playarr.shared.auth

import io.playarr.shared.auth.model.DevicePollResult
import io.playarr.shared.auth.model.HostedLinkClaim
import io.playarr.shared.auth.model.HostedLinkCodeResponse
import io.playarr.shared.auth.model.HostedLinkPollResult
import io.playarr.shared.auth.model.TokenResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QrPairingFlowTest {
    private var now = 0L
    private val waits = mutableListOf<Long>()
    private var codes = 0
    private val claim = HostedLinkClaim("http://server.example:8484", "server-secret", listOf("http://server.example:8484"))
    private val token = TokenResponse("access", "refresh", "Bearer", 900)

    private fun code(n: Int) = HostedLinkCodeResponse("dev-$n", "CODE-000$n", "https://example.com/link", "https://example.com/link?c=$n", 300, 5)

    private fun flow(
        request: suspend () -> HostedLinkCodeResponse = { code(++codes) },
        hosted: (HostedLinkCodeResponse) -> Flow<HostedLinkPollResult>,
        server: (String) -> Flow<DevicePollResult> = { flowOf(DevicePollResult.Approved(token)) },
        prepared: MutableList<HostedLinkClaim> = mutableListOf(),
    ) = QrPairingFlow(
        requestCode = request,
        pollHosted = hosted,
        prepareServer = { prepared += it },
        pollServer = server,
        wait = { waits += it; now += it },
        monotonicTimeMillis = { now },
    )

    @Test
    fun `approval links straight away`() = runBlocking {
        val updates = flow(hosted = { flowOf(HostedLinkPollResult.AuthorizationPending, HostedLinkPollResult.Approved(claim)) }).run().toList()
        assertEquals(
            listOf(QrPairingUpdate.Requesting, QrPairingUpdate.ShowCode(code(1)), QrPairingUpdate.Linked(claim, token)),
            updates,
        )
    }

    @Test
    fun `expired hosted code silently shows a fresh code and keeps polling`() = runBlocking {
        var polls = 0
        val updates = flow(hosted = {
            polls += 1
            if (polls < 3) flowOf(HostedLinkPollResult.Expired) else flowOf(HostedLinkPollResult.Approved(claim))
        }).run().toList()
        assertEquals(listOf(code(1), code(2), code(3)), updates.filterIsInstance<QrPairingUpdate.ShowCode>().map { it.code })
        assertTrue(updates.last() is QrPairingUpdate.Linked)
        assertTrue(updates.none { it is QrPairingUpdate.Declined })
    }

    @Test
    fun `expired server device code restarts pairing instead of failing`() = runBlocking {
        var serverPolls = 0
        val prepared = mutableListOf<HostedLinkClaim>()
        val updates = flow(
            hosted = { flowOf(HostedLinkPollResult.Approved(claim)) },
            server = {
                serverPolls += 1
                if (serverPolls == 1) flowOf(DevicePollResult.Expired) else flowOf(DevicePollResult.Approved(token))
            },
            prepared = prepared,
        ).run().toList()
        assertEquals(2, updates.count { it is QrPairingUpdate.ShowCode })
        assertEquals(QrPairingUpdate.Linked(claim, token), updates.last())
        assertEquals(2, prepared.size)
    }

    @Test
    fun `denied is the only terminal failure`() = runBlocking {
        val updates = flow(
            hosted = { flowOf(HostedLinkPollResult.Approved(claim)) },
            server = { flowOf(DevicePollResult.Denied) },
        ).run().toList()
        assertEquals(QrPairingUpdate.Declined, updates.last())
    }

    @Test
    fun `network blip while requesting retries with backoff and no error`() = runBlocking {
        var attempts = 0
        val updates = flow(
            request = { if (++attempts <= 3) throw java.io.IOException("offline") else code(1) },
            hosted = { flowOf(HostedLinkPollResult.Approved(claim)) },
        ).run().toList()
        assertEquals(listOf(2_000L, 4_000L, 8_000L), waits)
        assertEquals(QrPairingUpdate.Linked(claim, token), updates.last())
    }

    @Test
    fun `backoff is capped at thirty seconds`() = runBlocking {
        var attempts = 0
        flow(
            request = { if (++attempts <= 9) throw java.io.IOException("offline") else code(1) },
            hosted = { flowOf(HostedLinkPollResult.Approved(claim)) },
        ).run().toList()
        assertEquals(30_000L, waits.max())
        assertEquals(9, waits.size)
    }

    @Test
    fun `poll blip keeps the same code and resumes`() = runBlocking {
        var polls = 0
        val seen = mutableListOf<Long>()
        val updates = flow(hosted = {
            polls += 1
            seen += it.expiresIn
            if (polls == 1) flowOf(HostedLinkPollResult.Failed("offline")) else flowOf(HostedLinkPollResult.Approved(claim))
        }).run().toList()
        assertEquals(1, updates.count { it is QrPairingUpdate.ShowCode })
        assertEquals(2_000L, waits.single())
        assertEquals(listOf(300L, 298L), seen)
    }

    @Test
    fun `server poll blip retries redemption without a new code`() = runBlocking {
        var serverPolls = 0
        val updates = flow(
            hosted = { flowOf(HostedLinkPollResult.Approved(claim)) },
            server = {
                serverPolls += 1
                if (serverPolls == 1) flowOf(DevicePollResult.Failed("offline")) else flowOf(DevicePollResult.Approved(token))
            },
        ).run().toList()
        assertEquals(1, updates.count { it is QrPairingUpdate.ShowCode })
        assertTrue(updates.last() is QrPairingUpdate.Linked)
    }

    @Test
    fun `exceptions from polling are treated as blips`() = runBlocking {
        var polls = 0
        val updates = flow(hosted = {
            polls += 1
            if (polls == 1) flow { throw java.io.IOException("reset") } else flowOf(HostedLinkPollResult.Approved(claim))
        }).run().toList()
        assertTrue(updates.last() is QrPairingUpdate.Linked)
    }

    @Test
    fun `a hosted flow that ends without a result renews once the code lifetime has passed`() = runBlocking {
        var polls = 0
        val updates = flow(hosted = {
            polls += 1
            if (polls == 1) { now += 301_000; emptyFlow() } else flowOf(HostedLinkPollResult.Approved(claim))
        }).run().toList()
        assertEquals(2, updates.count { it is QrPairingUpdate.ShowCode })
    }
}
