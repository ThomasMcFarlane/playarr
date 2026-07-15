package io.streamarr.shared.data.remote

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.model.RequestTarget
import io.streamarr.shared.data.model.SubmitRequestBody
import io.streamarr.shared.data.model.WorkKind
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.Executors
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Exercises [StreamarrHttpClient.create]'s `Authorization` header scoping
 * against a real (if tiny) HTTP server -- `com.sun.net.httpserver.HttpServer`,
 * bundled with the JDK, needs no MockWebServer/mocking-library dependency --
 * rather than a live Streamarr backend, which this task's environment
 * can't run.
 */
class StreamarrHttpClientAuthTest {

    private lateinit var server: HttpServer

    // ConcurrentHashMap disallows null values, and a missing Authorization
    // header (the exact case under test) reads back as null -- a
    // synchronized plain HashMap tolerates that instead of throwing inside
    // the handler thread and truncating the response.
    private val capturedAuthHeaders = Collections.synchronizedMap(HashMap<String, String?>())

    @Before
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/v1/requests") { exchange ->
            val path = exchange.requestURI.path
            val key = if (path.endsWith("/approve")) "approve" else if (path.endsWith("/reject")) "reject" else "submit"
            capturedAuthHeaders[key] = exchange.requestHeaders.getFirst("Authorization")
            respond(
                exchange,
                201,
                """{"id":"r1","requested_by":"u1","kind":"movie","target":{"target_kind":"existing_work","work_id":"w1"},"status":"pending","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}""",
            )
        }
        server.createContext("/api/v1/catalog") { exchange ->
            capturedAuthHeaders["catalog"] = exchange.requestHeaders.getFirst("Authorization")
            respond(exchange, 200, """{"items":[],"total":0}""")
        }
        // The default (null) executor dispatches accept + read + handle +
        // write sequentially on one internal thread, which is flaky under
        // OkHttp's own async dispatcher threads in this test environment
        // (spurious "unexpected end of stream" on the client side); a real
        // thread pool avoids that.
        server.executor = Executors.newCachedThreadPool()
        server.start()
    }

    @After
    fun tearDown() {
        server.stop(0)
    }

    private fun respond(exchange: HttpExchange, status: Int, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun apiWithToken(accessTokenProvider: () -> String?): StreamarrApi = StreamarrHttpClient.create(
        baseUrlProvider = { "http://127.0.0.1:${server.address.port}" },
        clientPlatform = ClientPlatform.AndroidMobile,
        clientVersion = "1.0",
        accessTokenProvider = accessTokenProvider,
    )

    private val submitBody = SubmitRequestBody(kind = WorkKind.Movie, target = RequestTarget.ExistingWork("w1"))

    @Test
    fun `submit request attaches the Authorization header with the stored token`() = runBlocking {
        val api = apiWithToken { "stored-token" }
        api.submitRequest(submitBody)
        assertEquals("Bearer stored-token", capturedAuthHeaders["submit"])
    }

    @Test
    fun `approve and reject also attach the Authorization header with the stored token`() = runBlocking {
        val api = apiWithToken { "stored-token" }
        api.approveRequest("r1", io.streamarr.shared.data.model.DecideRequestBody())
        api.rejectRequest("r1", io.streamarr.shared.data.model.DecideRequestBody())
        assertEquals("Bearer stored-token", capturedAuthHeaders["approve"])
        assertEquals("Bearer stored-token", capturedAuthHeaders["reject"])
    }

    @Test
    fun `catalog browsing never attaches an Authorization header even when a token is available`() = runBlocking {
        var accessTokenProviderCalls = 0
        val api = apiWithToken {
            accessTokenProviderCalls++
            "stored-token"
        }
        api.browseCatalog()
        assertNull(capturedAuthHeaders["catalog"])
        // requiresBearerAuth must gate the *call* to accessTokenProvider too,
        // not just whether its result gets attached -- catalog browsing
        // must never pay for a possible login-on-demand round trip.
        assertEquals(0, accessTokenProviderCalls)
    }

    @Test
    fun `with no token available, submit proceeds without the header rather than sending a broken one`() = runBlocking {
        val api = apiWithToken { null }
        api.submitRequest(submitBody)
        assertNull(capturedAuthHeaders["submit"])
    }

    @Test
    fun `a no-token submit call triggers accessTokenProvider (the login-on-demand path) and then sends the token it returns`() = runBlocking {
        var accessTokenProviderCalls = 0
        val api = apiWithToken {
            // Stands in for SessionManager.ensureAccessToken finding no
            // stored token, calling POST /api/v1/auth/login, and returning
            // the freshly issued token -- see SessionManagerTest for that
            // half of this flow in isolation.
            accessTokenProviderCalls++
            "login-issued-token"
        }

        api.submitRequest(submitBody)

        assertEquals(1, accessTokenProviderCalls)
        assertEquals("Bearer login-issued-token", capturedAuthHeaders["submit"])
    }
}
