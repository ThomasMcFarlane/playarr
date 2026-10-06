import Foundation

/// Payload of the first `ready` frame of `GET /api/v1/events`.
public struct LiveReady: Decodable, Equatable, Sendable {
    public var seq: Int64
    public var retentionMs: Int64
    public var heartbeatMs: Int64
    public var maxAgeMs: Int64
    public var serverTimeMs: Int64

    enum CodingKeys: String, CodingKey {
        case seq
        case retentionMs = "retention_ms"
        case heartbeatMs = "heartbeat_ms"
        case maxAgeMs = "max_age_ms"
        case serverTimeMs = "server_time_ms"
    }
}

/// Payload of a `change` frame: a minimal pointer, never an entity body.
public struct LiveChange: Decodable, Equatable, Sendable {
    public var seq: Int64
    public var type: String
    public var entity: String
    public var id: String?
    public var changed: [String]
    /// Server time of the change in epoch milliseconds.
    public var at: Int64

    public init(seq: Int64, type: String, entity: String, id: String? = nil, changed: [String], at: Int64 = 0) {
        self.seq = seq
        self.type = type
        self.entity = entity
        self.id = id
        self.changed = changed
        self.at = at
    }
}

/// Payload of a `resync` frame: the cursor could not be honoured.
public struct LiveResync: Decodable, Equatable, Sendable {
    public var reason: String
    public var seq: Int64
}

public enum LiveEvent: Equatable, Sendable {
    case ready(LiveReady)
    case change(LiveChange)
    case resync(LiveResync)

    public var seq: Int64 {
        switch self {
        case .ready(let value): return value.seq
        case .change(let value): return value.seq
        case .resync(let value): return value.seq
        }
    }

    /// Decodes a frame; unknown or malformed frames yield `nil` (forward compatible).
    public init?(frame: SSEFrame) {
        let data = Data(frame.data.utf8)
        let decoder = JSONDecoder()
        switch frame.event {
        case "ready":
            guard let value = try? decoder.decode(LiveReady.self, from: data) else { return nil }
            self = .ready(value)
        case "change":
            guard let value = try? decoder.decode(LiveChange.self, from: data) else { return nil }
            self = .change(value)
        case "resync":
            guard let value = try? decoder.decode(LiveResync.self, from: data) else { return nil }
            self = .resync(value)
        default:
            return nil
        }
    }
}
