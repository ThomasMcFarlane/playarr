package io.streamarr.tv.navigation

import kotlinx.serialization.Serializable

/** Type-safe Navigation Compose destinations for the TV app. */
sealed interface Routes {
    /** RFC 8628 device-pairing gate; shown whenever `core-auth`'s `TokenStore` has no access token. */
    @Serializable data object Pairing : Routes

    @Serializable data object Home : Routes
    @Serializable data object Library : Routes

    /** `GET /api/v1/catalog/{id}` -- a work's full kind-specific child tree, reached by selecting a catalog tile. */
    @Serializable data class WorkDetail(val workId: String) : Routes

    @Serializable data class Player(val mediaFileId: String? = null) : Routes

    @Serializable data object Settings : Routes
}
