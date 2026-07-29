import Foundation

// MARK: - Hosted device link (playarr.app)
//
// First-contact pairing for packaged TV/mobile clients that do not yet know
// any Playarr Server URL. Mirrors `clients/tv-web/web/src/lib/hostedDeviceLink.ts`
// and `clients/android/.../HostedDeviceLinkClient.kt`:
//
//   1. POST https://playarr.app/api/link/code  → user code + device secret
//   2. Show verification URI / QR; phone picks a profile and authorises
//   3. GET  https://playarr.app/api/link/code/{device_code} until claim
//   4. Claim carries server_url + server_device_code (+ server_urls)
//   5. Caller polls the *real* server token endpoint with server_device_code
//
// The API host is never same-origin with the TV app; the linking device is
// the source of the server URL.

/// Wire body of a successful hosted-link poll (`GET /api/link/code/{device}`).
public struct HostedLinkClaim: Codable, Sendable, Equatable {
    public var userCode: String?
    public var serverURL: String
    public var serverDeviceCode: String
    public var serverURLs: [String]

    enum CodingKeys: String, CodingKey {
        case userCode = "user_code"
        case serverURL = "server_url"
        case serverDeviceCode = "server_device_code"
        case serverURLs = "server_urls"
    }

    public init(
        userCode: String? = nil,
        serverURL: String,
        serverDeviceCode: String,
        serverURLs: [String]
    ) {
        self.userCode = userCode
        self.serverURL = serverURL
        self.serverDeviceCode = serverDeviceCode
        self.serverURLs = serverURLs
    }
}

public enum HostedDeviceLinkError: Error, Sendable, Equatable {
    case invalidBaseURL
    case invalidResponse
    case http(status: Int)
    case expired
    case invalidClaim
    case transportMessage(String)
}

/// Where playarr.app exposes the short-lived link broker.
public struct HostedDeviceLinkConfiguration: Sendable {
    public var origin: URL
    public var clientPlatform: ClientPlatform
    public var codePath: String
    public var pollPathPrefix: String

    public static let playarrAppOrigin = URL(string: "https://playarr.app")!

    public init(
        origin: URL = HostedDeviceLinkConfiguration.playarrAppOrigin,
        clientPlatform: ClientPlatform = .ios,
        codePath: String = "/api/link/code",
        pollPathPrefix: String = "/api/link/code/"
    ) {
        self.origin = origin
        self.clientPlatform = clientPlatform
        self.codePath = codePath
        self.pollPathPrefix = pollPathPrefix
    }
}

/// Coordinates server-free first contact through playarr.app.
public actor HostedDeviceLinkClient {
    private let configuration: HostedDeviceLinkConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(
        configuration: HostedDeviceLinkConfiguration = .init(),
        session: URLSession = .shared
    ) {
        self.configuration = configuration
        self.session = session
        self.decoder = PlayarrJSONCoding.makeDecoder()
        self.encoder = PlayarrJSONCoding.makeEncoder()
    }

    /// PNG QR for a verification URL, served by the same hosted broker
    /// (`GET /api/link/qr?value=…`). Callers may load this with `AsyncImage`.
    public nonisolated static func qrImageURL(
        for verificationURIComplete: String,
        origin: URL = HostedDeviceLinkConfiguration.playarrAppOrigin
    ) -> URL? {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        components?.path = "/api/link/qr"
        components?.queryItems = [URLQueryItem(name: "value", value: verificationURIComplete)]
        return components?.url
    }

    /// `POST /api/link/code` — request a hosted user code before any server URL is known.
    public func requestCode() async throws -> DeviceCodeResponse {
        let body = DeviceCodeRequest(clientPlatform: configuration.clientPlatform)
        let request = try makeJSONRequest(path: configuration.codePath, body: body)
        let (data, response) = try await perform(request)
        try Self.validateOK(response: response, data: data)
        do {
            return try decoder.decode(DeviceCodeResponse.self, from: data)
        } catch {
            throw HostedDeviceLinkError.invalidResponse
        }
    }

    /// Polls until the phone-side claim arrives, the code expires, or the task is cancelled.
    ///
    /// - Parameter extraGrace: Seconds to keep polling after `expires_in` (web
    ///   `HOSTED_LINK_CLAIM_REDEMPTION_GRACE_MS`, default 0). Callers that auto-
    ///   renew the code should pass ~30 so a last-second phone claim still wins.
    public func pollUntilClaim(
        _ code: DeviceCodeResponse,
        extraGrace: TimeInterval = 0
    ) async throws -> HostedLinkClaim {
        let lifetime = TimeInterval(max(code.expiresIn, 1)) + max(0, extraGrace)
        let deadline = Date().addingTimeInterval(lifetime)
        let interval = max(TimeInterval(code.interval), 1)

        while true {
            if Date() >= deadline {
                throw HostedDeviceLinkError.expired
            }
            try await Task.sleep(for: .milliseconds(Int(interval * 1000)))
            try Task.checkCancellation()

            let request = try makeGETRequest(
                path: configuration.pollPathPrefix + code.deviceCode
            )
            let (data, response) = try await perform(request)
            guard let http = response as? HTTPURLResponse else {
                throw HostedDeviceLinkError.invalidResponse
            }

            switch http.statusCode {
            case 202:
                continue
            case 404:
                // Broker has dropped the code — same silent-renew path as web.
                throw HostedDeviceLinkError.expired
            case 200:
                return try decodeClaim(data)
            default:
                throw HostedDeviceLinkError.http(status: http.statusCode)
            }
        }
    }

    // MARK: - Private

    private func decodeClaim(_ data: Data) throws -> HostedLinkClaim {
        do {
            let claim = try decoder.decode(HostedLinkClaim.self, from: data)
            guard !claim.serverURL.isEmpty, !claim.serverDeviceCode.isEmpty else {
                throw HostedDeviceLinkError.invalidClaim
            }
            return claim
        } catch let error as HostedDeviceLinkError {
            throw error
        } catch {
            throw HostedDeviceLinkError.invalidClaim
        }
    }

    private func makeJSONRequest<Body: Encodable>(path: String, body: Body) throws -> URLRequest {
        guard var components = URLComponents(url: configuration.origin, resolvingAgainstBaseURL: false) else {
            throw HostedDeviceLinkError.invalidBaseURL
        }
        components.path = path
        guard let url = components.url else {
            throw HostedDeviceLinkError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try encoder.encode(body)
        return request
    }

    private func makeGETRequest(path: String) throws -> URLRequest {
        guard var components = URLComponents(url: configuration.origin, resolvingAgainstBaseURL: false) else {
            throw HostedDeviceLinkError.invalidBaseURL
        }
        components.path = path
        guard let url = components.url else {
            throw HostedDeviceLinkError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw HostedDeviceLinkError.transportMessage(error.localizedDescription)
        }
    }

    private static func validateOK(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw HostedDeviceLinkError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw HostedDeviceLinkError.http(status: http.statusCode)
        }
    }
}
