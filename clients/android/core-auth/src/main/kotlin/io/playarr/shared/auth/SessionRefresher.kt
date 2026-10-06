package io.playarr.shared.auth

import io.playarr.shared.auth.model.RefreshRequest
import io.playarr.shared.auth.model.RefreshResponse
import io.playarr.shared.auth.model.UnlockRequest
import io.playarr.shared.auth.model.sameNodeCandidateUrls
import io.playarr.shared.auth.model.toTokenResponse
import io.playarr.shared.auth.remote.RefreshApi
import io.playarr.shared.auth.remote.RefreshApiForUrl
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

/**
 * The server refused to renew a PIN-locked profile's session because this
 * device holds no unlock lease (`403 pin_required`). The saved session is
 * intact; ask for the profile PIN and call [SessionRefresher.unlockWithPin].
 */
class PinRequiredException : Exception("this profile needs its PIN to continue")

/** True for a `403 pin_required` answer from the refresh or unlock endpoint. */
internal fun HttpException.isPinRequired(): Boolean {
    if (code() != 403) return false
    val body = runCatching { response()?.errorBody()?.string() }.getOrNull().orEmpty()
    return Regex("\"error\"\\s*:\\s*\"pin_required\"").containsMatchIn(body)
}

/**
 * Refreshes and rotates one native client's token pair after an
 * authenticated request receives 401.
 *
 * Once a peer group is known (`docs/architecture/peer-groups.md`
 * §6.4/§7.2), a failure against the default [refreshApi] -- the address
 * this client currently believes issued the session -- retries the same,
 * still-unredeemed refresh token, but **only** against other remembered
 * addresses attributed to the *same peer node* that issued it (via
 * [refreshApiForUrl], scoped by [io.playarr.shared.auth.model.sameNodeCandidateUrls]).
 * Per §3.7's stated, honest limitation, refresh-token state is never synced
 * between peers, so a genuinely different node's database has no record of
 * a token it never issued -- retrying one is a guaranteed 401, not a
 * recovery attempt, and this class no longer wastes a round trip finding
 * that out. Only a full re-login (`SessionManager.ensureAccessToken`,
 * which per §7.3 still only ever re-prompts for **credentials**, never a
 * server address -- and, unlike a refresh, *is* worth retrying at any
 * group member, since accounts/policies do sync, Phase 2) truly recovers a
 * session whose issuing peer has partitioned away for good. When no group
 * is remembered at all, or the issuing peer node can't be determined (see
 * [decodeAccessTokenIssuerPeerNodeId]), or no remembered address is
 * attributed to that node, this collapses to exactly the original
 * single-address behavior -- no sibling is ever guessed at.
 *
 * `@Singleton`: [mutex] only serializes calls made *through this instance*.
 * `NetworkModule` injects this into both the primary REST API's
 * authenticator and, via `PlayarrServerClientProvider`, the Media3
 * download/playback client's authenticator -- without a shared scope, Hilt
 * hands each an unscoped instance of its own, so a REST call and a
 * playback/download call 401ing around the same moment (e.g. right after
 * the app resumes from background) would race the single-use refresh
 * endpoint through two independent locks. The loser's presented token is
 * already retired by the winner's rotation, which the server treats as
 * theft and revokes the whole family -- forcing a full re-login even
 * though the session was perfectly valid a moment before.
 */
@Singleton
class SessionRefresher @Inject constructor(
    private val refreshApi: RefreshApi,
    private val tokenStore: TokenStore,
    private val knownServerGroupStore: KnownServerGroupStore,
    private val refreshApiForUrl: RefreshApiForUrl,
) {
    private val mutex = Mutex()

    /**
     * Redeems the current session's refresh token right now (no 401 needed)
     * and stores the rotated pair. Used when switching to a saved profile so a
     * PIN-locked one is checked against its unlock lease immediately. Throws
     * [PinRequiredException] when the profile needs its PIN; any other failure
     * leaves the stored session untouched and rethrows.
     */
    suspend fun refreshNow(): String = mutex.withLock {
        val request = currentRequest() ?: error("no stored session to refresh")
        try {
            val response = refreshApi.refresh(request)
            tokenStore.save(response.toTokenResponse())
            knownServerGroupStore.rememberPeerAddresses(response.peerAddresses)
            response.accessToken
        } catch (error: HttpException) {
            if (error.isPinRequired()) throw PinRequiredException()
            throw error
        }
    }

    /**
     * Unlocks the current (PIN-locked) profile on this device with [pin] and
     * stores the rotated token pair. A wrong PIN surfaces as the server's
     * `401 invalid_pin` or `429 pin_locked` [HttpException].
     */
    suspend fun unlockWithPin(pin: String): String = mutex.withLock {
        val base = currentRequest() ?: error("no stored session to unlock")
        val response = refreshApi.unlock(UnlockRequest(base.deviceId, base.refreshToken, pin))
        tokenStore.save(response.toTokenResponse())
        knownServerGroupStore.rememberPeerAddresses(response.peerAddresses)
        response.accessToken
    }

    private suspend fun currentRequest(): RefreshRequest? {
        val refreshToken = tokenStore.refreshToken.first()?.takeIf { it.isNotBlank() } ?: return null
        return RefreshRequest(deviceId = tokenStore.getOrCreateDeviceId(), refreshToken = refreshToken)
    }

    suspend fun refreshAccessToken(rejectedAccessToken: String?): String? = mutex.withLock {
        val currentAccessToken = tokenStore.accessToken.first()

        // A concurrent request may already have completed the single-use
        // refresh-token rotation. Reuse its result instead of redeeming the
        // now-retired token again and revoking the entire token family.
        if (!currentAccessToken.isNullOrBlank() && currentAccessToken != rejectedAccessToken) {
            return@withLock currentAccessToken
        }

        val refreshToken = tokenStore.refreshToken.first()?.takeIf { it.isNotBlank() }
        if (refreshToken == null) {
            // A session with an access token but nothing to renew it with can never recover: every request
            // would 401 forever with no refresh attempt. Drop it so the person is asked to sign in again.
            if (!currentAccessToken.isNullOrBlank()) tokenStore.clear()
            return@withLock null
        }
        val request = RefreshRequest(
            deviceId = tokenStore.getOrCreateDeviceId(),
            refreshToken = refreshToken,
        )

        // Whether the *primary* address -- the one this client currently
        // believes issued the session -- definitively rejected the token
        // (401), as opposed to merely being unreachable. Only that counts
        // as proof the session itself is over. A sibling peer's 401 does
        // not: per §3.7, refresh tokens are never synced between peers, so
        // a sibling rejecting a token it never issued is expected noise,
        // not evidence the session is dead -- it just means that candidate
        // isn't valid for this token, so move on to the next one. Likewise,
        // every address simply failing to answer proves nothing either way,
        // and a later call may still recover it.
        var primaryRejected = false
        suspend fun attempt(api: RefreshApi, isPrimary: Boolean = false): RefreshResponse? = try {
            api.refresh(request)
        } catch (error: Exception) {
            if (isPrimary && error is HttpException && error.code() == 401) primaryRejected = true
            null
        }

        attempt(refreshApi, isPrimary = true)?.let { response ->
            tokenStore.save(response.toTokenResponse())
            knownServerGroupStore.rememberPeerAddresses(response.peerAddresses)
            return@withLock response.accessToken
        }

        // The peer that issued this session may simply be unreachable right
        // now, not genuinely dead -- retry the same refresh token against
        // every OTHER remembered address of that SAME peer node before
        // giving up. Scoped by the token's own `iss` claim, not every
        // remembered address: a sibling node's database was never handed
        // this refresh token (§3.7), so trying one is guaranteed busywork,
        // not a recovery attempt.
        val group = knownServerGroupStore.group.first()
        val issuingPeerNodeId = decodeAccessTokenIssuerPeerNodeId(currentAccessToken ?: rejectedAccessToken)
        val sameNodeCandidates = if (group != null && issuingPeerNodeId != null) {
            group.sameNodeCandidateUrls(issuingPeerNodeId)
        } else {
            emptyList()
        }
        for (url in sameNodeCandidates) {
            val response = attempt(refreshApiForUrl(url)) ?: continue
            tokenStore.save(response.toTokenResponse())
            knownServerGroupStore.rememberServerSuccess(url)
            knownServerGroupStore.rememberPeerAddresses(response.peerAddresses)
            return@withLock response.accessToken
        }

        if (primaryRejected) tokenStore.clear()
        null
    }
}
