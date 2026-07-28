package io.streamarr.mobile.cast

import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.config.ServerConfigStore
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory

@Serializable
private data class CastDeviceCodeRequest(@SerialName("client_platform") val clientPlatform: String = "cast")

@Serializable
private data class CastDeviceCodeResponse(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("user_code") val userCode: String,
    @SerialName("expires_in") val expiresIn: Long,
    val interval: Long,
)

@Serializable
private data class CastAuthorizeRequest(@SerialName("user_code") val userCode: String)

@Serializable
private data class CastDeviceTokenRequest(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("grant_type") val grantType: String = DEVICE_CODE_GRANT_TYPE,
) {
    companion object {
        const val DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
    }
}

@Serializable
private data class CastOAuthErrorBody(val error: String)

@Serializable
private data class CastTokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Long,
)

@Serializable
private data class CastRefreshRequest(
    @SerialName("device_id") val deviceId: String,
    @SerialName("refresh_token") val refreshToken: String,
)

@Serializable
private data class CastRefreshResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Long,
)

/**
 * The three-and-a-half endpoints [PlayarrDelegatedDeviceAuth] needs.
 * Deliberately its own tiny Retrofit interface rather than an addition to
 * `core-auth`'s `DeviceAuthApi` (whose `ClientPlatform` has no `cast`
 * value) or `core-data`'s `StreamarrApi` (no `device/authorize` route, and
 * both files are out of this build's file-ownership scope) -- see
 * `core-data`'s `StreamarrHttpClient` KDoc for the identical
 * per-request base-URL-rewriting rationale this mirrors below.
 */
private interface PlayarrCastDeviceAuthApi {
    @POST("api/v1/oauth/device/code")
    suspend fun requestDeviceCode(@Body body: CastDeviceCodeRequest): CastDeviceCodeResponse

    /** `Authorization` carries the SENDER's own bearer token -- self-approval, no user interaction. */
    @POST("api/v1/oauth/device/authorize")
    suspend fun authorize(
        @Header("Authorization") bearer: String,
        @Body body: CastAuthorizeRequest,
    ): Response<ResponseBody>

    @POST("api/v1/oauth/token")
    suspend fun pollForToken(@Body body: CastDeviceTokenRequest): Response<CastTokenResponse>

    /** Same rotate-on-use refresh every other session on this app already uses -- see [PlayarrDelegatedDeviceAuth]'s KDoc for why the cast device identity redeems it here too, rather than repeating the device-code dance. */
    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body body: CastRefreshRequest): CastRefreshResponse
}

private data class CastDeviceIdentity(val deviceId: String, val refreshToken: String)

/**
 * Mints and refreshes the SEPARATE device identity the Cast receiver
 * authenticates as -- never the sender's own access/refresh token (reusing
 * those would let the receiver's own token rotation revoke the sender's
 * session via reuse-detection).
 *
 * The first call ever made from this process runs the full RFC 8628 dance:
 * `POST oauth/device/code` -> self-approve via `POST oauth/device/authorize`
 * (bearing the SENDER's own current access token, no user interaction
 * needed -- any signed-in user may approve their own code) -> poll
 * `POST oauth/token`. [device_id][decodeAccessTokenDeviceId] is read out of
 * the resulting access token's JWT claims, per the design doc, not the
 * token response body.
 *
 * Every call after that redeems the cached `{deviceId, refreshToken}` pair
 * via the ordinary `POST auth/refresh` the rest of this app already uses
 * for its own sessions -- the RFC 8628 device-code mint only ever needs to
 * happen once per process. [onCredentialsRotated] must be fed whatever the
 * receiver reports back as `auth.rotated`: refresh tokens are
 * rotate-on-use, so an out-of-date cached one here would force a needless
 * full re-mint (still self-approving and harmless, just slower).
 */
@Singleton
class PlayarrDelegatedDeviceAuth @Inject constructor(
    private val tokenStore: TokenStore,
    private val serverConfigStore: ServerConfigStore,
) {
    private val mutex = Mutex()
    private val requestJson = Json { ignoreUnknownKeys = true }

    @Volatile private var cachedIdentity: CastDeviceIdentity? = null

    private val api: PlayarrCastDeviceAuthApi by lazy {
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(castDeviceAuthBaseUrlInterceptor { runBlocking { serverConfigStore.baseUrl.first() } })
            .build()
        Retrofit.Builder()
            .baseUrl(PLACEHOLDER_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(requestJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(PlayarrCastDeviceAuthApi::class.java)
    }

    /** Persists a refresh token the receiver rotated while a cast was active, so the next mint/refresh redeems the still-valid one. */
    fun onCredentialsRotated(credentials: PlayarrCastCredentials) {
        cachedIdentity = CastDeviceIdentity(credentials.deviceId, credentials.refreshToken)
    }

    /** Returns a fresh [PlayarrCastCredentials], minting a new device identity only if none is cached yet (or the cached one no longer redeems). */
    suspend fun obtainCredentials(): PlayarrCastCredentials = mutex.withLock {
        val existing = cachedIdentity
        val refreshed = existing?.let { identity -> runCatching { refresh(identity) }.getOrNull() }
        refreshed ?: mint()
    }

    private suspend fun refresh(identity: CastDeviceIdentity): PlayarrCastCredentials {
        val response = api.refresh(CastRefreshRequest(identity.deviceId, identity.refreshToken))
        cachedIdentity = CastDeviceIdentity(identity.deviceId, response.refreshToken)
        return PlayarrCastCredentials(
            deviceId = identity.deviceId,
            accessToken = response.accessToken,
            accessTokenExpiresAt = System.currentTimeMillis() + response.expiresIn * 1_000L,
            refreshToken = response.refreshToken,
        )
    }

    private suspend fun mint(): PlayarrCastCredentials {
        val codeResponse = api.requestDeviceCode(CastDeviceCodeRequest())
        val senderToken = tokenStore.accessToken.first()
            ?: error("Cannot mint a Playarr Cast device identity while signed out")
        val authorizeResponse = api.authorize("Bearer $senderToken", CastAuthorizeRequest(codeResponse.userCode))
        check(authorizeResponse.isSuccessful) {
            "Cast device authorization was rejected: HTTP ${authorizeResponse.code()}"
        }
        val token = pollUntilApproved(codeResponse.deviceCode, codeResponse.interval)
        val deviceId = decodeAccessTokenDeviceId(token.accessToken)
            ?: error("Cast access token did not carry a device_id claim")
        cachedIdentity = CastDeviceIdentity(deviceId, token.refreshToken)
        return PlayarrCastCredentials(
            deviceId = deviceId,
            accessToken = token.accessToken,
            accessTokenExpiresAt = System.currentTimeMillis() + token.expiresIn * 1_000L,
            refreshToken = token.refreshToken,
        )
    }

    /** RFC 8628 §3.5 poll loop: sleeps [initialIntervalSeconds] between attempts, +5s more on every `slow_down`. */
    private suspend fun pollUntilApproved(deviceCode: String, initialIntervalSeconds: Long): CastTokenResponse {
        var intervalSeconds = initialIntervalSeconds.coerceAtLeast(1L)
        while (true) {
            delay(intervalSeconds * 1_000L)
            val response = api.pollForToken(CastDeviceTokenRequest(deviceCode = deviceCode))
            if (response.isSuccessful) {
                return response.body() ?: error("Empty Cast device-token response body")
            }
            val errorCode = response.errorBody()?.string()
                ?.let { body -> runCatching { requestJson.decodeFromString(CastOAuthErrorBody.serializer(), body) }.getOrNull() }
                ?.error
            when (errorCode) {
                "authorization_pending" -> Unit
                "slow_down" -> intervalSeconds += 5L
                else -> error("Cast device-code pairing failed: ${errorCode ?: "HTTP ${response.code()}"}")
            }
        }
    }

    private companion object {
        const val PLACEHOLDER_BASE_URL = "http://streamarr.invalid/"
    }
}

/** See `core-data`'s `StreamarrHttpClient`/`core-auth`'s `AuthHttpClient` -- an identical per-request scheme/host/port rewrite, duplicated rather than shared so this file needs no dependency beyond what it already declares. */
private fun castDeviceAuthBaseUrlInterceptor(baseUrlProvider: () -> String): Interceptor = Interceptor { chain ->
    val original = chain.request()
    val configured = baseUrlProvider().trim().toHttpUrlOrNull()
    val request = if (configured != null) {
        original.newBuilder().url(
            original.url.newBuilder()
                .scheme(configured.scheme)
                .host(configured.host)
                .port(configured.port)
                .build(),
        ).build()
    } else {
        original
    }
    chain.proceed(request)
}

/**
 * Mirrors `core-auth`'s `decodeAccessTokenIssuerPeerNodeId` /
 * `clients/tv-web/packages/device-auth/src/jwt.ts`'s
 * `decodeAccessTokenDeviceId` exactly: best-effort, unverified read of a
 * JWT access token's `device_id` claim. Duplicated here rather than added
 * to `core-auth`'s `Jwt.kt` (out of this build's file-ownership scope) --
 * see [PlayarrCastDeviceAuthApi]'s KDoc for the same reasoning. The
 * signature is never checked here, only the payload is read -- fine, since
 * the server independently re-verifies the token's signature on every
 * protected request, so nothing security-relevant depends on this being
 * tamper-proof.
 */
private fun decodeAccessTokenDeviceId(accessToken: String): String? {
    val parts = accessToken.split(".")
    if (parts.size != 3) return null
    val payloadSegment = parts[1].takeIf { it.isNotBlank() } ?: return null
    return try {
        val payloadJson = String(Base64.getUrlDecoder().decode(padBase64Url(payloadSegment)))
        val claims = Json.parseToJsonElement(payloadJson) as? JsonObject ?: return null
        claims["device_id"]?.jsonPrimitive?.contentOrNull
    } catch (_: Exception) {
        null
    }
}

/** `java.util.Base64`'s URL decoder accepts unpadded input inconsistently across JDKs -- pad explicitly to a multiple of 4 rather than relying on that. */
private fun padBase64Url(segment: String): String {
    val remainder = segment.length % 4
    return if (remainder == 0) segment else segment + "=".repeat(4 - remainder)
}
