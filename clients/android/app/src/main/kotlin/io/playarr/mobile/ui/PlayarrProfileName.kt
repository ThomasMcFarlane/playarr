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
