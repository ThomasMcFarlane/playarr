package io.playarr.shared.auth.remote

import io.playarr.shared.auth.model.RefreshRequest
import io.playarr.shared.auth.model.RefreshResponse
import io.playarr.shared.auth.model.UnlockRequest
import retrofit2.http.Body
import retrofit2.http.POST

/** Rotates a persisted refresh token without requiring the account password again. */
interface RefreshApi {
    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): RefreshResponse

    /**
     * Redeems a stored refresh token together with the profile PIN. Grants the
     * server-side unlock lease a PIN-locked profile needs before its refresh
     * token works again (`403 pin_required` on [refresh]).
     */
    @POST("api/v1/auth/unlock")
    suspend fun unlock(@Body body: UnlockRequest): RefreshResponse
}

/**
 * Builds an unauthenticated [RefreshApi] pointed at an arbitrary remembered
 * address, rather than whatever the default injected [RefreshApi] instance
 * is currently configured for -- what `SessionRefresher` retries a
 * still-unredeemed refresh token against every other remembered address
 * with, once the default address fails (`docs/architecture/
 * peer-groups.md` §6.4/§7.2/§3.7). A dedicated `fun interface` rather than
 * a bare `(String) -> RefreshApi` Kotlin function type: Dagger/Hilt's
 * Java-facing codegen and Kotlin's `Function1` apply wildcard variance
 * inconsistently between a `@Provides` method's return type and a
 * constructor parameter's type, which makes a raw function type an
 * unreliable Hilt injection target without extra
 * `@JvmSuppressWildcards`/`@JvmWildcard` annotation juggling -- a named
 * functional interface sidesteps that entirely.
 */
fun interface RefreshApiForUrl {
    operator fun invoke(url: String): RefreshApi
}
