import Foundation

/// One row of `GET /api/v1/admin/metrics/http-latency`: request-duration stats for a
/// (method, route template) pair. The server already sorts rows by `p95_ms` descending.
public struct HttpRouteLatency: Codable, Sendable, Equatable, Identifiable {
    public let method: String
    public let route: String
    public let sampleCount: Int64
    public let avgMs: Double
    public let p50Ms: Double
    public let p95Ms: Double
    public let p99Ms: Double
    public let maxMs: Double

    public var id: String { "\(method) \(route)" }

    public init(
        method: String, route: String, sampleCount: Int64,
        avgMs: Double, p50Ms: Double, p95Ms: Double, p99Ms: Double, maxMs: Double
    ) {
        self.method = method
        self.route = route
        self.sampleCount = sampleCount
        self.avgMs = avgMs
        self.p50Ms = p50Ms
        self.p95Ms = p95Ms
        self.p99Ms = p99Ms
        self.maxMs = maxMs
    }

    enum CodingKeys: String, CodingKey {
        case method, route
        case sampleCount = "sample_count"
        case avgMs = "avg_ms"
        case p50Ms = "p50_ms"
        case p95Ms = "p95_ms"
        case p99Ms = "p99_ms"
        case maxMs = "max_ms"
    }

    /// Same formatting as the web page: one decimal place and an `ms` suffix.
    public static func formatMs(_ value: Double) -> String {
        String(format: "%.1fms", locale: Locale(identifier: "en_US_POSIX"), value)
    }
}

/// What the Request latency page shows; mirrors the web `HttpLatencyState`.
public enum HttpLatencyState: Sendable, Equatable {
    case loading
    case forbidden
    case error(String)
    case ready([HttpRouteLatency])
}

/// Admin-only HTTP request-latency diagnostics.
public struct HttpLatencyClient: Sendable {
    private let transport: PlayarrRequestTransport

    public init(transport: PlayarrRequestTransport) {
        self.transport = transport
    }

    /// `GET /api/v1/admin/metrics/http-latency`. Rows keep the server's order (p95 descending).
    public func metrics() async throws -> [HttpRouteLatency] {
        try await transport.getJSON("/api/v1/admin/metrics/http-latency")
    }

    /// Loads the metrics and maps the outcome to a page state. Like the web page, a 403 means
    /// "not an admin", not a failure, so it becomes `.forbidden` rather than `.error`.
    public func load() async -> HttpLatencyState {
        do {
            return .ready(try await metrics())
        } catch let error as APIError {
            if case .http(let status, _, _) = error, status == 403 { return .forbidden }
            return .error(error.displayMessage)
        } catch {
            return .error(String(describing: error))
        }
    }
}
