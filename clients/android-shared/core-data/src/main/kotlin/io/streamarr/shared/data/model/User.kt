package io.streamarr.shared.data.model

import java.time.Instant
import kotlinx.serialization.Serializable

/**
 * Client-safe projection of `streamarr-model::user::User`.
 *
 * The server's `User` struct carries `password_hash` (wrapped in
 * `Sensitive<String>`) and is deliberately *not* `utoipa::ToSchema`-derived
 * for exactly that reason — handlers must project it into a secret-free DTO
 * before it goes over the wire. [UserProfile] models that DTO shape on the
 * client side: every field except the hash.
 */
@Serializable
data class UserProfile(
    val id: String,
    val username: String,
    val displayName: String,
    val email: String? = null,
    val policyId: String,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    val disabled: Boolean,
)

/**
 * A distinct client install/browser this user has authenticated. Mirrors
 * `streamarr-model::user::Device` 1:1 — it carries no secret fields.
 */
@Serializable
data class Device(
    val id: String,
    val userId: String,
    val name: String,
    val platform: ClientPlatform,
    val clientVersion: String,
    @Serializable(with = InstantIsoSerializer::class)
    val lastSeenAt: Instant? = null,
    /**
     * Set once the RFC 8628 device-authorization flow (or an equivalent
     * first-party login) has completed for this device; see `core-auth`.
     */
    val trusted: Boolean,
)
