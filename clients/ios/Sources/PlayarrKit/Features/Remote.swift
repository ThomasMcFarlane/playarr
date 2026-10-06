import Foundation

/// Wire DTOs and client for the phone remote and playback handoff endpoints
/// (`docs/architecture/remote-control.md`).
public enum RemoteCapability {
    public static let navigate = "navigate"
    public static let text = "text"
    public static let playback = "playback"
    public static let input = "input"
    public static let handoff = "handoff"
}

/// A minimal JSON value for the free-form `state` and `payload` fields.
public enum RemoteJSON: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([RemoteJSON])
    case object([String: RemoteJSON])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Int64.self) { self = .int(v) }
        else if let v = try? c.decode(Double.self) { self = .double(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([RemoteJSON].self) { self = .array(v) }
        else if let v = try? c.decode([String: RemoteJSON].self) { self = .object(v) }
        else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    public subscript(key: String) -> RemoteJSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var intValue: Int64? {
        switch self {
        case .int(let v): return v
        case .double(let v): return Int64(v)
        default: return nil
        }
    }
}

public struct RegisterRemoteTargetRequest: Codable, Sendable, Equatable {
    public var name: String
    public var platform: String?
    public var capabilities: [String]

    public init(name: String, platform: String? = nil, capabilities: [String]) {
        self.name = name
        self.platform = platform
        self.capabilities = capabilities
    }
}

public struct RemoteTarget: Codable, Sendable, Equatable, Identifiable {
    public var deviceID: String
    public var name: String
    public var platform: String
    public var capabilities: [String]
    public var online: Bool
    public var isSelf: Bool
    public var state: RemoteJSON?

    public var id: String { deviceID }

    enum CodingKeys: String, CodingKey {
        case name, platform, capabilities, online, state
        case deviceID = "device_id"
        case isSelf = "is_self"
    }

    public init(
        deviceID: String,
        name: String,
        platform: String,
        capabilities: [String],
        online: Bool,
        isSelf: Bool,
        state: RemoteJSON? = nil
    ) {
        self.deviceID = deviceID
        self.name = name
        self.platform = platform
        self.capabilities = capabilities
        self.online = online
        self.isSelf = isSelf
        self.state = state
    }
}

public struct RemotePairing: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    /// `pending`, `active`, `denied`, `revoked` or `expired`.
    public var status: String
    public var controllerDeviceID: String
    public var controllerName: String
    public var targetDeviceID: String
    public var scopes: [String]
    public var verificationCode: String?
    public var createdMs: Int64
    public var expiresMs: Int64
    public var isController: Bool
    public var isTarget: Bool

    enum CodingKeys: String, CodingKey {
        case id, status, scopes
        case controllerDeviceID = "controller_device_id"
        case controllerName = "controller_name"
        case targetDeviceID = "target_device_id"
        case verificationCode = "verification_code"
        case createdMs = "created_ms"
        case expiresMs = "expires_ms"
        case isController = "is_controller"
        case isTarget = "is_target"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decode(String.self, forKey: .status)
        controllerDeviceID = try c.decode(String.self, forKey: .controllerDeviceID)
        controllerName = try c.decode(String.self, forKey: .controllerName)
        targetDeviceID = try c.decode(String.self, forKey: .targetDeviceID)
        scopes = try c.decode([String].self, forKey: .scopes)
        verificationCode = try c.decodeIfPresent(String.self, forKey: .verificationCode)
        createdMs = try c.decodeIfPresent(Int64.self, forKey: .createdMs) ?? 0
        expiresMs = try c.decodeIfPresent(Int64.self, forKey: .expiresMs) ?? 0
        isController = try c.decodeIfPresent(Bool.self, forKey: .isController) ?? false
        isTarget = try c.decodeIfPresent(Bool.self, forKey: .isTarget) ?? false
    }

    public init(
        id: String,
        status: String,
        controllerDeviceID: String,
        controllerName: String,
        targetDeviceID: String,
        scopes: [String],
        verificationCode: String? = nil,
        createdMs: Int64 = 0,
        expiresMs: Int64 = 0,
        isController: Bool = false,
        isTarget: Bool = false
    ) {
        self.id = id
        self.status = status
        self.controllerDeviceID = controllerDeviceID
        self.controllerName = controllerName
        self.targetDeviceID = targetDeviceID
        self.scopes = scopes
        self.verificationCode = verificationCode
        self.createdMs = createdMs
        self.expiresMs = expiresMs
        self.isController = isController
        self.isTarget = isTarget
    }
}

public struct CreateRemotePairingRequest: Codable, Sendable, Equatable {
    public var targetDeviceID: String
    public var scopes: [String]?
    public var controllerName: String?

    enum CodingKeys: String, CodingKey {
        case scopes
        case targetDeviceID = "target_device_id"
        case controllerName = "controller_name"
    }

    public init(targetDeviceID: String, scopes: [String]? = nil, controllerName: String? = nil) {
        self.targetDeviceID = targetDeviceID
        self.scopes = scopes
        self.controllerName = controllerName
    }
}

public struct RemoteCommandAccepted: Codable, Sendable, Equatable {
    public var commandID: String
    public var seq: Int64

    enum CodingKeys: String, CodingKey {
        case seq
        case commandID = "command_id"
    }
}

public struct RemoteCommandStatus: Codable, Sendable, Equatable {
    public var commandID: String
    public var status: String
    public var detail: String?

    enum CodingKeys: String, CodingKey {
        case status, detail
        case commandID = "command_id"
    }
}

public struct RemoteInboxEvent: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var seq: Int64
    /// `pairing_request`, `pairing_revoked`, `command`, `handoff_offer` or `handoff_stop`.
    public var kind: String
    public var pairingID: String?
    public var payload: RemoteJSON?

    enum CodingKeys: String, CodingKey {
        case id, seq, kind, payload
        case pairingID = "pairing_id"
    }
}

public struct RemoteInbox: Codable, Sendable, Equatable {
    public var events: [RemoteInboxEvent]
    public var next: Int64

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        events = try c.decodeIfPresent([RemoteInboxEvent].self, forKey: .events) ?? []
        next = try c.decodeIfPresent(Int64.self, forKey: .next) ?? 0
    }

    enum CodingKeys: String, CodingKey { case events, next }
}

/// Controller-side command builders matching the server's validated payloads.
public enum RemoteCommand {
    public struct Request: Encodable, Sendable, Equatable {
        public var kind: String
        public var payload: RemoteJSON
    }

    public static let navigationKeys = ["up", "down", "left", "right", "select", "back", "home", "menu", "options"]

    public static func navigate(_ key: String) -> Request {
        Request(kind: RemoteCapability.navigate, payload: .object(["key": .string(key)]))
    }

    public static func playback(_ action: String) -> Request {
        Request(kind: RemoteCapability.playback, payload: .object(["action": .string(action)]))
    }

    public static func seekBy(milliseconds: Int64) -> Request {
        Request(kind: RemoteCapability.playback, payload: .object([
            "action": .string("seek_by"), "delta_ms": .int(milliseconds)
        ]))
    }

    public static func volume(_ level: Int) -> Request {
        Request(kind: RemoteCapability.playback, payload: .object([
            "action": .string("volume"), "level": .int(Int64(min(100, max(0, level))))
        ]))
    }

    public static func text(_ value: String, mode: String = "insert", submit: Bool = false) -> Request {
        Request(kind: RemoteCapability.text, payload: .object([
            "value": .string(String(value.prefix(512))), "mode": .string(mode), "submit": .bool(submit)
        ]))
    }
}

/// Target-side decoding of a `command` inbox event.
public enum RemoteIncomingCommand: Sendable, Equatable {
    case navigate(key: String)
    case text(value: String, mode: String, submit: Bool)
    case playback(action: String, positionMs: Int64?, deltaMs: Int64?, level: Int64?, language: String?)
    case unsupported(kind: String)

    public init(event: RemoteInboxEvent) {
        let kind = event.payload?["kind"]?.stringValue ?? ""
        let args = event.payload?["args"]
        switch kind {
        case RemoteCapability.navigate:
            self = .navigate(key: args?["key"]?.stringValue ?? "")
        case RemoteCapability.text:
            var submit = false
            if case .bool(let value)? = args?["submit"] { submit = value }
            self = .text(
                value: args?["value"]?.stringValue ?? "",
                mode: args?["mode"]?.stringValue ?? "insert",
                submit: submit
            )
        case RemoteCapability.playback:
            self = .playback(
                action: args?["action"]?.stringValue ?? "",
                positionMs: args?["position_ms"]?.intValue,
                deltaMs: args?["delta_ms"]?.intValue,
                level: args?["level"]?.intValue,
                language: args?["language"]?.stringValue
            )
        default:
            self = .unsupported(kind: kind)
        }
    }
}

public struct RemoteClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    public func registerTarget(name: String, platform: String?, capabilities: [String]) async throws -> RemoteTarget {
        try await transport.sendJSON(
            method: "PUT",
            "/api/v1/remote/target",
            body: RegisterRemoteTargetRequest(name: name, platform: platform, capabilities: capabilities)
        )
    }

    public func unregisterTarget() async throws {
        try await transport.sendNoContent(method: "DELETE", "/api/v1/remote/target")
    }

    public func targets() async throws -> [RemoteTarget] {
        try await transport.getJSON("/api/v1/remote/targets")
    }

    public func reportState(_ state: RemoteJSON) async throws {
        struct Body: Encodable { var state: RemoteJSON }
        try await transport.sendNoContent(method: "PUT", "/api/v1/remote/target/state", body: Body(state: state))
    }

    public func createPairing(targetDeviceID: String, scopes: [String]?, controllerName: String?) async throws -> RemotePairing {
        try await transport.sendJSON(
            method: "POST",
            "/api/v1/remote/pairings",
            body: CreateRemotePairingRequest(targetDeviceID: targetDeviceID, scopes: scopes, controllerName: controllerName)
        )
    }

    public func pairings() async throws -> [RemotePairing] {
        try await transport.getJSON("/api/v1/remote/pairings")
    }

    public func pairing(id: String) async throws -> RemotePairing {
        try await transport.getJSON("/api/v1/remote/pairings/\(id)")
    }

    public func approvePairing(id: String) async throws -> RemotePairing {
        struct Body: Encodable { var scopes: [String]? }
        return try await transport.sendJSON(method: "POST", "/api/v1/remote/pairings/\(id)/approve", body: Body(scopes: nil))
    }

    public func denyPairing(id: String) async throws -> RemotePairing {
        try await transport.sendJSON(method: "POST", "/api/v1/remote/pairings/\(id)/deny", body: [String: String]())
    }

    public func revokePairing(id: String) async throws {
        try await transport.sendNoContent(method: "DELETE", "/api/v1/remote/pairings/\(id)")
    }

    public func send(_ command: RemoteCommand.Request, pairingID: String) async throws -> RemoteCommandAccepted {
        try await transport.sendJSON(method: "POST", "/api/v1/remote/pairings/\(pairingID)/commands", body: command)
    }

    public func commandStatus(id: String) async throws -> RemoteCommandStatus {
        try await transport.getJSON("/api/v1/remote/commands/\(id)")
    }

    /// Long poll for this target's inbox; the server caps `wait` at 25 seconds.
    public func inbox(after: Int64, wait: Int) async throws -> RemoteInbox {
        try await transport.getJSON("/api/v1/remote/inbox", query: [
            URLQueryItem(name: "after", value: String(after)),
            URLQueryItem(name: "wait", value: String(wait))
        ])
    }

    /// Acknowledges an inbox event with `ok`, `failed` or `unsupported`.
    public func ack(eventID: String, status: String, detail: String? = nil) async throws {
        struct Body: Encodable { var status: String; var detail: String? }
        try await transport.sendNoContent(
            method: "POST",
            "/api/v1/remote/events/\(eventID)/ack",
            body: Body(status: status, detail: detail)
        )
    }
}

/// Which capabilities a device may advertise: only those it can honour.
public enum RemoteCapabilityAdvertiser {
    public static func advertised(canNavigate: Bool, canText: Bool, canControlPlayback: Bool, canHandOff: Bool) -> [String] {
        var out: [String] = []
        if canNavigate { out.append(RemoteCapability.navigate) }
        if canText { out.append(RemoteCapability.text) }
        if canControlPlayback { out.append(RemoteCapability.playback) }
        if canHandOff { out.append(RemoteCapability.handoff) }
        return out
    }
}
