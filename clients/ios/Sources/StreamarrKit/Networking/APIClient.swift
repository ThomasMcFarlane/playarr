import Foundation

// MARK: - Generated-client notice
//
// `StreamarrAPIClient`/`APIClient` below is a real, working, async/await
// `URLSession`-based client for every operation in
// `backend/openapi/streamarr.yaml` *except* the two RFC 8628 OAuth device
// flow endpoints (`POST /api/v1/oauth/device/code`, `POST
// /api/v1/oauth/token`), which live in `Auth/DeviceFlowClient.swift`
// instead — that's a deliberate split, not a gap: the device flow has its
// own unauthenticated, polling-with-backoff shape that doesn't fit this
// client's "one call in, one typed result (or typed error) out" pattern,
// and `DeviceFlowClient` already existed as the app's dedicated component
// for it. Together the two components cover all of the spec's paths and
// operations:
//   - system: GET /api/system/health, /ready, /version
//   - auth: POST /api/v1/auth/login, /api/v1/auth/refresh
//   - catalog: GET /api/v1/catalog, /api/v1/catalog/search,
//     /api/v1/catalog/{id}
//   - playback: GET /api/v1/playback/{media_file_id}
//   - webhooks: POST /webhooks/{instance_id}
//   - oauth (in DeviceFlowClient.swift): POST /api/v1/oauth/device/code,
//     POST /api/v1/oauth/token
//
// Request/response Codable types live in `OpenAPISchemas.swift` in this
// same directory — see that file's header for how they were produced and
// checked against the spec/backend source.
//
// Catalog and playback operations require a bearer token. `APIClient`
// obtains one from the shared session store, rotates an expiring session
// through `/api/v1/auth/refresh`, or attempts credential-less trusted-network
// login when no usable session remains.

/// Configuration for talking to one Streamarr server instance. `baseURL` is
/// the one thing that must be user-configurable per the architecture
/// principle that a client points at an arbitrary operator-run instance —
/// see `AppEnvironment` in `StreamarrApp` for the UserDefaults-backed
/// setting that drives this.
public struct APIClientConfiguration: Sendable {
    public var baseURL: URL
    public var clientPlatform: ClientPlatform
    public var clientVersion: String
    /// `LoginRequest.deviceID`/`.deviceName` a caller can use to build a
    /// `LoginRequest` for `login(_:)`. Real callers (`AppEnvironment`)
    /// should pass a `deviceID` persisted per-install, not a fresh
    /// `UUID()` per launch — see `LoginRequest.deviceID`'s doc comment in
    /// `OpenAPISchemas.swift` for why. The defaults here exist only for
    /// callers (previews, ad hoc construction) that never exercise the
    /// login path.
    public var deviceID: UUID
    public var deviceName: String
    public var urlSessionConfiguration: URLSessionConfiguration

    public init(
        baseURL: URL,
        clientPlatform: ClientPlatform = .ios,
        clientVersion: String = "0.1.0",
        deviceID: UUID = UUID(),
        deviceName: String = "Streamarr Client",
        urlSessionConfiguration: URLSessionConfiguration = .default
    ) {
        self.baseURL = baseURL
        self.clientPlatform = clientPlatform
        self.clientVersion = clientVersion
        self.deviceID = deviceID
        self.deviceName = deviceName
        self.urlSessionConfiguration = urlSessionConfiguration
    }
}

public struct StoredAuthSession: Codable, Sendable, Equatable {
    public var accessToken: Sensitive<String>
    public var refreshToken: Sensitive<String>
    public var tokenType: String
    public var expiresAt: Date

    public init(accessToken: String, refreshToken: String, tokenType: String, expiresAt: Date) {
        self.accessToken = Sensitive(accessToken)
        self.refreshToken = Sensitive(refreshToken)
        self.tokenType = tokenType
        self.expiresAt = expiresAt
    }
}

/// Shared persistence boundary for sessions obtained by transparent login,
/// refresh-token rotation, or RFC 8628 device pairing.
public protocol AccessTokenProviding: Sendable {
    func currentSession() async -> StoredAuthSession?
    func storeSession(_ session: StoredAuthSession) async throws
    func clearSession() async throws
}

/// Errors this client can throw. Status-code-specific cases carry the
/// server's `{"error": "<code>", "message": "<...>"}` body (see
/// `APIErrorBody` in `OpenAPISchemas.swift`) when the body decoded as one,
/// so callers/UI can show the real server-provided message rather than a
/// generic one.
public enum APIError: Error, Sendable {
    case invalidBaseURL
    case transport(Error)
    case invalidResponse
    case decoding(Error)
    case unauthorized(APIErrorBody?)
    /// `404` — e.g. `GET /api/v1/catalog/{id}` for an unknown work,
    /// `GET /api/v1/playback/{media_file_id}` for an unknown media file,
    /// `POST /webhooks/{instance_id}` for an unknown source instance.
    case notFound(APIErrorBody?)
    /// `409` — no current operation in this client's coverage documents a
    /// 409 response; kept for forward compatibility with the generic
    /// `{"error": "<code>", "message": "<...>"}` error shape.
    case conflict(APIErrorBody?)
    /// `422` — no current operation in this client's coverage documents a
    /// 422 response; kept for forward compatibility with the generic
    /// `{"error": "<code>", "message": "<...>"}` error shape.
    case unprocessableEntity(APIErrorBody?)
    /// `503` — `GET /api/v1/playback/{media_file_id}` with no on-demand
    /// transcode capacity available on this node.
    case serviceUnavailable(APIErrorBody?)
    /// Any other non-2xx status not covered above.
    case http(status: Int, body: APIErrorBody?, rawBody: Data?)

    /// A message worth showing a user, preferring the server's own
    /// `message` field when one was decoded.
    public var displayMessage: String {
        switch self {
        case .invalidBaseURL: return "The server URL isn't valid."
        case .transport(let error): return error.localizedDescription
        case .invalidResponse: return "The server sent back a response we couldn't understand."
        case .decoding: return "The server's response didn't match what this app expected."
        case .unauthorized(let body): return body?.message ?? "You're not signed in."
        case .notFound(let body): return body?.message ?? "That wasn't found."
        case .conflict(let body): return body?.message ?? "That request already changed state."
        case .unprocessableEntity(let body): return body?.message ?? "The server couldn't fulfil that."
        case .serviceUnavailable(let body): return body?.message ?? "The server can't handle that right now."
        case .http(let status, let body, _): return body?.message ?? "The server returned an unexpected error (\(status))."
        }
    }
}

/// The shape of the Streamarr HTTP API this app depends on (minus the
/// OAuth device flow — see the header note above), independent of how a
/// request actually gets made.
public protocol StreamarrAPIClient: Sendable {
    /// The server this client is configured to talk to — exposed so
    /// callers can resolve server-relative URLs the API hands back (e.g.
    /// `PlaybackInfoResponse.url`) without needing their own copy of it.
    var baseURL: URL { get }

    // System
    func fetchHealth() async throws
    func fetchReadiness() async throws
    func fetchVersion() async throws -> VersionEnvelope

    // Auth
    /// `POST /api/v1/auth/login`. Exposed on the protocol for a caller that
    /// wants an explicit sign-in affordance (e.g. a future
    /// non-trusted-network login screen); no operation this client drives
    /// calls it on the caller's behalf.
    func login(_ body: LoginRequest) async throws -> LoginResponse

    // Catalog
    func browseCatalog(
        kind: WorkKind?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> CatalogPage

    func searchCatalog(query: String, limit: Int?) async throws -> [Work]
    func fetchWork(id: UUID) async throws -> WorkDetail

    // Playback
    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse

    // Webhooks — primarily for admin/debug tooling; a normal client screen
    // has no reason to POST here (this is the *arr apps' job), but it's
    // wired for completeness against the spec.
    func sendWebhook(instanceID: UUID, payload: Data) async throws

    /// Resolves a possibly-relative URL string (as returned by
    /// `PlaybackInfoResponse.url`) against `baseURL`.
    func resolvedURL(forPath path: String) -> URL?
}

/// Real, working `URLSession`-backed implementation of `StreamarrAPIClient`.
public final class APIClient: StreamarrAPIClient {
    private let configuration: APIClientConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let accessTokenCoordinator: AccessTokenCoordinator?

    public init(
        configuration: APIClientConfiguration,
        tokenProvider: AccessTokenProviding? = nil,
        session: URLSession? = nil
    ) {
        let resolvedSession = session ?? URLSession(configuration: configuration.urlSessionConfiguration)
        self.configuration = configuration
        self.session = resolvedSession
        self.decoder = StreamarrJSONCoding.makeDecoder()
        self.encoder = StreamarrJSONCoding.makeEncoder()
        self.accessTokenCoordinator = tokenProvider.map {
            AccessTokenCoordinator(
                configuration: configuration,
                tokenProvider: $0,
                session: resolvedSession
            )
        }
    }

    public var baseURL: URL { configuration.baseURL }

    // MARK: System

    public func fetchHealth() async throws {
        try await sendNoBody(path: "/api/system/health", method: "GET")
    }

    public func fetchReadiness() async throws {
        try await sendNoBody(path: "/api/system/ready", method: "GET")
    }

    public func fetchVersion() async throws -> VersionEnvelope {
        try await get("/api/system/version", authenticated: false)
    }

    // MARK: Auth

    public func login(_ body: LoginRequest) async throws -> LoginResponse {
        try await post("/api/v1/auth/login", body: body)
    }

    public func refresh(_ body: RefreshRequest) async throws -> RefreshResponse {
        try await post("/api/v1/auth/refresh", body: body)
    }

    // MARK: Catalog

    public func browseCatalog(
        kind: WorkKind? = nil,
        genre: String? = nil,
        tag: String? = nil,
        sort: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) async throws -> CatalogPage {
        var query: [URLQueryItem] = []
        if let kind { query.append(URLQueryItem(name: "kind", value: kind.rawValue)) }
        if let genre { query.append(URLQueryItem(name: "genre", value: genre)) }
        if let tag { query.append(URLQueryItem(name: "tag", value: tag)) }
        if let sort { query.append(URLQueryItem(name: "sort", value: sort)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let offset { query.append(URLQueryItem(name: "offset", value: String(offset))) }
        return try await get("/api/v1/catalog", query: query)
    }

    public func searchCatalog(query searchQuery: String, limit: Int? = nil) async throws -> [Work] {
        var query = [URLQueryItem(name: "q", value: searchQuery)]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await get("/api/v1/catalog/search", query: query)
    }

    public func fetchWork(id: UUID) async throws -> WorkDetail {
        try await get("/api/v1/catalog/\(id.uuidString)")
    }

    // MARK: Playback

    public func playbackInfo(
        mediaFileID: UUID,
        containers: [String] = [],
        videoCodecs: [String] = [],
        audioCodecs: [String] = [],
        maxBitrateBps: Int64? = nil,
        profile: String? = nil
    ) async throws -> PlaybackInfoResponse {
        var query: [URLQueryItem] = []
        if !containers.isEmpty { query.append(URLQueryItem(name: "containers", value: containers.joined(separator: ","))) }
        if !videoCodecs.isEmpty { query.append(URLQueryItem(name: "video_codecs", value: videoCodecs.joined(separator: ","))) }
        if !audioCodecs.isEmpty { query.append(URLQueryItem(name: "audio_codecs", value: audioCodecs.joined(separator: ","))) }
        if let maxBitrateBps { query.append(URLQueryItem(name: "max_bitrate_bps", value: String(maxBitrateBps))) }
        if let profile { query.append(URLQueryItem(name: "profile", value: profile)) }
        return try await get("/api/v1/playback/\(mediaFileID.uuidString)", query: query)
    }

    // MARK: Webhooks

    public func sendWebhook(instanceID: UUID, payload: Data) async throws {
        // Unauthenticated by design — this is the *arr apps' own inbound
        // signal, not something this client's user session gates.
        var request = try makeRequest(path: "/webhooks/\(instanceID.uuidString)", method: "POST", query: [])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = payload
        _ = try await sendRaw(request, expectedStatuses: [202])
    }

    public func resolvedURL(forPath path: String) -> URL? {
        URL(string: path, relativeTo: configuration.baseURL)?.absoluteURL
    }

    // MARK: - Request helpers
    //
    // Catalog/playback GETs attach auth. System, login/refresh and webhook
    // requests stay public.

    private func get<T: Decodable>(
        _ path: String,
        query: [URLQueryItem] = [],
        authenticated: Bool = true
    ) async throws -> T {
        var request = try makeRequest(path: path, method: "GET", query: query)
        if authenticated {
            try await attachAuthorization(to: &request)
        }
        do {
            return try await send(request)
        } catch APIError.unauthorized where authenticated && accessTokenCoordinator != nil {
            try await attachAuthorization(to: &request, forceRefresh: true)
            return try await send(request)
        }
    }

    private func post<Body: Encodable, T: Decodable>(
        _ path: String,
        body: Body,
        expectedStatuses: Set<Int> = [200]
    ) async throws -> T {
        var request = try makeRequest(path: path, method: "POST", query: [])
        try attachBody(body, to: &request)
        return try await send(request, expectedStatuses: expectedStatuses)
    }

    private func sendNoBody(path: String, method: String, query: [URLQueryItem] = []) async throws {
        let request = try makeRequest(path: path, method: method, query: query)
        _ = try await sendRaw(request, expectedStatuses: Set(200..<300))
    }

    private func makeRequest(path: String, method: String, query: [URLQueryItem]) throws -> URLRequest {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidBaseURL
        }
        // `path` is always a literal, absolute API path (e.g.
        // "/api/v1/catalog") — appending (not replacing) `components.path`
        // preserves a `baseURL` that itself has a path component (e.g. an
        // operator serving Streamarr behind a reverse-proxy prefix).
        components.path += path
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else {
            throw APIError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.clientPlatform.rawValue, forHTTPHeaderField: "X-Streamarr-Client-Platform")
        request.setValue(configuration.clientVersion, forHTTPHeaderField: "X-Streamarr-Client-Version")
        return request
    }

    private func attachBody<Body: Encodable>(_ body: Body, to request: inout URLRequest) throws {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try encoder.encode(body)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func send<T: Decodable>(_ request: URLRequest, expectedStatuses: Set<Int> = [200]) async throws -> T {
        let data = try await sendRaw(request, expectedStatuses: expectedStatuses)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// Performs the request, validates the status code, and returns the raw
    /// body — the one place every status-code-to-`APIError` mapping lives.
    @discardableResult
    private func sendRaw(_ request: URLRequest, expectedStatuses: Set<Int>) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if expectedStatuses.contains(httpResponse.statusCode) {
            return data
        }

        let errorBody = try? decoder.decode(APIErrorBody.self, from: data)
        switch httpResponse.statusCode {
        case 401:
            throw APIError.unauthorized(errorBody)
        case 404:
            throw APIError.notFound(errorBody)
        case 409:
            throw APIError.conflict(errorBody)
        case 422:
            throw APIError.unprocessableEntity(errorBody)
        case 503:
            throw APIError.serviceUnavailable(errorBody)
        default:
            throw APIError.http(status: httpResponse.statusCode, body: errorBody, rawBody: data)
        }
    }

    private func attachAuthorization(to request: inout URLRequest, forceRefresh: Bool = false) async throws {
        guard let accessTokenCoordinator else { return }
        let token = try await accessTokenCoordinator.accessToken(forceRefresh: forceRefresh)
        request.setValue("Bearer \(token.exposeSecret())", forHTTPHeaderField: "Authorization")
    }
}

private actor AccessTokenCoordinator {
    private let configuration: APIClientConfiguration
    private let tokenProvider: AccessTokenProviding
    private let session: URLSession
    private let decoder = StreamarrJSONCoding.makeDecoder()
    private let encoder = StreamarrJSONCoding.makeEncoder()
    private var inFlight: Task<Sensitive<String>, Error>?

    init(configuration: APIClientConfiguration, tokenProvider: AccessTokenProviding, session: URLSession) {
        self.configuration = configuration
        self.tokenProvider = tokenProvider
        self.session = session
    }

    func accessToken(forceRefresh: Bool) async throws -> Sensitive<String> {
        if let inFlight { return try await inFlight.value }
        let task = Task { try await self.acquireAccessToken(forceRefresh: forceRefresh) }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }

    private func acquireAccessToken(forceRefresh: Bool) async throws -> Sensitive<String> {
        let existing = await tokenProvider.currentSession()
        if !forceRefresh,
           let existing,
           existing.expiresAt > Date().addingTimeInterval(120) {
            return existing.accessToken
        }

        if let existing {
            do {
                let refreshed: RefreshResponse = try await post(
                    path: "/api/v1/auth/refresh",
                    body: RefreshRequest(
                        deviceID: configuration.deviceID,
                        refreshToken: existing.refreshToken.exposeSecret()
                    )
                )
                let stored = StoredAuthSession(
                    accessToken: refreshed.accessToken,
                    refreshToken: refreshed.refreshToken,
                    tokenType: refreshed.tokenType,
                    expiresAt: Date().addingTimeInterval(TimeInterval(refreshed.expiresIn))
                )
                try await tokenProvider.storeSession(stored)
                return stored.accessToken
            } catch {
                try? await tokenProvider.clearSession()
            }
        }

        let loggedIn: LoginResponse = try await post(
            path: "/api/v1/auth/login",
            body: LoginRequest(
                deviceID: configuration.deviceID,
                deviceName: configuration.deviceName,
                clientPlatform: configuration.clientPlatform,
                clientVersion: configuration.clientVersion
            )
        )
        let stored = StoredAuthSession(
            accessToken: loggedIn.accessToken,
            refreshToken: loggedIn.refreshToken,
            tokenType: loggedIn.tokenType,
            expiresAt: Date().addingTimeInterval(TimeInterval(loggedIn.expiresIn))
        )
        try await tokenProvider.storeSession(stored)
        return stored.accessToken
    }

    private func post<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidBaseURL
        }
        components.path += path
        guard let url = components.url else { throw APIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.clientPlatform.rawValue, forHTTPHeaderField: "X-Streamarr-Client-Platform")
        request.setValue(configuration.clientVersion, forHTTPHeaderField: "X-Streamarr-Client-Version")
        request.httpBody = try encoder.encode(body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard http.statusCode == 200 else {
            let body = try? decoder.decode(APIErrorBody.self, from: data)
            if http.statusCode == 401 { throw APIError.unauthorized(body) }
            throw APIError.http(status: http.statusCode, body: body, rawBody: data)
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
