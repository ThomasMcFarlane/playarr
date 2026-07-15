package io.streamarr.shared.auth

import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Best-effort, verification-free read of the `sub` claim (the signed-in
 * user's id) out of an access token's payload segment -- mirrors
 * `streamarr_auth::jwt::AccessTokenClaims::sub`. This client never verifies
 * the JWT signature; that is the server's job on every request the token is
 * attached to. Reading `sub` locally is not itself a trust decision: any
 * request built using it (e.g. `SubmitRequestBody.requestedBy`,
 * `DecideRequestBody.decidedBy`) only succeeds if the bearer token sent
 * alongside it verifies server-side, so a forged/stale local read can only
 * make an authenticated call *as* whatever id it names.
 *
 * There is no `/me` endpoint in the real spec (`backend/openapi/streamarr.yaml`)
 * and no role/admin claim on [io.streamarr.shared.auth.model.TokenResponse]'s
 * access token (`AccessTokenClaims` carries `sub`/`device_id`/`session_id`/
 * `iss`/`iat`/`exp` only) -- this is deliberately narrow to just the one
 * claim that does exist, rather than guessing at a shape that isn't real.
 */
object JwtClaims {
    private val json = Json { ignoreUnknownKeys = true }

    /** Returns `null` for a malformed/non-JWT token or a payload with no `sub`, rather than throwing. */
    fun subject(accessToken: String): String? {
        val segments = accessToken.split(".")
        if (segments.size < 2) return null
        return runCatching {
            val payloadBytes = Base64.getUrlDecoder().decode(segments[1].withBase64Padding())
            json.parseToJsonElement(String(payloadBytes, Charsets.UTF_8))
                .jsonObject["sub"]
                ?.jsonPrimitive
                ?.content
        }.getOrNull()
    }

    /** [java.util.Base64.getUrlDecoder] requires `=` padding; a JWT segment is unpadded base64url. */
    private fun String.withBase64Padding(): String {
        val remainder = length % 4
        return if (remainder == 0) this else this + "=".repeat(4 - remainder)
    }
}
