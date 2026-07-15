package io.streamarr.shared.auth.remote

import io.streamarr.shared.auth.model.DeviceCodeRequest
import io.streamarr.shared.auth.model.DeviceCodeResponse
import io.streamarr.shared.auth.model.DeviceTokenRequest
import io.streamarr.shared.auth.model.TokenResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * RFC 8628 OAuth 2.0 Device Authorization Grant endpoints, per
 * `backend/openapi/streamarr.yaml`'s `oauth` tag. Kept separate from
 * [io.streamarr.shared.data.remote.StreamarrApi] (rather than folded into
 * it) because these two calls are the one part of the API surface a
 * client legitimately needs *before* it has any access token at all.
 *
 * Both endpoints are plain JSON (`application/json`), not
 * `application/x-www-form-urlencoded` -- unlike a from-memory RFC 8628
 * implementation might assume, this server's real spec uses JSON request
 * bodies for both `POST /api/v1/oauth/device/code` and
 * `POST /api/v1/oauth/token`.
 */
interface DeviceAuthApi {

    /**
     * Begins the pairing flow. [body] identifies which Playarr client
     * platform is pairing (see [io.streamarr.shared.auth.model.ClientPlatform]);
     * distinct from any user identity, since none exists yet at this point.
     */
    @POST("api/v1/oauth/device/code")
    suspend fun requestDeviceCode(@Body body: DeviceCodeRequest): DeviceCodeResponse

    /**
     * One poll attempt. Returns the raw [Response] (rather than throwing
     * on non-2xx, which `authorization_pending`/`slow_down` always are)
     * so [io.streamarr.shared.auth.DeviceAuthClient] can distinguish
     * "keep polling" from a real failure -- see
     * [io.streamarr.shared.auth.model.DevicePollResult].
     */
    @POST("api/v1/oauth/token")
    suspend fun pollForToken(@Body body: DeviceTokenRequest): Response<TokenResponse>
}
