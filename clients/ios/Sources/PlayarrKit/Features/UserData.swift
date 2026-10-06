import Foundation

// Wire types for the self-service portable user-data routes
// (`docs/architecture/user-portability.md`, `docs/formats/user-data-export-v1.md`).
// Every field a newer server might omit has a default so decoding stays lenient.

public enum UserDataExportStatus: String, Codable, Sendable {
    case queued, running, ready, failed, expired
}

public struct UserDataExportProgress: Codable, Sendable, Equatable {
    public var stage: String
    public var done: Int
    public var total: Int

    public init(stage: String = "", done: Int = 0, total: Int = 0) {
        self.stage = stage
        self.done = done
        self.total = total
    }

    enum CodingKeys: String, CodingKey { case stage, done, total }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stage = try c.decodeIfPresent(String.self, forKey: .stage) ?? ""
        done = try c.decodeIfPresent(Int.self, forKey: .done) ?? 0
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
    }
}

public struct UserDataExportCounts: Codable, Sendable, Equatable {
    public var watchProgress: Int
    public var playbackPreferences: Int
    public var playlists: Int
    public var playlistItems: Int
    public var skipped: Int

    public init(watchProgress: Int = 0, playbackPreferences: Int = 0, playlists: Int = 0, playlistItems: Int = 0, skipped: Int = 0) {
        self.watchProgress = watchProgress
        self.playbackPreferences = playbackPreferences
        self.playlists = playlists
        self.playlistItems = playlistItems
        self.skipped = skipped
    }

    enum CodingKeys: String, CodingKey {
        case watchProgress = "watch_progress"
        case playbackPreferences = "playback_preferences"
        case playlists
        case playlistItems = "playlist_items"
        case skipped
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        watchProgress = try c.decodeIfPresent(Int.self, forKey: .watchProgress) ?? 0
        playbackPreferences = try c.decodeIfPresent(Int.self, forKey: .playbackPreferences) ?? 0
        playlists = try c.decodeIfPresent(Int.self, forKey: .playlists) ?? 0
        playlistItems = try c.decodeIfPresent(Int.self, forKey: .playlistItems) ?? 0
        skipped = try c.decodeIfPresent(Int.self, forKey: .skipped) ?? 0
    }
}

public struct UserDataExportJob: Codable, Sendable, Equatable {
    public var id: String
    public var status: UserDataExportStatus
    public var progress: UserDataExportProgress
    public var counts: UserDataExportCounts
    public var sizeBytes: Int64?
    public var error: String?

    enum CodingKeys: String, CodingKey {
        case id, status, progress, counts, error
        case sizeBytes = "size_bytes"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = (try? c.decode(UserDataExportStatus.self, forKey: .status)) ?? .failed
        progress = try c.decodeIfPresent(UserDataExportProgress.self, forKey: .progress) ?? UserDataExportProgress()
        counts = try c.decodeIfPresent(UserDataExportCounts.self, forKey: .counts) ?? UserDataExportCounts()
        sizeBytes = try c.decodeIfPresent(Int64.self, forKey: .sizeBytes)
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }
}

/// A one-time, 15-minute link another device opens (shown as a QR code on Apple TV).
public struct UserDataTransferLink: Codable, Sendable, Equatable {
    public var path: String
    public var url: String
    public var expiresAt: String

    enum CodingKeys: String, CodingKey {
        case path, url
        case expiresAt = "expires_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt) ?? ""
    }
}

public struct UserDataImportSession: Codable, Sendable, Equatable {
    public var id: String
    /// `waiting`, `uploading` or `uploaded`; kept as text so a newer server does not break decoding.
    public var status: String
    public var uploadURL: String?
    public var uploadPath: String?
    public var expiresAt: String
    public var sizeBytes: Int64?

    public var isUploaded: Bool { status == "uploaded" }

    enum CodingKeys: String, CodingKey {
        case id, status
        case uploadURL = "upload_url"
        case uploadPath = "upload_path"
        case expiresAt = "expires_at"
        case sizeBytes = "size_bytes"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "waiting"
        uploadURL = try c.decodeIfPresent(String.self, forKey: .uploadURL)
        uploadPath = try c.decodeIfPresent(String.self, forKey: .uploadPath)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt) ?? ""
        sizeBytes = try c.decodeIfPresent(Int64.self, forKey: .sizeBytes)
    }
}

public struct UserDataSectionSummary: Codable, Sendable, Equatable {
    public var total = 0
    public var willAdd = 0
    public var willUpdate = 0
    public var alreadyPresent = 0
    public var conflictsKept = 0
    public var unmatched = 0
    public var ambiguous = 0

    public init() {}

    enum CodingKeys: String, CodingKey {
        case total, unmatched, ambiguous
        case willAdd = "will_add"
        case willUpdate = "will_update"
        case alreadyPresent = "already_present"
        case conflictsKept = "conflicts_kept"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
        willAdd = try c.decodeIfPresent(Int.self, forKey: .willAdd) ?? 0
        willUpdate = try c.decodeIfPresent(Int.self, forKey: .willUpdate) ?? 0
        alreadyPresent = try c.decodeIfPresent(Int.self, forKey: .alreadyPresent) ?? 0
        conflictsKept = try c.decodeIfPresent(Int.self, forKey: .conflictsKept) ?? 0
        unmatched = try c.decodeIfPresent(Int.self, forKey: .unmatched) ?? 0
        ambiguous = try c.decodeIfPresent(Int.self, forKey: .ambiguous) ?? 0
    }
}

public struct UserDataPlaylistSummary: Codable, Sendable, Equatable {
    public var total = 0
    public var new = 0
    public var existing = 0
    public var itemsTotal = 0
    public var itemsToAdd = 0
    public var itemsAlreadyPresent = 0
    public var itemsUnmatched = 0

    public init() {}

    enum CodingKeys: String, CodingKey {
        case total, new, existing
        case itemsTotal = "items_total"
        case itemsToAdd = "items_to_add"
        case itemsAlreadyPresent = "items_already_present"
        case itemsUnmatched = "items_unmatched"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
        new = try c.decodeIfPresent(Int.self, forKey: .new) ?? 0
        existing = try c.decodeIfPresent(Int.self, forKey: .existing) ?? 0
        itemsTotal = try c.decodeIfPresent(Int.self, forKey: .itemsTotal) ?? 0
        itemsToAdd = try c.decodeIfPresent(Int.self, forKey: .itemsToAdd) ?? 0
        itemsAlreadyPresent = try c.decodeIfPresent(Int.self, forKey: .itemsAlreadyPresent) ?? 0
        itemsUnmatched = try c.decodeIfPresent(Int.self, forKey: .itemsUnmatched) ?? 0
    }
}

public struct UserDataWatchlistSummary: Codable, Sendable, Equatable {
    public var total = 0
    public var willAdd = 0
    public var alreadyPresent = 0
    public var unmatched = 0

    public init() {}

    enum CodingKeys: String, CodingKey {
        case total, unmatched
        case willAdd = "will_add"
        case alreadyPresent = "already_present"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
        willAdd = try c.decodeIfPresent(Int.self, forKey: .willAdd) ?? 0
        alreadyPresent = try c.decodeIfPresent(Int.self, forKey: .alreadyPresent) ?? 0
        unmatched = try c.decodeIfPresent(Int.self, forKey: .unmatched) ?? 0
    }
}

public struct UserDataImportSummary: Codable, Sendable, Equatable {
    public var watchProgress = UserDataSectionSummary()
    public var playlists = UserDataPlaylistSummary()
    /// Nil when the server predates the watchlist section.
    public var watchlist: UserDataWatchlistSummary?
    public var preferredAudioLanguageChange: String?
    public var playbackPreferencesNotApplied = 0
    public var unmatchedTotal = 0

    public init() {}

    enum CodingKeys: String, CodingKey {
        case playlists, watchlist
        case watchProgress = "watch_progress"
        case preferredAudioLanguageChange = "preferred_audio_language_change"
        case playbackPreferencesNotApplied = "playback_preferences_not_applied"
        case unmatchedTotal = "unmatched_total"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        watchProgress = try c.decodeIfPresent(UserDataSectionSummary.self, forKey: .watchProgress) ?? UserDataSectionSummary()
        playlists = try c.decodeIfPresent(UserDataPlaylistSummary.self, forKey: .playlists) ?? UserDataPlaylistSummary()
        watchlist = try c.decodeIfPresent(UserDataWatchlistSummary.self, forKey: .watchlist)
        preferredAudioLanguageChange = try c.decodeIfPresent(String.self, forKey: .preferredAudioLanguageChange)
        playbackPreferencesNotApplied = try c.decodeIfPresent(Int.self, forKey: .playbackPreferencesNotApplied) ?? 0
        unmatchedTotal = try c.decodeIfPresent(Int.self, forKey: .unmatchedTotal) ?? 0
    }
}

public struct UserDataImportSample: Codable, Sendable, Equatable {
    public var section: String
    public var title: String
    public var outcome: String
    public var playlist: String?
    public var candidates: [String]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        section = try c.decodeIfPresent(String.self, forKey: .section) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        outcome = try c.decodeIfPresent(String.self, forKey: .outcome) ?? ""
        playlist = try c.decodeIfPresent(String.self, forKey: .playlist)
        candidates = try c.decodeIfPresent([String].self, forKey: .candidates) ?? []
    }

    enum CodingKeys: String, CodingKey { case section, title, outcome, playlist, candidates }
}

public struct UserDataImportPreview: Codable, Sendable, Equatable {
    public var packageSHA256: String
    public var generatedAt: String
    public var sourceInstanceName: String
    public var summary: UserDataImportSummary
    public var warnings: [String]
    public var samples: [UserDataImportSample]

    enum CodingKeys: String, CodingKey {
        case summary, warnings, samples
        case packageSHA256 = "package_sha256"
        case generatedAt = "generated_at"
        case sourceInstanceName = "source_instance_name"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        packageSHA256 = try c.decode(String.self, forKey: .packageSHA256)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        sourceInstanceName = try c.decodeIfPresent(String.self, forKey: .sourceInstanceName) ?? ""
        summary = try c.decodeIfPresent(UserDataImportSummary.self, forKey: .summary) ?? UserDataImportSummary()
        warnings = try c.decodeIfPresent([String].self, forKey: .warnings) ?? []
        samples = try c.decodeIfPresent([UserDataImportSample].self, forKey: .samples) ?? []
    }
}

public struct UserDataImportResult: Codable, Sendable, Equatable {
    public var completed: Bool
    public var progressAdded: Int
    public var progressUpdated: Int
    public var progressUnchanged: Int
    public var progressConflictsKept: Int
    public var playlistsCreated: Int
    public var playlistItemsAdded: Int
    public var playlistItemsAlreadyPresent: Int
    public var preferredAudioLanguageUpdated: Bool
    public var unmatchedTotal: Int
    public var failure: String?
    public var sectionsNotAttempted: [String]

    enum CodingKeys: String, CodingKey {
        case completed, failure
        case progressAdded = "progress_added"
        case progressUpdated = "progress_updated"
        case progressUnchanged = "progress_unchanged"
        case progressConflictsKept = "progress_conflicts_kept"
        case playlistsCreated = "playlists_created"
        case playlistItemsAdded = "playlist_items_added"
        case playlistItemsAlreadyPresent = "playlist_items_already_present"
        case preferredAudioLanguageUpdated = "preferred_audio_language_updated"
        case unmatchedTotal = "unmatched_total"
        case sectionsNotAttempted = "sections_not_attempted"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        completed = try c.decode(Bool.self, forKey: .completed)
        progressAdded = try c.decodeIfPresent(Int.self, forKey: .progressAdded) ?? 0
        progressUpdated = try c.decodeIfPresent(Int.self, forKey: .progressUpdated) ?? 0
        progressUnchanged = try c.decodeIfPresent(Int.self, forKey: .progressUnchanged) ?? 0
        progressConflictsKept = try c.decodeIfPresent(Int.self, forKey: .progressConflictsKept) ?? 0
        playlistsCreated = try c.decodeIfPresent(Int.self, forKey: .playlistsCreated) ?? 0
        playlistItemsAdded = try c.decodeIfPresent(Int.self, forKey: .playlistItemsAdded) ?? 0
        playlistItemsAlreadyPresent = try c.decodeIfPresent(Int.self, forKey: .playlistItemsAlreadyPresent) ?? 0
        preferredAudioLanguageUpdated = try c.decodeIfPresent(Bool.self, forKey: .preferredAudioLanguageUpdated) ?? false
        unmatchedTotal = try c.decodeIfPresent(Int.self, forKey: .unmatchedTotal) ?? 0
        failure = try c.decodeIfPresent(String.self, forKey: .failure)
        sectionsNotAttempted = try c.decodeIfPresent([String].self, forKey: .sectionsNotAttempted) ?? []
    }
}

/// How an import treats progress that already exists and differs.
public enum UserDataProgressConflicts: String, Sendable, CaseIterable {
    case newest
    case keepExisting = "keep_existing"
}

/// Options shared by import preview and apply.
public struct UserDataImportOptions: Sendable, Equatable {
    public var includePreferences: Bool
    public var progressConflicts: UserDataProgressConflicts

    public init(includePreferences: Bool = false, progressConflicts: UserDataProgressConflicts = .newest) {
        self.includePreferences = includePreferences
        self.progressConflicts = progressConflicts
    }

    var queryItems: [URLQueryItem] {
        [
            URLQueryItem(name: "include_preferences", value: includePreferences ? "true" : "false"),
            URLQueryItem(name: "progress_conflicts", value: progressConflicts.rawValue),
        ]
    }
}

/// Client for the account's own portable data. The subject is always the
/// signed-in user; no user id is ever sent.
public struct UserDataClient: Sendable {
    private let transport: PlayarrRequestTransport

    public init(transport: PlayarrRequestTransport) {
        self.transport = transport
    }

    private static let base = "/api/v1/users/me"

    public func startExport() async throws -> UserDataExportJob {
        try await transport.requestJSON(method: "POST", "\(Self.base)/data-exports")
    }

    public func exportJob(id: String) async throws -> UserDataExportJob {
        try await transport.getJSON("\(Self.base)/data-exports/\(id)")
    }

    /// Downloads the ready package (a ZIP). Held in memory: packages carry progress and playlists, not media.
    public func downloadExport(id: String) async throws -> Data {
        try await transport.requestData(
            method: "GET", path: "\(Self.base)/data-exports/\(id)/download",
            query: [], body: nil, expectedStatuses: [200]
        )
    }

    public func createExportTransferLink(id: String) async throws -> UserDataTransferLink {
        try await transport.requestJSON(method: "POST", "\(Self.base)/data-exports/\(id)/transfer-link")
    }

    public func createImportSession() async throws -> UserDataImportSession {
        try await transport.requestJSON(method: "POST", "\(Self.base)/data-import-sessions")
    }

    public func importSession(id: String) async throws -> UserDataImportSession {
        try await transport.getJSON("\(Self.base)/data-import-sessions/\(id)")
    }

    public func deleteImportSession(id: String) async throws {
        try await transport.sendNoContent(method: "DELETE", "\(Self.base)/data-import-sessions/\(id)")
    }

    public func previewSession(id: String, options: UserDataImportOptions) async throws -> UserDataImportPreview {
        try await transport.requestJSON(
            method: "POST", "\(Self.base)/data-import-sessions/\(id)/preview",
            query: options.queryItems
        )
    }

    public func applySession(id: String, packageSHA256: String, options: UserDataImportOptions) async throws -> UserDataImportResult {
        try await transport.requestJSON(
            method: "POST", "\(Self.base)/data-import-sessions/\(id)/apply",
            query: [URLQueryItem(name: "package_sha256", value: packageSHA256)] + options.queryItems
        )
    }

    /// Direct import of a package picked on this device (iPhone and iPad).
    public func previewImport(package: Data, options: UserDataImportOptions) async throws -> UserDataImportPreview {
        let data = try await upload(path: "\(Self.base)/data-imports/preview", package: package, query: options.queryItems)
        return try Self.decode(data)
    }

    public func applyImport(package: Data, packageSHA256: String, options: UserDataImportOptions) async throws -> UserDataImportResult {
        let data = try await upload(
            path: "\(Self.base)/data-imports", package: package,
            query: [URLQueryItem(name: "package_sha256", value: packageSHA256)] + options.queryItems
        )
        return try Self.decode(data)
    }

    /// A package of everything the previewed import could not place, valid for a later import.
    public func unmatchedPackage(package: Data, options: UserDataImportOptions) async throws -> Data {
        try await upload(path: "\(Self.base)/data-imports/unmatched", package: package, query: options.queryItems)
    }

    private func upload(path: String, package: Data, query: [URLQueryItem]) async throws -> Data {
        guard let uploader = transport as? PlayarrUploadTransport else {
            throw APIError.http(status: 501, body: nil, rawBody: nil)
        }
        return try await uploader.uploadData(
            method: "POST", path: path, query: query, body: package,
            contentType: "application/zip", expectedStatuses: [200]
        )
    }

    private static func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try PlayarrJSONCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
