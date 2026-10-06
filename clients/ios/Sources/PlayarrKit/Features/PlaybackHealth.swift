import Foundation

// Wire types and client for `POST /api/v1/playback/sessions/{id}/health` and
// `GET /api/v1/playback/connection-test` (`docs/architecture/playback-health.md`).
// Provenance is never overclaimed: values the device only advertises go in
// `reported`, values observed on this playback go in `measured`, and anything
// unknown is omitted.

public struct ReportedCapabilities: Codable, Sendable, Equatable {
    public var videoCodecs: [String]
    public var audioCodecs: [String]
    public var hdrFormats: [String]
    public var displayHdrFormats: [String]
    public var audioOutput: String?
    public var maxHeight: Int?

    public init(
        videoCodecs: [String] = [], audioCodecs: [String] = [], hdrFormats: [String] = [],
        displayHdrFormats: [String] = [], audioOutput: String? = nil, maxHeight: Int? = nil
    ) {
        self.videoCodecs = videoCodecs
        self.audioCodecs = audioCodecs
        self.hdrFormats = hdrFormats
        self.displayHdrFormats = displayHdrFormats
        self.audioOutput = audioOutput
        self.maxHeight = maxHeight
    }

    enum CodingKeys: String, CodingKey {
        case videoCodecs = "video_codecs"
        case audioCodecs = "audio_codecs"
        case hdrFormats = "hdr_formats"
        case displayHdrFormats = "display_hdr_formats"
        case audioOutput = "audio_output"
        case maxHeight = "max_height"
    }
}

public struct MeasuredPlayback: Codable, Sendable, Equatable {
    public var videoCodec: String?
    public var decoderKind: String?
    public var width: Int?
    public var height: Int?
    public var hdrActive: Bool?
    public var audioCodec: String?
    public var audioChannels: Int?
    public var audioPassthrough: Bool?
    public var droppedFrames: Int64?
    public var rebufferCount: Int?
    public var rebufferMs: Int64?
    public var throughputBps: Int64?

    public init(
        videoCodec: String? = nil, decoderKind: String? = nil, width: Int? = nil, height: Int? = nil,
        hdrActive: Bool? = nil, audioCodec: String? = nil, audioChannels: Int? = nil,
        audioPassthrough: Bool? = nil, droppedFrames: Int64? = nil, rebufferCount: Int? = nil,
        rebufferMs: Int64? = nil, throughputBps: Int64? = nil
    ) {
        self.videoCodec = videoCodec
        self.decoderKind = decoderKind
        self.width = width
        self.height = height
        self.hdrActive = hdrActive
        self.audioCodec = audioCodec
        self.audioChannels = audioChannels
        self.audioPassthrough = audioPassthrough
        self.droppedFrames = droppedFrames
        self.rebufferCount = rebufferCount
        self.rebufferMs = rebufferMs
        self.throughputBps = throughputBps
    }

    enum CodingKeys: String, CodingKey {
        case videoCodec = "video_codec"
        case decoderKind = "decoder_kind"
        case width, height
        case hdrActive = "hdr_active"
        case audioCodec = "audio_codec"
        case audioChannels = "audio_channels"
        case audioPassthrough = "audio_passthrough"
        case droppedFrames = "dropped_frames"
        case rebufferCount = "rebuffer_count"
        case rebufferMs = "rebuffer_ms"
        case throughputBps = "throughput_bps"
    }
}

public struct ClientPlaybackReport: Codable, Sendable, Equatable {
    public var reported: ReportedCapabilities
    public var measured: MeasuredPlayback

    public init(reported: ReportedCapabilities = ReportedCapabilities(), measured: MeasuredPlayback = MeasuredPlayback()) {
        self.reported = reported
        self.measured = measured
    }
}

public enum HealthProvenance: String, Codable, Sendable {
    case measured, reported, unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = HealthProvenance(rawValue: raw) ?? .unknown
    }
}

public enum HealthSeverity: String, Codable, Sendable {
    case ok, info, warning, problem

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = HealthSeverity(rawValue: raw) ?? .info
    }
}

public struct HealthFact: Decodable, Sendable, Equatable {
    public var key: String
    public var label: String
    public var value: String?
    public var provenance: HealthProvenance
    public var source: String?

    enum CodingKeys: String, CodingKey { case key, label, value, provenance, source }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? key
        value = try c.decodeIfPresent(String.self, forKey: .value)
        provenance = try c.decodeIfPresent(HealthProvenance.self, forKey: .provenance) ?? .unknown
        source = try c.decodeIfPresent(String.self, forKey: .source)
    }
}

public struct HealthFinding: Decodable, Sendable, Equatable {
    public var code: String
    public var severity: HealthSeverity
    public var title: String
    public var detail: String
    public var nextAction: String?

    enum CodingKeys: String, CodingKey {
        case code, severity, title, detail
        case nextAction = "next_action"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        severity = try c.decodeIfPresent(HealthSeverity.self, forKey: .severity) ?? .info
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? code
        detail = try c.decodeIfPresent(String.self, forKey: .detail) ?? ""
        nextAction = try c.decodeIfPresent(String.self, forKey: .nextAction)
    }
}

public struct HealthQualification: Decodable, Sendable, Equatable {
    public var status: String
    public var note: String

    public init(status: String, note: String) {
        self.status = status
        self.note = note
    }

    enum CodingKeys: String, CodingKey { case status, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "not_assessed"
        note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
    }
}

/// The redacted evidence the server builds; shown and shared only on an explicit action.
/// Kept as generic JSON so the exact text the server produced is what gets shared.
public struct PlaybackHealthReport: Decodable, Sendable, Equatable {
    public var headline: String
    public var severity: HealthSeverity
    public var playMethod: String
    public var facts: [HealthFact]
    public var findings: [HealthFinding]
    public var qualification: HealthQualification
    /// Pretty-printed redacted export, produced from the response's `export` object.
    public var exportText: String

    enum CodingKeys: String, CodingKey {
        case headline, severity, facts, findings, qualification, export
        case playMethod = "play_method"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headline = try c.decodeIfPresent(String.self, forKey: .headline) ?? ""
        severity = try c.decodeIfPresent(HealthSeverity.self, forKey: .severity) ?? .info
        playMethod = try c.decodeIfPresent(String.self, forKey: .playMethod) ?? ""
        facts = try c.decodeIfPresent([HealthFact].self, forKey: .facts) ?? []
        findings = try c.decodeIfPresent([HealthFinding].self, forKey: .findings) ?? []
        qualification = try c.decodeIfPresent(HealthQualification.self, forKey: .qualification)
            ?? HealthQualification(status: "not_assessed", note: "")
        let export = try c.decodeIfPresent(JSONValue.self, forKey: .export)
        exportText = export?.prettyPrinted ?? ""
    }

}

/// Minimal JSON tree, enough to re-serialise the server's export verbatim.
public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    public var prettyPrinted: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(self) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
}

public struct ConnectionTestResult: Sendable, Equatable {
    public var bytes: Int
    public var seconds: Double
    public var bitsPerSecond: Int64 { seconds > 0 ? Int64(Double(bytes) * 8 / seconds) : 0 }
}

public struct PlaybackHealthClient: Sendable {
    private let transport: PlayarrRequestTransport

    public init(transport: PlayarrRequestTransport) {
        self.transport = transport
    }

    public func report(sessionID: UUID, client: ClientPlaybackReport) async throws -> PlaybackHealthReport {
        try await transport.sendJSON(
            method: "POST",
            "/api/v1/playback/sessions/\(sessionID.uuidString.lowercased())/health",
            body: client,
            expectedStatuses: [200]
        )
    }

    /// Downloads a zero-filled payload and times it. Cancel the calling task to abort.
    /// A single request, so it cannot saturate the link; playback may stutter briefly.
    public func connectionTest(bytes: Int = 1_048_576, timeoutSeconds: Double = 8) async throws -> ConnectionTestResult {
        let transport = self.transport
        return try await withThrowingTaskGroup(of: ConnectionTestResult.self) { group in
            group.addTask {
                let started = Date()
                let data = try await transport.requestData(
                    method: "GET", path: "/api/v1/playback/connection-test",
                    query: [URLQueryItem(name: "bytes", value: String(bytes))],
                    body: nil, expectedStatuses: [200]
                )
                return ConnectionTestResult(bytes: data.count, seconds: Date().timeIntervalSince(started))
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                throw APIError.serviceUnavailable(nil)
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else { throw APIError.invalidResponse }
            return first
        }
    }
}
