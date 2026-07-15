import Foundation

// MARK: - RFC 8628 wire types

/// Response to the "device authorization request" (RFC 8628 §3.1/§3.2).
public struct DeviceAuthorizationResponse: Codable, Sendable {
    public let deviceCode: String
    public let userCode: String
    public let verificationURI: URL
    public let verificationURIComplete: URL?
    public let expiresIn: Int
    public let interval: Int?

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURI = "verification_uri"
        case verificationURIComplete = "verification_uri_complete"
        case expiresIn = "expires_in"
        case interval
    }
}

/// A successful response from the token endpoint (RFC 8628 §3.5, borrowing
/// RFC 6749 §5.1's access token response shape).
public struct DeviceTokenResponse: Codable, Sendable {
    public let accessToken: String
    public let tokenType: String
    public let expiresIn: Int?
    public let refreshToken: String?
    public let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case scope
    }
}

/// The `error` values the token endpoint can return while polling (RFC
/// 8628 §3.5), plus the standard RFC 6749 §5.2 error codes it can also
/// return on a malformed request.
public enum DeviceFlowErrorCode: String, Codable, Sendable {
    case authorizationPending = "authorization_pending"
    case slowDown = "slow_down"
    case accessDenied = "access_denied"
    case expiredToken = "expired_token"
    case invalidGrant = "invalid_grant"
    case invalidRequest = "invalid_request"
    case invalidClient = "invalid_client"
    case unsupportedGrantType = "unsupported_grant_type"
}

/// An OAuth-shaped `{"error": "...", "error_description": "..."}` body.
public struct DeviceFlowErrorResponse: Codable, Sendable {
    public let error: DeviceFlowErrorCode
    public let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

public enum DeviceFlowError: Error, Sendable {
    case invalidResponse
    case http(status: Int, body: Data?)
    case oauth(DeviceFlowErrorCode, description: String?)
    case authorizationExpired
    case accessDenied
    case transport(Error)
    case decoding(Error)
}

/// Where to find the device-authorization and token endpoints, and which
/// OAuth client this app identifies as.
public struct DeviceFlowConfiguration: Sendable {
    public var authorizationServerURL: URL
    public var clientID: String
    public var scope: String?
    public var deviceAuthorizationPath: String
    public var tokenPath: String

    public init(
        authorizationServerURL: URL,
        clientID: String,
        scope: String? = "offline_access",
        deviceAuthorizationPath: String = "/oauth/device/code",
        tokenPath: String = "/oauth/token"
    ) {
        self.authorizationServerURL = authorizationServerURL
        self.clientID = clientID
        self.scope = scope
        self.deviceAuthorizationPath = deviceAuthorizationPath
        self.tokenPath = tokenPath
    }
}

/// Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) against the
/// Streamarr auth server, for sign-in flows where typing a password on the
/// device itself is inconvenient (tvOS in particular; also usable from
/// iOS as a "sign in with a code on another device" option).
///
/// Usage:
/// ```swift
/// let client = DeviceFlowClient(configuration: .init(
///     authorizationServerURL: serverBaseURL,
///     clientID: "streamarr-ios"
/// ))
/// let token = try await client.authorize { pending in
///     // Show `pending.userCode` / `pending.verificationURI` to the user.
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
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    /// RFC 8628 §3.1/§3.2: request a device code + user code from the
    /// authorization server.
    public func requestDeviceCode() async throws -> DeviceAuthorizationResponse {
        var parameters = [("client_id", configuration.clientID)]
        if let scope = configuration.scope {
            parameters.append(("scope", scope))
        }

        let request = makeFormRequest(path: configuration.deviceAuthorizationPath, parameters: parameters)
        let (data, response) = try await performRequest(request)
        try Self.validate(response: response, data: data)

        do {
            return try decoder.decode(DeviceAuthorizationResponse.self, from: data)
        } catch {
            throw DeviceFlowError.decoding(error)
        }
    }

    /// RFC 8628 §3.4/§3.5: poll the token endpoint at the server-specified
    /// interval until the user completes authorization, the code expires,
    /// or access is denied. Honors `slow_down` by increasing the poll
    /// interval by 5 seconds, per §3.5.
    public func pollForToken(
        deviceCode: String,
        interval: TimeInterval,
        expiresIn: TimeInterval
    ) async throws -> DeviceTokenResponse {
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
            } catch let DeviceFlowError.oauth(code, description) {
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
                default:
                    throw DeviceFlowError.oauth(code, description: description)
                }
            }
        }
    }

    /// Convenience wrapper that runs both RFC 8628 steps: requests a
    /// device code, hands it to `onAuthorizationPending` so the caller can
    /// show the user code/verification URL, then blocks on the poll loop
    /// until the user finishes (or the flow expires/is denied).
    public func authorize(
        onAuthorizationPending: @Sendable (DeviceAuthorizationResponse) -> Void
    ) async throws -> DeviceTokenResponse {
        let deviceAuth = try await requestDeviceCode()
        onAuthorizationPending(deviceAuth)
        return try await pollForToken(
            deviceCode: deviceAuth.deviceCode,
            interval: TimeInterval(deviceAuth.interval ?? 5),
            expiresIn: TimeInterval(deviceAuth.expiresIn)
        )
    }

    // MARK: - Private

    private func requestToken(deviceCode: String) async throws -> DeviceTokenResponse {
        let parameters = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", deviceCode),
            ("client_id", configuration.clientID)
        ]

        let request = makeFormRequest(path: configuration.tokenPath, parameters: parameters)
        let (data, response) = try await performRequest(request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DeviceFlowError.invalidResponse
        }

        if httpResponse.statusCode == 200 {
            do {
                return try decoder.decode(DeviceTokenResponse.self, from: data)
            } catch {
                throw DeviceFlowError.decoding(error)
            }
        }

        if let errorBody = try? decoder.decode(DeviceFlowErrorResponse.self, from: data) {
            throw DeviceFlowError.oauth(errorBody.error, description: errorBody.errorDescription)
        }

        throw DeviceFlowError.http(status: httpResponse.statusCode, body: data)
    }

    private func makeFormRequest(path: String, parameters: [(String, String)]) -> URLRequest {
        var url = configuration.authorizationServerURL
        url.append(path: path)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Self.formEncode(parameters)
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

    /// `application/x-www-form-urlencoded` encoding per RFC 3986's
    /// unreserved character set — deliberately not relying on
    /// `URLComponents.percentEncodedQuery`, which doesn't guarantee the
    /// same escaping every OAuth server implementation expects.
    private static func formEncode(_ parameters: [(String, String)]) -> Data {
        let encoded = parameters
            .map { key, value in "\(formEncodeComponent(key))=\(formEncodeComponent(value))" }
            .joined(separator: "&")
        return Data(encoded.utf8)
    }

    private static func formEncodeComponent(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
