import Foundation

// MARK: - Placeholder notice
//
// This file is a hand-written stand-in for the client `openapi-generator`
// (`-g swift5`) will eventually produce from `backend/openapi/`'s spec.
// That spec doesn't exist in the tree yet, so there is nothing to generate
// against. Until it does:
//
//   1. `StreamarrAPIClient` below is the protocol the rest of the app
//      (view models in `StreamarrApp/ViewModels`) codes against — never
//      `APIClient` the concrete class directly — so swapping in generated
//      code later is a one-line dependency-injection change, not a
//      call-site rewrite.
//   2. `APIClient` is a real, working `URLSession`-based implementation of
//      that protocol, with the request/response plumbing (auth headers,
//      JSON coding, error mapping) a generated client would also need.
//   3. Once `backend/openapi/openapi.yaml` (or `.json`) exists, run
//      something like:
//        openapi-generator-cli generate \
//          -g swift5 -i backend/openapi/openapi.yaml \
//          -o clients/ios/Sources/StreamarrKit/Generated \
//          --additional-properties=library=urlsession,responseAs=AsyncAwait
//      add the generated folder as a second target (or source group) in
//      `Package.swift`, make its generated client type conform to
//      `StreamarrAPIClient`, and delete this file's hand-rolled `APIClient`
//      (keep the protocol).

/// Configuration for talking to one Streamarr server instance.
public struct APIClientConfiguration: Sendable {
    public var baseURL: URL
    public var apiVersion: String
    public var clientPlatform: ClientPlatform
    public var clientVersion: String
    public var urlSessionConfiguration: URLSessionConfiguration

    public init(
        baseURL: URL,
        apiVersion: String = "v1",
        clientPlatform: ClientPlatform = .ios,
        clientVersion: String = "0.1.0",
        urlSessionConfiguration: URLSessionConfiguration = .default
    ) {
        self.baseURL = baseURL
        self.apiVersion = apiVersion
        self.clientPlatform = clientPlatform
        self.clientVersion = clientVersion
        self.urlSessionConfiguration = urlSessionConfiguration
    }
}

/// Supplies (and refreshes) the bearer token attached to authenticated
/// requests. `DeviceFlowClient` (see `Auth/DeviceFlowClient.swift`)
/// produces the initial token pair; a concrete conformer typically
/// persists it in the Keychain and refreshes it before it expires.
public protocol AccessTokenProviding: Sendable {
    func currentAccessToken() async -> Sensitive<String>?
    func refreshAccessToken() async throws -> Sensitive<String>
}

public enum APIError: Error, Sendable {
    case invalidBaseURL
    case transport(Error)
    case invalidResponse
    case http(status: Int, body: Data?)
    case decoding(Error)
    case unauthorized
    case notImplemented(String)
}

/// The shape of the Streamarr HTTP API this app depends on, independent of
/// how a request actually gets made. See the placeholder notice above.
public protocol StreamarrAPIClient: Sendable {
    func fetchVersionEnvelope() async throws -> VersionEnvelope

    func fetchLibraries() async throws -> [SourceInstance]
    func fetchWorks(libraryID: UUID?, page: Int, pageSize: Int) async throws -> [Work]
    func fetchWork(id: UUID) async throws -> Work
    func fetchSeries(workID: UUID) async throws -> Series
    func fetchSeasons(seriesID: UUID) async throws -> [Season]
    func fetchEpisodes(seasonID: UUID) async throws -> [Episode]
    func fetchMediaFiles(workID: UUID) async throws -> [MediaFile]
    func fetchContinueWatching(limit: Int) async throws -> [PlaybackSession]

    func startPlaybackSession(workID: UUID, mediaFileID: UUID, deviceID: UUID) async throws -> PlaybackSession
    func recordPlaybackEvent(_ event: PlaybackEvent) async throws
    func endPlaybackSession(id: UUID, stopReason: StopReason) async throws

    func fetchCurrentUser() async throws -> User
}

/// Hand-written `URLSession`-backed implementation of `StreamarrAPIClient`.
/// See the placeholder notice at the top of this file.
public final class APIClient: StreamarrAPIClient {
    private let configuration: APIClientConfiguration
    private let session: URLSession
    private let tokenProvider: AccessTokenProviding?
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(
        configuration: APIClientConfiguration,
        tokenProvider: AccessTokenProviding? = nil,
        session: URLSession? = nil
    ) {
        self.configuration = configuration
        self.session = session ?? URLSession(configuration: configuration.urlSessionConfiguration)
        self.tokenProvider = tokenProvider

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    // MARK: StreamarrAPIClient

    public func fetchVersionEnvelope() async throws -> VersionEnvelope {
        try await get("/version")
    }

    public func fetchLibraries() async throws -> [SourceInstance] {
        try await get(versionedPath("/libraries"))
    }

    public func fetchWorks(libraryID: UUID? = nil, page: Int = 1, pageSize: Int = 50) async throws -> [Work] {
        var query = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "page_size", value: String(pageSize))
        ]
        if let libraryID {
            query.append(URLQueryItem(name: "source_instance_id", value: libraryID.uuidString))
        }
        return try await get(versionedPath("/works"), query: query)
    }

    public func fetchWork(id: UUID) async throws -> Work {
        try await get(versionedPath("/works/\(id.uuidString)"))
    }

    public func fetchSeries(workID: UUID) async throws -> Series {
        try await get(versionedPath("/works/\(workID.uuidString)/series"))
    }

    public func fetchSeasons(seriesID: UUID) async throws -> [Season] {
        try await get(versionedPath("/series/\(seriesID.uuidString)/seasons"))
    }

    public func fetchEpisodes(seasonID: UUID) async throws -> [Episode] {
        try await get(versionedPath("/seasons/\(seasonID.uuidString)/episodes"))
    }

    public func fetchMediaFiles(workID: UUID) async throws -> [MediaFile] {
        try await get(versionedPath("/works/\(workID.uuidString)/media-files"))
    }

    public func fetchContinueWatching(limit: Int = 20) async throws -> [PlaybackSession] {
        try await get(versionedPath("/playback/continue-watching"), query: [
            URLQueryItem(name: "limit", value: String(limit))
        ])
    }

    public func startPlaybackSession(workID: UUID, mediaFileID: UUID, deviceID: UUID) async throws -> PlaybackSession {
        struct Body: Encodable {
            let workID: UUID
            let mediaFileID: UUID
            let deviceID: UUID

            enum CodingKeys: String, CodingKey {
                case workID = "work_id"
                case mediaFileID = "media_file_id"
                case deviceID = "device_id"
            }
        }
        return try await post(
            versionedPath("/playback/sessions"),
            body: Body(workID: workID, mediaFileID: mediaFileID, deviceID: deviceID)
        )
    }

    public func recordPlaybackEvent(_ event: PlaybackEvent) async throws {
        let _: EmptyResponse = try await post(versionedPath("/playback/events"), body: event)
    }

    public func endPlaybackSession(id: UUID, stopReason: StopReason) async throws {
        struct Body: Encodable {
            let stopReason: StopReason

            enum CodingKeys: String, CodingKey {
                case stopReason = "stop_reason"
            }
        }
        let _: EmptyResponse = try await post(
            versionedPath("/playback/sessions/\(id.uuidString)/stop"),
            body: Body(stopReason: stopReason)
        )
    }

    public func fetchCurrentUser() async throws -> User {
        try await get(versionedPath("/users/me"))
    }

    // MARK: - Request plumbing

    private func versionedPath(_ path: String) -> String {
        "/\(configuration.apiVersion)\(path)"
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var request = try makeRequest(path: path, method: "GET", query: query)
        await attachAuth(&request)
        return try await send(request)
    }

    private func post<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        var request = try makeRequest(path: path, method: "POST", query: [])
        try attachBody(body, to: &request)
        await attachAuth(&request)
        return try await send(request)
    }

    private func makeRequest(path: String, method: String, query: [URLQueryItem]) throws -> URLRequest {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidBaseURL
        }
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

    private func attachAuth(_ request: inout URLRequest) async {
        guard let tokenProvider, let token = await tokenProvider.currentAccessToken() else { return }
        request.setValue("Bearer \(token.exposeSecret())", forHTTPHeaderField: "Authorization")
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
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

        switch httpResponse.statusCode {
        case 200..<300:
            break
        case 401:
            throw APIError.unauthorized
        default:
            throw APIError.http(status: httpResponse.statusCode, body: data)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}

/// Decodes successfully from any body (including an empty one) — used for
/// endpoints whose response the app doesn't need, typically `204 No
/// Content`.
struct EmptyResponse: Decodable {}
