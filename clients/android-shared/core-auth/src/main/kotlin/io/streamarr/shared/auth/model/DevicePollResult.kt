package io.streamarr.shared.auth.model

/**
 * Outcome of one `POST /api/auth/device/token` poll, per RFC 8628 §3.5.
 * The TV-pairing screen `when`s over this exhaustively rather than
 * inspecting HTTP status codes/error strings itself.
 */
sealed interface DevicePollResult {
    data class Approved(val token: TokenResponse) : DevicePollResult

    /** Not yet approved; the client should wait `interval` seconds (from the original grant) and poll again. */
    data object AuthorizationPending : DevicePollResult

    /** The client polled too fast; increase the interval by 5 seconds per RFC 8628 §3.5 and retry. */
    data object SlowDown : DevicePollResult

    /** `deviceCode` expired before the user approved it; the flow must restart from [io.streamarr.shared.auth.remote.DeviceAuthApi.requestDeviceCode]. */
    data object Expired : DevicePollResult

    /** The user (or an admin) explicitly declined the pairing request. */
    data object Denied : DevicePollResult

    /** Any other `error` value, or a transport failure -- see `message` for detail. */
    data class Failed(val message: String) : DevicePollResult
}
