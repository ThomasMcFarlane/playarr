import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `user.rs` did not
// exist on disk at scaffold time, only `pub use user::{Device, Session,
// User}` in `lib.rs`. Fields below are inferred, not verified. `Session`
// here is the *server-issued auth session/token pair* record, unrelated to
// Foundation's `URLSession` (no collision: Foundation doesn't export a bare
// `Session` symbol).

public struct User: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var username: String
    public var displayName: String
    public var email: String?
    public var isAdministrator: Bool
    public var policyID: UUID?
    public var createdAt: Date
    public var updatedAt: Date
    public var lastActiveAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case displayName = "display_name"
        case email
        case isAdministrator = "is_administrator"
        case policyID = "policy_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case lastActiveAt = "last_active_at"
    }

    public init(
        id: UUID,
        username: String,
        displayName: String,
        email: String? = nil,
        isAdministrator: Bool = false,
        policyID: UUID? = nil,
        createdAt: Date,
        updatedAt: Date,
        lastActiveAt: Date? = nil
    ) {
        self.id = id
        self.username = username
        self.displayName = displayName
        self.email = email
        self.isAdministrator = isAdministrator
        self.policyID = policyID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastActiveAt = lastActiveAt
    }
}

/// A device (this app installed on a phone/tablet, or another Streamarr
/// client) registered against a `User`. Populated from the RFC 8628 device
/// authorization flow in `Auth/DeviceFlowClient.swift`.
public struct Device: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var userID: UUID
    public var name: String
    public var platform: ClientPlatform
    public var appVersion: String
    public var registeredAt: Date
    public var lastSeenAt: Date
    public var pushToken: Sensitive<String>?

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case name
        case platform
        case appVersion = "app_version"
        case registeredAt = "registered_at"
        case lastSeenAt = "last_seen_at"
        case pushToken = "push_token"
    }

    public init(
        id: UUID,
        userID: UUID,
        name: String,
        platform: ClientPlatform,
        appVersion: String,
        registeredAt: Date,
        lastSeenAt: Date,
        pushToken: Sensitive<String>? = nil
    ) {
        self.id = id
        self.userID = userID
        self.name = name
        self.platform = platform
        self.appVersion = appVersion
        self.registeredAt = registeredAt
        self.lastSeenAt = lastSeenAt
        self.pushToken = pushToken
    }
}

/// A server-issued access/refresh token pair for one `Device`. The app
/// itself doesn't decode this directly — `DeviceFlowClient` receives the
/// raw OAuth token response — but it's included here as the resting/wire
/// shape used when the server surfaces active sessions back to the client
/// (e.g. a future "Sign out other devices" settings screen).
public struct Session: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var userID: UUID
    public var deviceID: UUID
    public var accessToken: Sensitive<String>
    public var refreshToken: Sensitive<String>
    public var expiresAt: Date
    public var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case deviceID = "device_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
        case createdAt = "created_at"
    }

    public init(
        id: UUID,
        userID: UUID,
        deviceID: UUID,
        accessToken: Sensitive<String>,
        refreshToken: Sensitive<String>,
        expiresAt: Date,
        createdAt: Date
    ) {
        self.id = id
        self.userID = userID
        self.deviceID = deviceID
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.createdAt = createdAt
    }
}
