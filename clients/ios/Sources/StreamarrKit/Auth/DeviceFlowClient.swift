import Foundation

// MARK: - RFC 8628 device flow client
//
// Talks to the real `POST /api/v1/oauth/device/code` and `POST
// /api/v1/oauth/token` endpoints described in
// `backend/openapi/streamarr.yaml` (see `streamarr-api/src/oauth.rs` and
// `streamarr-auth/src/device_flow.rs` on the backend for the exact
// handler/service behavior this mirrors). Both endpoints take/return plain
// JSON (`axum::Json` extractors server-side), not
// `application/x-www-form-urlencoded` — earlier drafts of this client
// assumed a generic form-encoded OAuth server; the real Streamarr API does
// not work that way, so this file posts `Codable` bodies from
// `Networking/OpenAPISchemas.swift` instead.
//
// This is kept as its own component (an `actor`, not folded into
// `APIClient`) because the shape is genuinely different from every other
// endpoint this app calls: unauthenticated, and `pollForToken` needs its
// own backoff/expiry loop around the token call rather than a single
// request/response round trip.

/// The RFC 8628 §3.5 error codes the token endpoint can return while
/// polling, plus RFC 6749 §5.2's `unsupported_grant_type` (the spec
/// documents exactly these five: `authorization_pending | slow_down |
/// expired_token | access_denied | unsupported_grant_type`). `.other` is a
/// deliberate escape hatch — an unrecognized `error` string should surface
/// to the caller as a real (if unfamiliar) error, not crash a `switch`.
public enum DeviceFlowErrorCode: Sendable, Equatable {
    case authorizationPending
    case slowDown
    case expiredToken
    case accessDenied
    case unsupportedGrantType
    case other(String)

    public init(wireValue: String) {
        switch wireValue {
        case "authorization_pending": self = .authorizationPending
        case "slow_down": self = .slowDown
        case "expired_token": self = .expiredToken
        case "access_denied": self = .accessDenied
        case "unsupported_grant_type": self = .unsupportedGrantType
        default: self = .other(wireValue)
        }
    }
}

public enum DeviceFlowError: Error, Sendable {
    case invalidBaseURL
    case invalidResponse
    case http(status: Int, body: Data?)
    case oauth(DeviceFlowErrorCode)
    case authorizationExpired
    case accessDenied
    case transport(Error)
    case decoding(Error)
}

/// Where to find the device-authorization/token endpoints, and which
/// `ClientPlatform` this app identifies as (`DeviceCodeRequest.client_platform`
/// in the spec — the real request body has no `client_id`/`scope` fields at
/// all, unlike a generic OAuth device flow).
public struct DeviceFlowConfiguration: Sendable {
    public var baseURL: URL
    public var clientPlatform: ClientPlatform
    public var deviceCodePath: String
    public var tokenPath: String

    public init(
        baseURL: URL,
        clientPlatform: ClientPlatform = .ios,
        deviceCodePath: String = "/api/v1/oauth/device/code",
        tokenPath: String = "/api/v1/oauth/token"
    ) {
        self.baseURL = baseURL
        self.clientPlatform = clientPlatform
        self.deviceCodePath = deviceCodePath
        self.tokenPath = tokenPath
    }
}

/// Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) against the
/// real Streamarr `/api/v1/oauth/device/code` + `/api/v1/oauth/token`
/// endpoints, for sign-in flows where typing a password on the device
/// itself is inconvenient (tvOS in particular; also usable from iOS as a
/// "sign in with a code on another device" option).
///
/// Usage:
/// ```swift
/// let client = DeviceFlowClient(configuration: .init(baseURL: serverBaseURL))
/// let token = try await client.authorize { pending in
///     // Show `pending.userCode` / `pending.verificationUri` to the user.
/// }
/// ```
public actor DeviceFlowClient {
    private let configuration: DeviceFlowConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(configuration: DeviceFlowConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.decoder = StreamarrJSONCoding.makeDecoder()
        self.encoder = StreamarrJSONCoding.makeEncoder()
    }

    /// `POST /api/v1/oauth/device/code` (RFC 8628 §3.1/§3.2): request a
    /// device code + user code from the server.
    public func requestDeviceCode() async throws -> DeviceCodeResponse {
        let request = try makeJSONRequest(
            path: configuration.deviceCodePath,
            body: DeviceCodeRequest(clientPlatform: configuration.clientPlatform)
        )
        let (data, response) = try await performRequest(request)
        try Self.validate(response: response, data: data)

        do {
            return try decoder.decode(DeviceCodeResponse.self, from: data)
        } catch {
            throw DeviceFlowError.decoding(error)
        }
    }

    /// `POST /api/v1/oauth/token` (RFC 8628 §3.4/§3.5): poll until the user
    /// completes authorization, the code expires, or access is denied.
    /// Honors `slow_down` by increasing the poll interval by 5 seconds, per
    /// §3.5.
    public func pollForToken(
        deviceCode: String,
        interval: TimeInterval,
        expiresIn: TimeInterval
    ) async throws -> TokenResponse {
        let deadline = Date().addingTimeInterval(expiresIn)
        var currentInterval = max(interval, 1)

        while true {
            if Date() >= deadline {
                throw DeviceFlowError.authorizationExpired
            }

            try await Task.sleep(for: .milliseconds(Int(currentInterval * 1000)))
            try Task.checkCancellation()

            do {
                return try await requestToken(deviceCode: deviceCode)
            } catch let DeviceFlowError.oauth(code) {
                switch code {
                case .authorizationPending:
                    continue
                case .slowDown:
                    currentInterval += 5
                    continue
                case .accessDenied:
                    throw DeviceFlowError.accessDenied
                case .expiredToken:
                    throw DeviceFlowError.authorizationExpired
                case .unsupportedGrantType, .other:
                    // Not a transient polling state — a client-side bug
                    // (wrong grant type) or an error code this client
                    // doesn't know how to recover from. Surface it rather
                    // than spin forever.
                    throw DeviceFlowError.oauth(code)
                }
            }
        }
    }

    /// Convenience wrapper that runs both RFC 8628 steps: requests a
    /// device code, hands it to `onAuthorizationPending` so the caller can
    /// show the user code/verification URL, then blocks on the poll loop
    /// until the user finishes (or the flow expires/is denied).
    public func authorize(
        onAuthorizationPending: @Sendable (DeviceCodeResponse) -> Void
    ) async throws -> TokenResponse {
        let deviceAuth = try await requestDeviceCode()
        onAuthorizationPending(deviceAuth)
        return try await pollForToken(
            deviceCode: deviceAuth.deviceCode,
            interval: TimeInterval(deviceAuth.interval),
            expiresIn: TimeInterval(deviceAuth.expiresIn)
        )
    }

    // MARK: - Private

    private func requestToken(deviceCode: String) async throws -> TokenResponse {
        let request = try makeJSONRequest(
            path: configuration.tokenPath,
            body: DeviceTokenRequest(deviceCode: deviceCode)
        )
        let (data, response) = try await performRequest(request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeviceFlowError.invalidResponse
        }

        if httpResponse.statusCode == 200 {
            do {
                return try decoder.decode(TokenResponse.self, from: data)
            } catch {
                throw DeviceFlowError.decoding(error)
            }
        }

        // RFC 8628 §3.5: a non-200 poll response is always
        // `{"error": "<code>"}` (see `OAuthErrorBody`), not the generic
        // `{"error", "message"}` shape the rest of the API uses.
        if let errorBody = try? decoder.decode(OAuthErrorBody.self, from: data) {
            throw DeviceFlowError.oauth(DeviceFlowErrorCode(wireValue: errorBody.error))
        }

        throw DeviceFlowError.http(status: httpResponse.statusCode, body: data)
    }

    private func makeJSONRequest<Body: Encodable>(path: String, body: Body) throws -> URLRequest {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw DeviceFlowError.invalidBaseURL
        }
        components.path += path
        guard let url = components.url else {
            throw DeviceFlowError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            request.httpBody = try encoder.encode(body)
        } catch {
            throw DeviceFlowError.decoding(error)
        }
        return request
    }

    private func performRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw DeviceFlowError.transport(error)
        }
    }

    private static func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeviceFlowError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw DeviceFlowError.http(status: httpResponse.statusCode, body: data)
        }
    }
}
