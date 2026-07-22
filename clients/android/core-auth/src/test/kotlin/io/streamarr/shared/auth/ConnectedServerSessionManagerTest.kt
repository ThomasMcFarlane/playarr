package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.LoginRequest
import io.streamarr.shared.auth.model.LoginResponse
import io.streamarr.shared.auth.model.RefreshRequest
import io.streamarr.shared.auth.model.RefreshResponse
import io.streamarr.shared.auth.remote.LoginApi
import io.streamarr.shared.auth.remote.LoginApiForUrl
import io.streamarr.shared.auth.remote.RefreshApi
import io.streamarr.shared.auth.remote.RefreshApiForUrl
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

private class ConnectedServerManagerFakeDataStore : DataStore<Preferences> {
    private val state = MutableStateFlow(emptyPreferences())
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        return transform(state.value).also { state.value = it }
    }
}

class ConnectedServerSessionManagerTest {
    @Test
    fun `connect persists tokens without retaining the password and reuses the server device`() = runBlocking {
        val store = ConnectedServerSessionStore(ConnectedServerManagerFakeDataStore())
        val requests = mutableListOf<LoginRequest>()
        var loginCount = 0
        val manager = manager(
            store = store,
            login = { request ->
                requests += request
                loginCount += 1
                LoginResponse("access-$loginCount", "refresh-$loginCount", "Bearer", 900, "remote-user")
            },
        )

        manager.connect("profile", "https://media.example.com", "alex", "first-secret", ClientPlatform.AndroidMobile, "1.0", "Playarr")
        manager.connect("profile", "https://media.example.com", "alex", "second-secret", ClientPlatform.AndroidMobile, "1.0", "Playarr")

        assertEquals("first-secret", requests.first().password)
        assertEquals("second-secret", requests.last().password)
        assertEquals(requests.first().deviceId, requests.last().deviceId)
        val stored = store.find("profile", "https://media.example.com")
        assertNotNull(stored)
        assertEquals("access-2", stored?.accessToken)
        assertEquals("alex", stored?.username)
        assertEquals(false, stored.toString().contains("second-secret"))
    }

    @Test
    fun `refresh rotates once and a stale rejected token reuses the winner`() = runBlocking {
        val store = ConnectedServerSessionStore(ConnectedServerManagerFakeDataStore())
        var refreshCalls = 0
        val manager = manager(
            store = store,
            refresh = { request ->
                refreshCalls += 1
                assertEquals("refresh-1", request.refreshToken)
                RefreshResponse("access-2", "refresh-2", "Bearer", 900, "remote-user")
            },
        )
        manager.connect("profile", "https://media.example.com", "alex", "secret", ClientPlatform.AndroidMobile, "1.0", "Playarr")

        assertEquals("access-2", manager.refresh("profile", "https://media.example.com", "access-1"))
        assertEquals("access-2", manager.refresh("profile", "https://media.example.com", "access-1"))
        assertEquals(1, refreshCalls)
        assertEquals("refresh-2", store.find("profile", "https://media.example.com")?.refreshToken)
    }

    @Test
    fun `definitive refresh rejection disconnects but a network failure preserves the session`() = runBlocking {
        val rejectedStore = ConnectedServerSessionStore(ConnectedServerManagerFakeDataStore())
        val rejected = manager(
            store = rejectedStore,
            refresh = { throw HttpException(Response.error<Unit>(401, "unauthorized".toResponseBody())) },
        )
        rejected.connect("profile", "https://one.example.com", "alex", "secret", ClientPlatform.AndroidMobile, "1.0", "Playarr")
        assertNull(rejected.refresh("profile", "https://one.example.com", "access-1"))
        assertNull(rejectedStore.find("profile", "https://one.example.com"))

        val offlineStore = ConnectedServerSessionStore(ConnectedServerManagerFakeDataStore())
        val offline = manager(store = offlineStore, refresh = { throw java.io.IOException("offline") })
        offline.connect("profile", "https://two.example.com", "alex", "secret", ClientPlatform.AndroidMobile, "1.0", "Playarr")
        assertNull(offline.refresh("profile", "https://two.example.com", "access-1"))
        assertNotNull(offlineStore.find("profile", "https://two.example.com"))
    }

    private fun manager(
        store: ConnectedServerSessionStore,
        login: suspend (LoginRequest) -> LoginResponse = {
            LoginResponse("access-1", "refresh-1", "Bearer", 900, "remote-user")
        },
        refresh: suspend (RefreshRequest) -> RefreshResponse = {
            RefreshResponse("access-2", "refresh-2", "Bearer", 900, "remote-user")
        },
    ) = ConnectedServerSessionManager(
        store,
        LoginApiForUrl {
            object : LoginApi {
                override suspend fun login(body: LoginRequest): LoginResponse = login(body)
            }
        },
        RefreshApiForUrl {
            object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse = refresh(body)
            }
        },
    )
}
