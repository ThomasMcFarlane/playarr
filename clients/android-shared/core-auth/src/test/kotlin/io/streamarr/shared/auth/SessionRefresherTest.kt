package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.streamarr.shared.auth.model.RefreshRequest
import io.streamarr.shared.auth.model.RefreshResponse
import io.streamarr.shared.auth.model.TokenResponse
import io.streamarr.shared.auth.remote.RefreshApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

private class RefreshFakeDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
    private val state = MutableStateFlow(initial)
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        val updated = transform(state.value)
        state.value = updated
        return updated
    }
}

class SessionRefresherTest {
    @Test
    fun `refresh rotates and persists both tokens`() = runBlocking {
        val store = tokenStore()
        var captured: RefreshRequest? = null
        val refresher = SessionRefresher(
            refreshApi = object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse {
                    captured = body
                    return RefreshResponse("new-access", "new-refresh", "Bearer", 900, "user")
                }
            },
            tokenStore = store,
        )

        assertEquals("new-access", refresher.refreshAccessToken("old-access"))
        assertEquals("old-refresh", captured?.refreshToken)
        assertEquals("new-access", store.accessToken.first())
        assertEquals("new-refresh", store.refreshToken.first())
    }

    @Test
    fun `second rejected request reuses token already refreshed by first request`() = runBlocking {
        val store = tokenStore()
        var refreshCalls = 0
        val refresher = SessionRefresher(
            refreshApi = object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse {
                    refreshCalls++
                    return RefreshResponse("new-access", "new-refresh", "Bearer", 900, "user")
                }
            },
            tokenStore = store,
        )

        assertEquals("new-access", refresher.refreshAccessToken("old-access"))
        assertEquals("new-access", refresher.refreshAccessToken("old-access"))
        assertEquals(1, refreshCalls)
    }

    @Test
    fun `server-rejected refresh clears dead session`() = runBlocking {
        val store = tokenStore()
        val refresher = SessionRefresher(
            refreshApi = object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse {
                    throw HttpException(
                        Response.error<RefreshResponse>(
                            401,
                            "{}".toResponseBody("application/json".toMediaType()),
                        ),
                    )
                }
            },
            tokenStore = store,
        )

        assertNull(refresher.refreshAccessToken("old-access"))
        assertNull(store.accessToken.first())
        assertNull(store.refreshToken.first())
    }

    private suspend fun tokenStore(): TokenStore = TokenStore(RefreshFakeDataStore()).also {
        it.save(TokenResponse("old-access", "old-refresh", "Bearer", 900))
    }
}
