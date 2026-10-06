import Foundation

/// Generic authenticated request used by the feature clients in
/// `Sources/PlayarrKit/Features` (home rails, resume plans, calendar, remote,
/// playback health, portability, household). `path` is an absolute API path
/// such as `/api/v1/home/rails`; `body` is already-encoded JSON.
///
/// Narrow on purpose: feature clients depend on this, not on the whole
/// `PlayarrAPIClient`, so tests can stub it in a few lines.
public protocol PlayarrRequestTransport: Sendable {
    func requestData(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Data?,
        expectedStatuses: Set<Int>
    ) async throws -> Data

    /// Opens `GET /api/v1/events` (server-sent events) with an optional
    /// `Last-Event-ID`. Has a default (see `LiveEventsConnection.swift`) that
    /// reports an unsupported server, so existing stubs keep compiling.
    func openEventStream(lastEventID: Int64?) async throws -> EventStreamResponse
}

/// Typed JSON helpers over `PlayarrRequestTransport.requestData`, shared by
/// every feature client so each one only declares its models and paths.
public extension PlayarrRequestTransport {
    func getJSON<T: Decodable>(
        _ path: String,
        query: [URLQueryItem] = [],
        as type: T.Type = T.self
    ) async throws -> T {
        let data = try await requestData(
            method: "GET", path: path, query: query, body: nil, expectedStatuses: [200]
        )
        return try Self.decodeFeature(T.self, from: data)
    }

    func sendJSON<Body: Encodable, T: Decodable>(
        method: String,
        _ path: String,
        body: Body,
        query: [URLQueryItem] = [],
        expectedStatuses: Set<Int> = Set(200..<300),
        as type: T.Type = T.self
    ) async throws -> T {
        let encoded = try PlayarrJSONCoding.makeEncoder().encode(body)
        let data = try await requestData(
            method: method, path: path, query: query, body: encoded, expectedStatuses: expectedStatuses
        )
        return try Self.decodeFeature(T.self, from: data)
    }

    /// Sends a request whose response body is ignored (204 or an unused body).
    func sendNoContent<Body: Encodable>(
        method: String,
        _ path: String,
        body: Body,
        expectedStatuses: Set<Int> = Set(200..<300)
    ) async throws {
        let encoded = try PlayarrJSONCoding.makeEncoder().encode(body)
        _ = try await requestData(
            method: method, path: path, query: [], body: encoded, expectedStatuses: expectedStatuses
        )
    }

    func sendNoContent(
        method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        expectedStatuses: Set<Int> = Set(200..<300)
    ) async throws {
        _ = try await requestData(
            method: method, path: path, query: query, body: nil, expectedStatuses: expectedStatuses
        )
    }

    private static func decodeFeature<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try PlayarrJSONCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
