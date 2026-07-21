package io.streamarr.shared.auth.remote

import io.streamarr.shared.auth.model.LoginRequest
import io.streamarr.shared.auth.model.LoginResponse
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * `POST /api/v1/auth/login`, per `backend/openapi/streamarr.yaml`'s `auth`
 * tag. Kept separate from [DeviceAuthApi] (same rationale as that
 * interface's own KDoc): a login attempt is, like device pairing, a call a
 * client legitimately needs before it has any access token at all, so
 * [io.streamarr.shared.auth.remote.AuthHttpClient] builds this against the
 * same no-`Authorization`-interceptor `Retrofit` instance.
 *
 * Non-2xx (400 `credentials_required`/`pin_required`, 401
 * `untrusted_network`/`invalid_credentials`/`invalid_pin`/`account_disabled`)
 * throws a [retrofit2.HttpException] like every other non-`Response`-wrapped
 * call in this app; [io.streamarr.shared.auth.SessionManager.ensureAccessToken]
 * treats any such failure as "no session available" rather than surfacing
 * it, since under the server's default `AuthMode::TrustedNetwork` this call
 * is expected to always succeed for a client that can reach the server at
 * all.
 */
interface LoginApi {
    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse
}

/**
 * Builds an unauthenticated [LoginApi] pointed at an arbitrary remembered
 * address, rather than whatever the default injected [LoginApi] instance is
 * currently configured for -- what [io.streamarr.shared.auth.SessionManager]
 * retries a fresh login attempt against every remembered group address
 * with, once the default address fails (`docs/architecture/peer-groups.md`
 * §6.4/§7.2/§3.7). Unlike [io.streamarr.shared.auth.remote.RefreshApiForUrl]'s
 * refresh retry, this is deliberately **not** scoped to any one peer node:
 * a fresh login is valid at *any* group member, since accounts/policies are
 * synced across the whole group (Phase 2), not just the node that happened
 * to serve this client last. Mirrors [RefreshApiForUrl]'s own dedicated
 * `fun interface` rationale (Hilt/Kotlin function-type wildcard variance) --
 * see that type's KDoc.
 */
fun interface LoginApiForUrl {
    operator fun invoke(url: String): LoginApi
}
