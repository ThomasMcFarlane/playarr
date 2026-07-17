package io.streamarr.shared.data.config

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Persists the operator's Streamarr server base URL, so this client can
 * point at an arbitrary operator-run instance rather than a host baked
 * into the build (per the architecture principle that no first-party
 * client hardcodes one server). Mirrors `core-auth`'s `TokenStore` --
 * DataStore-backed, `@Inject`-constructed so app modules never touch the
 * underlying `DataStore<Preferences>` directly.
 *
 * The app modules' `NetworkModule`/`AuthModule` read [baseUrl] through an
 * OkHttp interceptor re-invoked on every request (see
 * `StreamarrHttpClient`/`AuthHttpClient`'s `baseUrlProvider` parameter), so
 * a change saved here via [setBaseUrl] (from the Settings screen) takes
 * effect on the very next network call -- no app restart needed.
 */
class ServerConfigStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    val baseUrl: Flow<String> = dataStore.data.map { it[BASE_URL_KEY] ?: DEFAULT_BASE_URL }

    suspend fun setBaseUrl(url: String) {
        dataStore.edit { it[BASE_URL_KEY] = url }
    }

    suspend fun resetToDefault() {
        dataStore.edit { it[BASE_URL_KEY] = DEFAULT_BASE_URL }
    }

    companion object {
        /**
         * `10.0.2.2` is the Android **emulator's** special host-loopback
         * alias -- the emulated device's view of the host machine's own
         * `localhost` (see
         * https://developer.android.com/studio/run/emulator-networking).
         * It only works from inside the emulator. A **physical** device
         * cannot reach it at all; point this at the host machine's real
         * LAN IP instead (e.g. `http://192.168.1.23:8484`) via the
         * Settings screen this store backs.
         */
        const val DEFAULT_BASE_URL = "http://10.0.2.2:8484"

        private val BASE_URL_KEY = stringPreferencesKey("streamarr_base_url")
    }
}
