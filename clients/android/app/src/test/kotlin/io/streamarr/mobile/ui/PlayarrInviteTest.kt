package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.PeerAddressEntry
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrInviteTest {
    @Test
    fun `single server invite uses plural servers parameter`() {
        val entry = PeerAddressEntry("11111111-1111-4111-8111-111111111111", "https://streamarr.example.com")
        val uri = URI(buildPlayarrInviteUrl(listOf(entry), "one-use-token"))
        val query = queryParameters(uri.rawQuery)

        assertEquals("https://playarr.app/signup", "${uri.scheme}://${uri.authority}${uri.path}")
        assertEquals("one-use-token", query.getValue("invite"))
        assertFalse(query.containsKey("server"))
        assertEquals(listOf(entry), decodeAddresses(query.getValue("servers")))
    }

    @Test
    fun `multi server invite preserves order and attribution`() {
        val addresses = listOf(
            PeerAddressEntry("node-a", "https://home.example.com"),
            PeerAddressEntry("node-b", "http://192.168.1.5:8484"),
        )
        val servers = queryParameters(URI(buildPlayarrInviteUrl(addresses, "token")).rawQuery).getValue("servers")

        assertTrue(servers.matches(Regex("^[A-Za-z0-9_-]+$")))
        assertEquals(addresses, decodeAddresses(servers))
    }

    @Test
    fun `empty bundle falls back to the connected server`() {
        assertEquals(
            listOf(PeerAddressEntry("", "https://connected.example.com")),
            playarrInviteAddresses(emptyList(), "https://connected.example.com"),
        )
    }

    private fun queryParameters(query: String): Map<String, String> = query.split('&').associate { pair ->
        val (key, value) = pair.split('=', limit = 2)
        key to URLDecoder.decode(value, StandardCharsets.UTF_8.toString())
    }

    private fun decodeAddresses(value: String): List<PeerAddressEntry> {
        val json = Base64.getUrlDecoder().decode(value).toString(StandardCharsets.UTF_8)
        return Json.decodeFromString(ListSerializer(PeerAddressEntry.serializer()), json)
    }
}
