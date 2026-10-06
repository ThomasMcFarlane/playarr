import Foundation

// MARK: - QR / pairing-code sign-in flow
//
// Platform-neutral orchestration of the hosted device-link sign-in used by
// the iPhone/iPad login screen ("Sign in with a QR code"). It mirrors the
// Android flow and the tvOS pairing loop:
//
//   1. request a hosted code and show the QR, code and link
//   2. wait for the approving device's claim (server URL + device code)
//   3. poll the real server token endpoint
//
// An expired code renews silently (bounded by `maxRenewals`). Denial and
// network or service failures surface as `DeviceLinkFailure`, so the screen
// can offer a retry. Cancelling the surrounding `Task` ends the flow with
// `CancellationError` and leaves the last state alone.

public protocol HostedLinkBroker: Sendable {
    func requestCode() async throws -> DeviceCodeResponse
    func pollUntilClaim(_ code: DeviceCodeResponse, extraGrace: TimeInterval) async throws -> HostedLinkClaim
}

extension HostedDeviceLinkClient: HostedLinkBroker {}

public protocol DeviceTokenPolling: Sendable {
    func pollForToken(deviceCode: String, interval: TimeInterval, expiresIn: TimeInterval) async throws -> TokenResponse
}

extension DeviceFlowClient: DeviceTokenPolling {}

/// What the screen shows while waiting for approval.
public struct DeviceLinkPrompt: Equatable, Sendable {
    public var userCode: String
    public var verificationURI: String
    public var verificationURIComplete: String
    public var expiresInSeconds: Int64

    public init(userCode: String, verificationURI: String, verificationURIComplete: String, expiresInSeconds: Int64) {
        self.userCode = userCode
        self.verificationURI = verificationURI
        self.verificationURIComplete = verificationURIComplete
        self.expiresInSeconds = expiresInSeconds
    }

    init(_ code: DeviceCodeResponse) {
        self.init(
            userCode: code.userCode,
            verificationURI: code.verificationUri,
            verificationURIComplete: code.verificationUriComplete,
            expiresInSeconds: code.expiresIn
        )
    }
}

public enum DeviceLinkFailure: Error, Equatable, Sendable {
    /// The approving device refused the request.
    case denied
    /// The code kept expiring without an approval (renewal budget spent).
    case expired
    /// The network or the server could not be reached.
    case network(String)
    /// Playarr linking or the server answered with an unusable response.
    case unavailable(String)

    public var message: String {
        switch self {
        case .denied: return "The sign-in request was denied on the other device."
        case .expired: return "The code expired before it was approved. Try again."
        case .network(let detail): return detail.isEmpty ? "Playarr could not be reached. Check your connection and try again." : detail
        case .unavailable(let detail): return detail
        }
    }
}

public enum DeviceLinkSignInState: Equatable, Sendable {
    case idle
    case requestingCode
    case awaitingApproval(DeviceLinkPrompt)
    /// The approving device chose a server; waiting for the token exchange.
    case finishing
    case failed(DeviceLinkFailure)
}

public struct DeviceLinkResult: Sendable {
    public var serverURL: URL
    public var serverURLs: [URL]
    public var token: TokenResponse
}

public enum DeviceLinkSignIn {
    /// Seconds to keep polling after the displayed lifetime so a last-second
    /// claim still lands (web `HOSTED_LINK_CLAIM_REDEMPTION_GRACE_MS`).
    public static let claimGrace: TimeInterval = 30

    public static func run(
        broker: HostedLinkBroker,
        makeAuthorizer: @Sendable (URL) -> DeviceTokenPolling,
        normaliseServerURL: @Sendable (String) -> URL?,
        maxRenewals: Int = 20,
        onState: @Sendable (DeviceLinkSignInState) -> Void
    ) async throws -> DeviceLinkResult {
        var renewals = 0
        while true {
            try Task.checkCancellation()
            onState(.requestingCode)
            do {
                let pending = try await broker.requestCode()
                onState(.awaitingApproval(DeviceLinkPrompt(pending)))
                let claim = try await broker.pollUntilClaim(pending, extraGrace: claimGrace)
                onState(.finishing)

                guard let primary = normaliseServerURL(claim.serverURL) else {
                    throw HostedDeviceLinkError.invalidClaim
                }
                var seen = Set<String>([primary.absoluteString])
                var urls = [primary]
                for raw in claim.serverURLs {
                    if let url = normaliseServerURL(raw), seen.insert(url.absoluteString).inserted {
                        urls.append(url)
                    }
                }

                let remaining = max(TimeInterval(pending.expiresIn) - 1, 30)
                let token = try await makeAuthorizer(primary).pollForToken(
                    deviceCode: claim.serverDeviceCode,
                    interval: 1,
                    expiresIn: remaining
                )
                return DeviceLinkResult(serverURL: primary, serverURLs: urls, token: token)
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as URLError where error.code == .cancelled {
                throw CancellationError()
            } catch {
                let failure = classify(error)
                if failure == .expired {
                    renewals += 1
                    if renewals <= maxRenewals { continue }
                }
                onState(.failed(failure))
                throw failure
            }
        }
    }

    static func classify(_ error: Error) -> DeviceLinkFailure {
        if let failure = error as? DeviceLinkFailure { return failure }
        if let hosted = error as? HostedDeviceLinkError {
            switch hosted {
            case .expired: return .expired
            case .invalidClaim: return .unavailable("Playarr returned an invalid sign-in response.")
            case .http(let status): return .unavailable("Playarr sign-in is unavailable (HTTP \(status)).")
            case .invalidBaseURL, .invalidResponse: return .unavailable("Playarr sign-in is unavailable.")
            case .transportMessage(let message): return .network(message)
            }
        }
        if let flow = error as? DeviceFlowError {
            switch flow {
            case .authorizationExpired: return .expired
            case .accessDenied: return .denied
            case .invalidBaseURL: return .unavailable("The server address is invalid.")
            case .invalidResponse: return .unavailable("The server returned an invalid response.")
            case .http(let status, _): return .unavailable("The server returned an error (\(status)).")
            case .oauth: return .unavailable("The server could not complete sign-in.")
            case .transport(let underlying): return .network(underlying.localizedDescription)
            case .decoding: return .unavailable("The server returned an invalid response.")
            }
        }
        return .network(error.localizedDescription)
    }
}
