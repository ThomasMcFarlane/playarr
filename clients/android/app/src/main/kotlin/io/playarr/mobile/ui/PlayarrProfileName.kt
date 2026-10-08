package io.playarr.mobile.ui

import io.playarr.shared.data.model.AvailableProfile

/**
 * The profile chip, the profile pages and the web client all show the server's display name, never the
 * username typed at sign-in. This asks the server for the current profile and stores the result when it
 * differs from what is saved; any failure leaves the saved name alone.
 */
internal suspend fun syncProfileDisplayName(
    savedName: String?,
    listProfiles: suspend () -> List<AvailableProfile>,
    saveIdentity: suspend (userId: String, displayName: String) -> Unit,
) {
    val current = runCatching { listProfiles() }.getOrNull()?.currentProfileWithName() ?: return
    if (current.displayName != savedName) saveIdentity(current.id, current.displayName)
}

internal fun List<AvailableProfile>.currentProfileWithName(): AvailableProfile? =
    firstOrNull { it.isCurrent && it.displayName.isNotBlank() }

/**
 * A QR-linked session stores only its tokens; the user id arrives from a best-effort profile lookup
 * made right after linking. When that lookup lost (slow relay, server not yet reachable) the session
 * had a token but no identity, and the profile switcher listed nobody and offered only "Sign in", which
 * looked like a sign-out. The switcher calls this before it lists, so the session adopts the server's
 * current profile and the real list loads. Returns true when an identity was stored.
 */
internal suspend fun adoptServerIdentityIfMissing(
    hasIdentity: Boolean,
    hasAccessToken: Boolean,
    listProfiles: suspend () -> List<AvailableProfile>,
    saveIdentity: suspend (userId: String, displayName: String) -> Unit,
): Boolean {
    if (hasIdentity || !hasAccessToken) return false
    val current = runCatching { listProfiles() }.getOrNull()?.firstOrNull { it.isCurrent } ?: return false
    saveIdentity(current.id, current.displayName.ifBlank { current.username })
    return true
}
