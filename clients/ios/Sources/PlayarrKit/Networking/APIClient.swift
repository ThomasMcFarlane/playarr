import Foundation

// MARK: - Generated-client notice
//
// `PlayarrAPIClient`/`APIClient` below is a real, working, async/await
// `URLSession`-based client for every operation in
// `backend/openapi/playarr.yaml` *except* the two RFC 8628 OAuth device
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

/// Configuration for talking to one Playarr Server instance. `baseURL` is
/// the one thing that must be user-configurable per the architecture
/// principle that a client points at an arbitrary operator-run instance —
/// see `AppEnvironment` in `PlayarrApp` for the UserDefaults-backed
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
        deviceName: String = "Playarr Server Client",
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

/// The shape of the Playarr Server HTTP API this app depends on (minus the
/// OAuth device flow — see the header note above), independent of how a
/// request actually gets made.
public protocol PlayarrAPIClient: Sendable {
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
    func signup(_ body: SignupRequest) async throws -> UserAccount

    // Catalog
    func browseCatalog(
        kind: WorkKind?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> CatalogPage
    func browseLibrary(
        kind: WorkKind,
        sort: String,
        order: String,
        availableOnly: Bool,
        limit: Int,
        offset: Int
    ) async throws -> CatalogPage

    func searchCatalog(query: String, limit: Int?) async throws -> [Work]
    func fetchWork(id: UUID) async throws -> WorkDetail
    func fetchWorkCredits(id: UUID) async throws -> WorkCredits
    func fetchSimilarWorks(id: UUID, limit: Int) async throws -> [Work]
    func listCatalogKinds() async throws -> [WorkKind]
    func fetchArtwork(workID: UUID, kind: ImageKind) async throws -> Data
    func fetchAlbumArtwork(artistWorkID: UUID, albumID: UUID, kind: ImageKind) async throws -> Data

    // Viewer state
    func listWatchProgress() async throws -> [WatchProgress]
    func listPlaylists() async throws -> [Playlist]
    func listPlaylistItems(playlistID: UUID) async throws -> [PlaylistItem]
    func listProfiles() async throws -> [AvailableProfile]
    func playbackRequestHeaders() async throws -> [String: String]
    func createPlaylist(_ body: CreatePlaylistRequest) async throws -> Playlist
    func updatePlaylist(id: UUID, body: UpdatePlaylistRequest) async throws -> Playlist
    func deletePlaylist(id: UUID) async throws
    func addPlaylistItem(playlistID: UUID, body: AddPlaylistItemRequest) async throws -> PlaylistItem
    func removePlaylistItem(playlistID: UUID, itemID: UUID) async throws
    func reorderPlaylistItems(playlistID: UUID, body: ReorderPlaylistItemsRequest) async throws -> [PlaylistItem]
    func getPlayerPreferences() async throws -> PlayerPreferences
    func updatePlayerPreferences(_ body: PlayerPreferences) async throws -> PlayerPreferences
    func getProfileAvatar() async throws -> ProfileAvatarSetting
    func updateProfileAvatar(_ body: UpdateProfileAvatarRequest) async throws -> ProfileAvatarSetting
    func getProfilePinSetting() async throws -> ProfilePinSetting
    func updateProfilePinSetting(_ body: UpdateProfilePinRequest) async throws -> ProfilePinSetting
    func verifyProfilePin(profileID: UUID, body: VerifyProfilePinRequest) async throws -> VerifyProfilePinResponse
    func getMyUserInviteRequest() async throws -> UserInviteRequest?
    func createUserInviteRequest(_ body: CreateUserInviteRequest) async throws -> UserInviteRequest
    func generateApprovedUserInvite() async throws -> UserInvite

    // Playback
    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse
    func recordPlaybackEvent(sessionID: UUID, event: PlaybackEventRequest) async throws
    func mediaChapters(mediaFileID: UUID) async throws -> [MediaChapter]
    func mediaPlaybackOptions(mediaFileID: UUID) async throws -> MediaPlaybackOptions
    func updateMediaPlaybackOptions(mediaFileID: UUID, body: MediaPlaybackPreference) async throws -> MediaPlaybackOptions
    func getWatchProgress(mediaFileID: UUID) async throws -> WatchProgress
    func updateWatchProgress(mediaFileID: UUID, body: UpdateWatchProgressRequest) async throws -> WatchProgress

    // Downloads
    func mediaDownloadOptions(mediaFileID: UUID) async throws -> MediaFileDownloadOptionsResponse
    func createDownload(_ body: CreateDownloadRequest) async throws -> DownloadTicket
    func listDownloads() async throws -> [DownloadTicket]
    func getDownload(id: UUID) async throws -> DownloadTicket
    func deleteDownload(id: UUID) async throws

    // Webhooks — primarily for admin/debug tooling; a normal client screen
    // has no reason to POST here (this is the *arr apps' job), but it's
    // wired for completeness against the spec.
    func sendWebhook(instanceID: UUID, payload: Data) async throws

    /// Resolves a possibly-relative URL string (as returned by
    /// `PlaybackInfoResponse.url`) against `baseURL`.
    func resolvedURL(forPath path: String) -> URL?
}

public extension PlayarrAPIClient {
    func signup(_ body: SignupRequest) async throws -> UserAccount { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func browseLibrary(kind: WorkKind, sort: String, order: String, availableOnly: Bool, limit: Int, offset: Int) async throws -> CatalogPage {
        try await browseCatalog(kind: kind, genre: nil, tag: nil, sort: sort, limit: limit, offset: offset)
    }
    func listCatalogKinds() async throws -> [WorkKind] { [] }
    func fetchWorkCredits(id: UUID) async throws -> WorkCredits { WorkCredits(cast: [], crew: []) }
    func fetchSimilarWorks(id: UUID, limit: Int) async throws -> [Work] { [] }
    func fetchArtwork(workID: UUID, kind: ImageKind) async throws -> Data {
        throw APIError.notFound(nil)
    }
    func fetchAlbumArtwork(artistWorkID: UUID, albumID: UUID, kind: ImageKind) async throws -> Data {
        throw APIError.notFound(nil)
    }
    func listWatchProgress() async throws -> [WatchProgress] { [] }
    func listPlaylists() async throws -> [Playlist] { [] }
    func listPlaylistItems(playlistID: UUID) async throws -> [PlaylistItem] { [] }
    func listProfiles() async throws -> [AvailableProfile] { [] }
    func playbackRequestHeaders() async throws -> [String: String] { [:] }
    func createPlaylist(_ body: CreatePlaylistRequest) async throws -> Playlist { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func updatePlaylist(id: UUID, body: UpdatePlaylistRequest) async throws -> Playlist { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func deletePlaylist(id: UUID) async throws { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func addPlaylistItem(playlistID: UUID, body: AddPlaylistItemRequest) async throws -> PlaylistItem { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func removePlaylistItem(playlistID: UUID, itemID: UUID) async throws { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func reorderPlaylistItems(playlistID: UUID, body: ReorderPlaylistItemsRequest) async throws -> [PlaylistItem] { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func getPlayerPreferences() async throws -> PlayerPreferences { PlayerPreferences(preferredAudioLanguage: "en") }
    func updatePlayerPreferences(_ body: PlayerPreferences) async throws -> PlayerPreferences { body }
    func getProfileAvatar() async throws -> ProfileAvatarSetting { ProfileAvatarSetting(preference: nil) }
    func updateProfileAvatar(_ body: UpdateProfileAvatarRequest) async throws -> ProfileAvatarSetting { ProfileAvatarSetting(preference: body.preference) }
    func getProfilePinSetting() async throws -> ProfilePinSetting { ProfilePinSetting(pinLocked: false) }
    func updateProfilePinSetting(_ body: UpdateProfilePinRequest) async throws -> ProfilePinSetting { ProfilePinSetting(pinLocked: body.pin != nil) }
    func verifyProfilePin(profileID: UUID, body: VerifyProfilePinRequest) async throws -> VerifyProfilePinResponse { VerifyProfilePinResponse(verified: true) }
    func getMyUserInviteRequest() async throws -> UserInviteRequest? { nil }
    func createUserInviteRequest(_ body: CreateUserInviteRequest) async throws -> UserInviteRequest { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func generateApprovedUserInvite() async throws -> UserInvite { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func recordPlaybackEvent(sessionID: UUID, event: PlaybackEventRequest) async throws {}
    func mediaChapters(mediaFileID: UUID) async throws -> [MediaChapter] { [] }
    func mediaPlaybackOptions(mediaFileID: UUID) async throws -> MediaPlaybackOptions { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func updateMediaPlaybackOptions(mediaFileID: UUID, body: MediaPlaybackPreference) async throws -> MediaPlaybackOptions { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func getWatchProgress(mediaFileID: UUID) async throws -> WatchProgress { throw APIError.notFound(nil) }
    func updateWatchProgress(mediaFileID: UUID, body: UpdateWatchProgressRequest) async throws -> WatchProgress { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func mediaDownloadOptions(mediaFileID: UUID) async throws -> MediaFileDownloadOptionsResponse { throw APIError.notFound(nil) }
    func createDownload(_ body: CreateDownloadRequest) async throws -> DownloadTicket { throw APIError.http(status: 501, body: nil, rawBody: nil) }
    func listDownloads() async throws -> [DownloadTicket] { [] }
    func getDownload(id: UUID) async throws -> DownloadTicket { throw APIError.notFound(nil) }
    func deleteDownload(id: UUID) async throws { throw APIError.http(status: 501, body: nil, rawBody: nil) }
}

/// Real, working `URLSession`-backed implementation of `PlayarrAPIClient`.
public final class APIClient: PlayarrAPIClient {
    private let configuration: APIClientConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let accessTokenCoordinator: AccessTokenCoordinator?

    public init(
        configuration: APIClientConfiguration,
        tokenProvider: AccessTokenProviding? = nil,
        serverGroupStore: KnownServerGroupStoring? = nil,
        session: URLSession? = nil
    ) {
        let resolvedSession = session ?? URLSession(configuration: configuration.urlSessionConfiguration)
        self.configuration = configuration
        self.session = resolvedSession
        self.decoder = PlayarrJSONCoding.makeDecoder()
        self.encoder = PlayarrJSONCoding.makeEncoder()
        self.accessTokenCoordinator = tokenProvider.map {
            AccessTokenCoordinator(
                configuration: configuration,
                tokenProvider: $0,
                serverGroupStore: serverGroupStore,
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

    public func signup(_ body: SignupRequest) async throws -> UserAccount {
        try await post("/api/v1/auth/signup", body: body)
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

    public func browseLibrary(
        kind: WorkKind,
        sort: String,
        order: String,
        availableOnly: Bool,
        limit: Int,
        offset: Int
    ) async throws -> CatalogPage {
        try await get("/api/v1/catalog", query: [
            URLQueryItem(name: "kind", value: kind.rawValue),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order),
            URLQueryItem(name: "available_only", value: String(availableOnly)),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ])
    }

    public func searchCatalog(query searchQuery: String, limit: Int? = nil) async throws -> [Work] {
        var query = [URLQueryItem(name: "q", value: searchQuery)]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await get("/api/v1/catalog/search", query: query)
    }

    public func fetchWork(id: UUID) async throws -> WorkDetail {
        try await get("/api/v1/catalog/\(id.uuidString)")
    }

    public func fetchWorkCredits(id: UUID) async throws -> WorkCredits {
        try await get("/api/v1/catalog/\(id.uuidString)/credits")
    }

    public func fetchSimilarWorks(id: UUID, limit: Int = 20) async throws -> [Work] {
        try await get(
            "/api/v1/catalog/\(id.uuidString)/similar",
            query: [URLQueryItem(name: "limit", value: String(limit))]
        )
    }

    public func listCatalogKinds() async throws -> [WorkKind] {
        try await get("/api/v1/catalog/kinds")
    }

    public func fetchArtwork(workID: UUID, kind: ImageKind) async throws -> Data {
        try await authenticatedData(path: "/api/v1/artwork/work/\(workID.uuidString)/\(kind.rawValue)")
    }

    public func fetchAlbumArtwork(artistWorkID: UUID, albumID: UUID, kind: ImageKind) async throws -> Data {
        try await authenticatedData(
            path: "/api/v1/artwork/album/\(artistWorkID.uuidString)/\(albumID.uuidString)/\(kind.rawValue)"
        )
    }

    // MARK: Viewer state

    public func listWatchProgress() async throws -> [WatchProgress] {
        try await get("/api/v1/playback/progress")
    }

    public func listPlaylists() async throws -> [Playlist] {
        try await get("/api/v1/playlists")
    }

    public func listPlaylistItems(playlistID: UUID) async throws -> [PlaylistItem] {
        try await get("/api/v1/playlists/\(playlistID.uuidString)/items")
    }

    public func listProfiles() async throws -> [AvailableProfile] {
        try await get("/api/v1/users/profiles")
    }

    public func createPlaylist(_ body: CreatePlaylistRequest) async throws -> Playlist {
        try await authenticatedRequest("/api/v1/playlists", method: "POST", body: body)
    }

    public func updatePlaylist(id: UUID, body: UpdatePlaylistRequest) async throws -> Playlist {
        try await authenticatedRequest("/api/v1/playlists/\(id.uuidString)", method: "PUT", body: body)
    }

    public func deletePlaylist(id: UUID) async throws {
        try await authenticatedRequestWithoutResponse("/api/v1/playlists/\(id.uuidString)", method: "DELETE")
    }

    public func addPlaylistItem(playlistID: UUID, body: AddPlaylistItemRequest) async throws -> PlaylistItem {
        try await authenticatedRequest("/api/v1/playlists/\(playlistID.uuidString)/items", method: "POST", body: body)
    }

    public func removePlaylistItem(playlistID: UUID, itemID: UUID) async throws {
        try await authenticatedRequestWithoutResponse(
            "/api/v1/playlists/\(playlistID.uuidString)/items/\(itemID.uuidString)",
            method: "DELETE"
        )
    }

    public func reorderPlaylistItems(playlistID: UUID, body: ReorderPlaylistItemsRequest) async throws -> [PlaylistItem] {
        try await authenticatedRequest("/api/v1/playlists/\(playlistID.uuidString)/items/order", method: "PUT", body: body)
    }

    public func getPlayerPreferences() async throws -> PlayerPreferences {
        try await get("/api/v1/users/me/player-preferences")
    }

    public func updatePlayerPreferences(_ body: PlayerPreferences) async throws -> PlayerPreferences {
        try await authenticatedRequest("/api/v1/users/me/player-preferences", method: "PATCH", body: body)
    }

    public func getProfileAvatar() async throws -> ProfileAvatarSetting {
        try await get("/api/v1/users/me/profile-avatar")
    }

    public func updateProfileAvatar(_ body: UpdateProfileAvatarRequest) async throws -> ProfileAvatarSetting {
        try await authenticatedRequest("/api/v1/users/me/profile-avatar", method: "PUT", body: body)
    }

    public func getProfilePinSetting() async throws -> ProfilePinSetting {
        try await get("/api/v1/users/me/profile-pin")
    }

    public func updateProfilePinSetting(_ body: UpdateProfilePinRequest) async throws -> ProfilePinSetting {
        try await authenticatedRequest("/api/v1/users/me/profile-pin", method: "PATCH", body: body)
    }

    public func verifyProfilePin(profileID: UUID, body: VerifyProfilePinRequest) async throws -> VerifyProfilePinResponse {
        try await authenticatedRequest("/api/v1/users/profiles/\(profileID.uuidString)/verify-pin", method: "POST", body: body)
    }

    public func getMyUserInviteRequest() async throws -> UserInviteRequest? {
        try await get("/api/v1/users/me/user-invite-request")
    }

    public func createUserInviteRequest(_ body: CreateUserInviteRequest) async throws -> UserInviteRequest {
        try await authenticatedRequest("/api/v1/users/me/user-invite-request", method: "POST", body: body)
    }

    public func generateApprovedUserInvite() async throws -> UserInvite {
        try await authenticatedRequest(
            "/api/v1/users/me/user-invite-request/generate",
            method: "POST",
            body: EmptyRequestBody()
        )
    }

    public func playbackRequestHeaders() async throws -> [String: String] {
        guard let accessTokenCoordinator else { return [:] }
        let token = try await accessTokenCoordinator.accessToken(forceRefresh: false)
        return ["Authorization": "Bearer \(token.exposeSecret())"]
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

    public func recordPlaybackEvent(sessionID: UUID, event: PlaybackEventRequest) async throws {
        try await authenticatedRequestWithoutResponse(
            "/api/v1/playback/sessions/\(sessionID.uuidString)/events",
            method: "POST",
            body: event
        )
    }

    public func mediaChapters(mediaFileID: UUID) async throws -> [MediaChapter] {
        try await get("/api/v1/media/\(mediaFileID.uuidString)/chapters")
    }

    public func mediaPlaybackOptions(mediaFileID: UUID) async throws -> MediaPlaybackOptions {
        try await get("/api/v1/media/\(mediaFileID.uuidString)/playback-options")
    }

    public func updateMediaPlaybackOptions(mediaFileID: UUID, body: MediaPlaybackPreference) async throws -> MediaPlaybackOptions {
        try await authenticatedRequest(
            "/api/v1/media/\(mediaFileID.uuidString)/playback-options",
            method: "PATCH",
            body: body
        )
    }

    public func getWatchProgress(mediaFileID: UUID) async throws -> WatchProgress {
        try await get("/api/v1/playback/\(mediaFileID.uuidString)/progress")
    }

    public func updateWatchProgress(mediaFileID: UUID, body: UpdateWatchProgressRequest) async throws -> WatchProgress {
        try await authenticatedRequest(
            "/api/v1/playback/\(mediaFileID.uuidString)/progress",
            method: "PUT",
            body: body
        )
    }

    // MARK: Downloads

    public func mediaDownloadOptions(mediaFileID: UUID) async throws -> MediaFileDownloadOptionsResponse {
        try await get("/api/v1/media/\(mediaFileID.uuidString)/download-options")
    }

    public func createDownload(_ body: CreateDownloadRequest) async throws -> DownloadTicket {
        try await authenticatedRequest("/api/v1/downloads", method: "POST", body: body, expectedStatuses: [200, 201])
    }

    public func listDownloads() async throws -> [DownloadTicket] {
        try await get("/api/v1/downloads")
    }

    public func getDownload(id: UUID) async throws -> DownloadTicket {
        try await get("/api/v1/downloads/\(id.uuidString)")
    }

    public func deleteDownload(id: UUID) async throws {
        try await authenticatedRequestWithoutResponse("/api/v1/downloads/\(id.uuidString)", method: "DELETE", expectedStatuses: [204])
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

    private func authenticatedData(path: String) async throws -> Data {
        var request = try makeRequest(path: path, method: "GET", query: [])
        try await attachAuthorization(to: &request)
        do {
            return try await sendRaw(request, expectedStatuses: [200])
        } catch APIError.unauthorized where accessTokenCoordinator != nil {
            try await attachAuthorization(to: &request, forceRefresh: true)
            return try await sendRaw(request, expectedStatuses: [200])
        }
    }

    private func authenticatedRequest<Body: Encodable, Response: Decodable>(
        _ path: String,
        method: String,
        body: Body,
        expectedStatuses: Set<Int> = Set(200..<300)
    ) async throws -> Response {
        var request = try makeRequest(path: path, method: method, query: [])
        try attachBody(body, to: &request)
        try await attachAuthorization(to: &request)
        do {
            return try await send(request, expectedStatuses: expectedStatuses)
        } catch APIError.unauthorized where accessTokenCoordinator != nil {
            try await attachAuthorization(to: &request, forceRefresh: true)
            return try await send(request, expectedStatuses: expectedStatuses)
        }
    }

    private func authenticatedRequestWithoutResponse<Body: Encodable>(
        _ path: String,
        method: String,
        body: Body,
        expectedStatuses: Set<Int> = Set(200..<300)
    ) async throws {
        var request = try makeRequest(path: path, method: method, query: [])
        try attachBody(body, to: &request)
        try await attachAuthorization(to: &request)
        do {
            _ = try await sendRaw(request, expectedStatuses: expectedStatuses)
        } catch APIError.unauthorized where accessTokenCoordinator != nil {
            try await attachAuthorization(to: &request, forceRefresh: true)
            _ = try await sendRaw(request, expectedStatuses: expectedStatuses)
        }
    }

    private func authenticatedRequestWithoutResponse(
        _ path: String,
        method: String,
        expectedStatuses: Set<Int> = Set(200..<300)
    ) async throws {
        var request = try makeRequest(path: path, method: method, query: [])
        try await attachAuthorization(to: &request)
        do {
            _ = try await sendRaw(request, expectedStatuses: expectedStatuses)
        } catch APIError.unauthorized where accessTokenCoordinator != nil {
            try await attachAuthorization(to: &request, forceRefresh: true)
            _ = try await sendRaw(request, expectedStatuses: expectedStatuses)
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
        // operator serving Playarr Server behind a reverse-proxy prefix).
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
        request.setValue(configuration.clientPlatform.rawValue, forHTTPHeaderField: "X-Playarr-Client-Platform")
        request.setValue(configuration.clientVersion, forHTTPHeaderField: "X-Playarr-Client-Version")
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

private struct EmptyRequestBody: Encodable {}

private actor AccessTokenCoordinator {
    private let configuration: APIClientConfiguration
    private let tokenProvider: AccessTokenProviding
    /// `docs/architecture/peer-groups.md` §6.4/§7.2, §8 Phase 5: `nil`
    /// (the default) reproduces this coordinator's pre-Phase-5 behavior
    /// exactly — a single attempt against `configuration.baseURL`, no
    /// fallback address to retry. When present, the two retry loops below
    /// deliberately scope differently, per §3.7: the credential-less login
    /// fallback retries across *every* address this install has ever
    /// remembered for this account ("retry across the list before ever
    /// re-prompting" — a fresh login is valid at any group node, since
    /// accounts/policies sync), but the refresh loop only retries the
    /// *same* refresh token against addresses of the *same peer node* that
    /// issued it (`refreshCandidateBaseURLs(for:)`) — refresh tokens are
    /// never synced across peer nodes, so a genuinely different node is
    /// guaranteed to reject one it never issued.
    private let serverGroupStore: KnownServerGroupStoring?
    private let session: URLSession
    private let decoder = PlayarrJSONCoding.makeDecoder()
    private let encoder = PlayarrJSONCoding.makeEncoder()
    private var inFlight: Task<Sensitive<String>, Error>?

    init(
        configuration: APIClientConfiguration,
        tokenProvider: AccessTokenProviding,
        serverGroupStore: KnownServerGroupStoring?,
        session: URLSession
    ) {
        self.configuration = configuration
        self.tokenProvider = tokenProvider
        self.serverGroupStore = serverGroupStore
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
            for baseURL in await refreshCandidateBaseURLs(for: existing) {
                do {
                    let stored = try await performRefresh(
                        refreshToken: existing.refreshToken.exposeSecret(),
                        baseURL: baseURL
                    )
                    try await tokenProvider.storeSession(stored)
                    return stored.accessToken
                } catch {
                    // Try the next same-node address (§3.7: a refresh
                    // token issued by this session's peer node is never
                    // valid on a genuinely different one, so only another
                    // address of the *same* node is worth retrying here)
                    // rather than giving up on the first failure -- only
                    // once every same-node candidate has failed does this
                    // fall through to a full re-login.
                    continue
                }
            }
            try? await tokenProvider.clearSession()
        }

        // Credential-less trusted-network login, same retry-across-the-list
        // treatment. `lastLoginError` seeds to a real `APIError` so a
        // (never-expected) empty candidate list still throws something
        // meaningful rather than silently returning; every real call
        // through this loop overwrites it with the actual failure.
        var lastLoginError: Error = APIError.invalidBaseURL
        for baseURL in await candidateBaseURLs() {
            do {
                let stored = try await performLogin(baseURL: baseURL)
                try await tokenProvider.storeSession(stored)
                return stored.accessToken
            } catch {
                lastLoginError = error
            }
        }
        throw lastLoginError
    }

    /// `configuration.baseURL` first (today's only candidate when no group
    /// is known — preserves this coordinator's original one-address
    /// behavior exactly), then every other address this install's
    /// `KnownServerGroup` remembers, `lastGoodURL` first, deduplicated.
    /// **Any-node** — used only by the credential-less login fallback
    /// (`acquireAccessToken`'s second loop), which is valid to attempt at
    /// any group member since accounts/policies sync (§3.7). The refresh
    /// loop deliberately does *not* use this — see
    /// `refreshCandidateBaseURLs(for:)`.
    private func candidateBaseURLs() async -> [URL] {
        var urls: [URL] = [configuration.baseURL]
        guard let serverGroupStore, let group = await serverGroupStore.currentGroup() else {
            return urls
        }

        var ordered: [String] = []
        if let lastGoodURL = group.lastGoodURL {
            ordered.append(lastGoodURL)
        }
        for server in group.servers where !ordered.contains(server.url) {
            ordered.append(server.url)
        }
        for candidate in ordered {
            guard let url = URL(string: candidate), !urls.contains(url) else { continue }
            urls.append(url)
        }
        return urls
    }

    /// `configuration.baseURL` first (always attempted, exactly like
    /// `candidateBaseURLs()`), then only the addresses `sameNodeAddresses
    /// (in:peerNodeID:)` attributes to the *same peer node* that issued
    /// `session`'s access token (its `iss` claim, decoded via
    /// `JWTClaims.issuerPeerID(ofAccessToken:)` — a routing hint only,
    /// no signature verification needed since this app already trusts a
    /// token it was just handed over HTTPS). **Same-node only** — §3.7:
    /// refresh tokens are never synced across peer nodes, so a genuinely
    /// different node is guaranteed to reject a token it never issued;
    /// retrying against it would just be several guaranteed-401 round
    /// trips before the real fallback (a fresh login, which *is* valid at
    /// any node) ever runs. When the issuing peer can't be determined —
    /// no known group, a non-UUID `iss` (a standalone node's HS256
    /// issuer string), or a malformed token — this degrades to exactly
    /// `[configuration.baseURL]`, the same inert, single-address behavior
    /// as having no group at all.
    private func refreshCandidateBaseURLs(for session: StoredAuthSession) async -> [URL] {
        var urls: [URL] = [configuration.baseURL]
        guard let serverGroupStore,
              let group = await serverGroupStore.currentGroup(),
              let issuingPeerNodeID = JWTClaims.issuerPeerID(ofAccessToken: session.accessToken.exposeSecret())
        else {
            return urls
        }

        for candidate in sameNodeAddresses(in: group, peerNodeID: issuingPeerNodeID) {
            guard let url = URL(string: candidate), !urls.contains(url) else { continue }
            urls.append(url)
        }
        return urls
    }

    private func performRefresh(refreshToken: String, baseURL: URL) async throws -> StoredAuthSession {
        let refreshed: RefreshResponse = try await post(
            path: "/api/v1/auth/refresh",
            body: RefreshRequest(deviceID: configuration.deviceID, refreshToken: refreshToken),
            baseURL: baseURL
        )
        await recordOutcome(peerAddresses: refreshed.peerAddresses, successfulURL: baseURL.absoluteString)
        return StoredAuthSession(
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            tokenType: refreshed.tokenType,
            expiresAt: Date().addingTimeInterval(TimeInterval(refreshed.expiresIn))
        )
    }

    private func performLogin(baseURL: URL) async throws -> StoredAuthSession {
        let loggedIn: LoginResponse = try await post(
            path: "/api/v1/auth/login",
            body: LoginRequest(
                deviceID: configuration.deviceID,
                deviceName: configuration.deviceName,
                clientPlatform: configuration.clientPlatform,
                clientVersion: configuration.clientVersion
            ),
            baseURL: baseURL
        )
        await recordOutcome(peerAddresses: loggedIn.peerAddresses, successfulURL: baseURL.absoluteString)
        return StoredAuthSession(
            accessToken: loggedIn.accessToken,
            refreshToken: loggedIn.refreshToken,
            tokenType: loggedIn.tokenType,
            expiresAt: Date().addingTimeInterval(TimeInterval(loggedIn.expiresIn))
        )
    }

    /// A successful refresh/login is this coordinator's only signal that
    /// `baseURL` is currently reachable -- feed it back into the known-
    /// server group (§7.1's self-healing) so the next `candidateBaseURLs()`
    /// fast-paths it via `lastGoodURL`, whether or not the server actually
    /// sent a fresh `PeerAddressBundle` this time.
    private func recordOutcome(peerAddresses: PeerAddressBundle?, successfulURL: String) async {
        guard let serverGroupStore else { return }
        if let peerAddresses {
            await serverGroupStore.merge(peerAddresses, successfulURL: successfulURL)
        } else {
            await serverGroupStore.recordSuccess(url: successfulURL)
        }
    }

    private func post<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body,
        baseURL: URL
    ) async throws -> Response {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidBaseURL
        }
        components.path += path
        guard let url = components.url else { throw APIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.clientPlatform.rawValue, forHTTPHeaderField: "X-Playarr-Client-Platform")
        request.setValue(configuration.clientVersion, forHTTPHeaderField: "X-Playarr-Client-Version")
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
