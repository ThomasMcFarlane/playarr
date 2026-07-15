package io.streamarr.shared.auth.remote

import io.streamarr.shared.auth.model.DeviceAuthorizationResponse
import io.streamarr.shared.auth.model.TokenResponse
import retrofit2.Response
import retrofit2.http.Field
import retrofit2.http.FormUrlEncoded
import retrofit2.http.POST

/**
 * RFC 8628 OAuth 2.0 Device Authorization Grant endpoints, per
 * `docs/architecture/auth-modes.md`. Kept separate from [io.streamarr.shared.data.remote.StreamarrApi]
 * (rather than folded into it) because these two calls are the one part of
 * the API surface a client legitimately needs *before* it has any access
 * token at all.
 *
 * Both endpoints are `application/x-www-form-urlencoded`, matching the
 * RFC's wire format exactly (not JSON) -- see the worked example in
 * `auth-modes.md`.
 */
interface DeviceAuthApi {

    /**
     * Begins the pairing flow. [clientId] identifies which Playarr client
     * is pairing (`"streamarr-tv"` for Android TV, per the doc's example);
     * distinct from any user identity, since none exists yet at this point.
     */
    @FormUrlEncoded
    @POST("api/auth/device/authorize")
    suspend fun requestDeviceCode(
        @Field("client_id") clientId: String,
    ): DeviceAuthorizationResponse

    /**
     * One poll attempt. Returns the raw [Response] (rather than throwing
     * on non-2xx, which `authorization_pending`/`slow_down` always are)
     * so [io.streamarr.shared.auth.DeviceAuthClient] can distinguish
     * "keep polling" from a real failure -- see [io.streamarr.shared.auth.model.DevicePollResult].
     */
    @FormUrlEncoded
    @POST("api/auth/device/token")
    suspend fun pollForToken(
        @Field("device_code") deviceCode: String,
        @Field("client_id") clientId: String,
        @Field("grant_type") grantType: String = "urn:ietf:params:oauth:grant-type:device_code",
    ): Response<TokenResponse>
}
