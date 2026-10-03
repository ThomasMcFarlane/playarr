package io.playarr.shared.auth

import java.util.Base64
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Best-effort, unverified decode of an access token JWT's `iss` claim --
 * mirrors `clients/tv-web/packages/device-auth/src/jwt.ts`'s
 * `decodeAccessTokenUserId`/`decodeAccessTokenDeviceId` pattern (`sub`/
 * `device_id`), applied to `iss` instead. Purely a client-side routing
 * hint for [SessionRefresher]'s retry scoping -- the signature is never
 * checked here, only the payload is read. That's fine: the server
 * independently re-verifies the token's signature on every protected
 * request, so nothing security-relevant depends on this being tamper-proof.
 *
 * Per `playarr_auth::jwt`'s own doc comment, a grouped node issues EdDSA
 * access tokens with `iss` set to the issuing peer's `peer_id` (a UUID); a
 * standalone node -- or a token minted before this node ever joined a
 * group -- issues HS256 tokens with a fixed, non-UUID issuer string
 * instead (e.g. `"playarr"`). Returns `null` for anything that isn't a
 * well-formed three-segment JWT with a string `iss` claim that itself
 * parses as a [UUID] -- deliberately indistinguishable from "not a JWT at
 * all" to callers, since both cases mean the same thing: no known issuing
 * peer node to scope a same-node retry to.
 */
fun decodeAccessTokenIssuerPeerNodeId(accessToken: String?): String? {
    if (accessToken.isNullOrBlank()) return null
    val parts = accessToken.split(".")
    if (parts.size != 3) return null
    val payloadSegment = parts[1].takeIf { it.isNotBlank() } ?: return null
    return try {
        val payloadJson = String(Base64.getUrlDecoder().decode(padBase64Url(payloadSegment)))
        val claims = Json.parseToJsonElement(payloadJson) as? JsonObject ?: return null
        val iss = claims["iss"]?.jsonPrimitive?.contentOrNull ?: return null
        // Only a UUID-shaped `iss` names a specific peer node -- the fixed
        // HS256 issuer string doesn't identify one at all.
        UUID.fromString(iss).toString()
    } catch (_: Exception) {
        null
    }
}

/**
 * Best-effort, unverified read of an access token's `device_id` claim: the
 * server-side refresh family is keyed by this id, so it is the only id a
 * refresh for this session can present (device-flow pairing mints it
 * server-side).
 */
fun decodeAccessTokenDeviceId(accessToken: String?): String? {
    if (accessToken.isNullOrBlank()) return null
    val parts = accessToken.split(".")
    if (parts.size != 3) return null
    val payloadSegment = parts[1].takeIf { it.isNotBlank() } ?: return null
    return try {
        val claims = Json.parseToJsonElement(String(Base64.getUrlDecoder().decode(padBase64Url(payloadSegment)))) as? JsonObject
        claims?.get("device_id")?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }
}

/** `java.util.Base64`'s URL decoder accepts unpadded input inconsistently across JDKs -- pad explicitly to a multiple of 4 rather than relying on that. */
private fun padBase64Url(segment: String): String {
    val remainder = segment.length % 4
    return if (remainder == 0) segment else segment + "=".repeat(4 - remainder)
}
