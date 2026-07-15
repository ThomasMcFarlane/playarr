import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `platform.rs` did
// not exist on disk at scaffold time, only `pub use platform::{
// ClientPlatform, CompatibilityEntry, VersionEnvelope}` in `lib.rs`.
// Fields below are inferred, not verified. `.ios`/`.tvos` are added here
// specifically because this crate mirror already anticipates the future
// tvOS target the Package.swift comment describes.

/// Identifies which Streamarr client is talking to the server — used for
/// the version-compatibility handshake (`VersionEnvelope`) and stamped
/// onto `Device`/`PlaybackSession` records.
public enum ClientPlatform: String, Codable, Sendable, CaseIterable, Hashable {
    case ios
    case tvos
    case android
    case web
    case webos
    case tizen
    case roku
}

/// One row of the server's platform-compatibility matrix, as returned in
/// `VersionEnvelope.compatibility`.
public struct CompatibilityEntry: Codable, Hashable, Sendable {
    public var platform: ClientPlatform
    public var minimumSupportedVersion: String
    public var recommendedVersion: String
    public var isDeprecated: Bool

    enum CodingKeys: String, CodingKey {
        case platform
        case minimumSupportedVersion = "minimum_supported_version"
        case recommendedVersion = "recommended_version"
        case isDeprecated = "is_deprecated"
    }

    public init(
        platform: ClientPlatform,
        minimumSupportedVersion: String,
        recommendedVersion: String,
        isDeprecated: Bool = false
    ) {
        self.platform = platform
        self.minimumSupportedVersion = minimumSupportedVersion
        self.recommendedVersion = recommendedVersion
        self.isDeprecated = isDeprecated
    }
}

/// Returned from the server's `/version` endpoint (see
/// `StreamarrAPIClient.fetchVersionEnvelope`); the app checks its own
/// `ClientPlatform`/version against `compatibility` on launch and warns
/// the user if it's below `minimumSupportedVersion`.
public struct VersionEnvelope: Codable, Hashable, Sendable {
    public var serverVersion: String
    public var apiVersion: String
    public var compatibility: [CompatibilityEntry]
    public var buildCommit: String?

    enum CodingKeys: String, CodingKey {
        case serverVersion = "server_version"
        case apiVersion = "api_version"
        case compatibility
        case buildCommit = "build_commit"
    }

    public init(
        serverVersion: String,
        apiVersion: String,
        compatibility: [CompatibilityEntry] = [],
        buildCommit: String? = nil
    ) {
        self.serverVersion = serverVersion
        self.apiVersion = apiVersion
        self.compatibility = compatibility
        self.buildCommit = buildCommit
    }
}
