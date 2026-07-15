package io.streamarr.mobile.navigation

import kotlinx.serialization.Serializable

/**
 * Type-safe Navigation Compose destinations (Navigation 2.8+'s
 * `kotlinx.serialization`-backed routes, rather than hand-built string
 * paths). One object per top-level destination reachable from the bottom
 * nav bar.
 */
sealed interface Routes {
    @Serializable data object Home : Routes
    @Serializable data object Library : Routes

    /** `mediaFileId == null` renders the "nothing playing" placeholder state. */
    @Serializable data class Player(val mediaFileId: String? = null) : Routes

    @Serializable data object Settings : Routes
}
