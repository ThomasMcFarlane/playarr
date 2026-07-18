import Foundation

// MARK: - Generated client notice
//
// The Codable types in this file are a hand-written mirror of every
// `components.schemas` entry in `backend/openapi/streamarr.yaml` (Streamarr
// API, OpenAPI 3.1.0). They were written by reading that spec directly
// (and, for wire-shape details the spec leaves implicit — enum casing,
// discriminator tags, date formats — the real `#[derive(Serialize,
// Deserialize)]` Rust structs/enums under `backend/crates/streamarr-model`,
// `streamarr-catalog`, `streamarr-auth`, and
// `streamarr-api` those schemas mirror), not inferred/guessed. A one-shot
// `openapi-generator-cli generate -g swift5` run was considered instead of
// hand-writing this file; hand-writing won because several of these schemas
// need custom `Codable` conformances the generic Swift5 generator doesn't
// produce correctly out of the box:
//   - `ExternalProvider` is a `oneOf` of bare-string-enum variants plus an
//     `{"other": "..."}` escape hatch (Rust's default externally-tagged
//     representation for a mixed unit/tuple-variant enum).
//   - `WorkChildren` is a `oneOf` where the unit variant (`Movie`)
//     serializes as a bare JSON string and the tuple variants
//     (`Series`/`Artist`/`Author`) serialize as single-key objects —
//     Rust's default externally-tagged enum representation again.
// Every type below has explicit `CodingKeys` (snake_case wire format,
// confirmed against the real Rust structs — no crate-wide `rename_all` on
// structs, `rename_all = "snake_case"` on enums) and an explicit
// `public init(...)`, matching this package's existing convention (see
// `Models/Sensitive.swift`) since Swift doesn't synthesize a `public`
// memberwise initializer and `StreamarrApp` (a separate module) needs to
// construct these directly in previews/tests.
//
// Field-by-field provenance: every struct/enum below is checked against
// its Rust source (`backend/crates/streamarr-model/src/{work,series,music,
// publishing,platform}.rs`, `streamarr-catalog/src/lib.rs`,
// `streamarr-auth/src/device_flow.rs`,
// `streamarr-api/src/{oauth,catalog,playback}.rs`) as well as
// `backend/openapi/streamarr.yaml` itself, not just the doc-only
// `*Schema`-suffixed OpenAPI mirror types (which some handlers use purely
// for `utoipa` docs while actually returning the real domain type — the
// wire shape is identical either way, since the doc-only mirrors are kept
// in lock-step by hand).
//
// Round D update: `WorkDetailSchema`/`EpisodeDetailSchema`/
// `TrackDetailSchema`/`BookDetailSchema` now each carry a real, nullable
// `media_file_id` sibling field (`WorkDetail.mediaFileID`,
// `EpisodeDetail`/`TrackDetail`/`BookDetail` wrapper structs) — the
// catalog/playback cross-link that a prior pass's doc comments correctly
// flagged as a real backend gap (no `MediaFileRepo`) is resolved
// server-side now; see `WorkDetailViewModel`/`WorkDetailView` for where the
// client actually consumes it.
//
// This file also gains `LoginRequest`/`LoginResponse` for the
// `POST /api/v1/auth/login` endpoint — see that section further down for
// the trusted-network-mode note.

// MARK: - Enums

/// The top-level taxonomy Streamarr understands (`WorkKind` in
/// `streamarr-model/src/work.rs`, `#[serde(rename_all = "snake_case")]`).
public enum WorkKind: String, Codable, Sendable, CaseIterable, Hashable {
    case movie
    case series
    case artist
    case author
}

/// Where in the availability pipeline a `Work` (or a leaf under it) is
/// sitting (`Availability` in `work.rs`, `#[serde(rename_all =
/// "snake_case")]`).
public enum Availability: String, Codable, Sendable, CaseIterable, Hashable {
    case unknown
    case pending
    case processing
    case partiallyAvailable = "partially_available"
    case available
    case deleted
}

public enum ImageKind: String, Codable, Sendable, CaseIterable, Hashable {
    case poster
    case backdrop
    case banner
    case logo
    case thumb
}

/// Every first-party client surface Streamarr ships (`ClientPlatform` in
/// `platform.rs`, `#[serde(rename_all = "kebab-case")]` — note this is
/// kebab-case, not snake_case, unlike almost everything else in the spec).
public enum ClientPlatform: String, Codable, Sendable, CaseIterable, Hashable {
    case androidMobile = "android-mobile"
    case androidTV = "android-tv"
    case ios
    case web
    case tvWebOS = "tv-webos"
    case tvTizen = "tv-tizen"
    case tvVidaa = "tv-vidaa"
}

public enum AlbumType: String, Codable, Sendable, CaseIterable, Hashable {
    case studio
    case live
    case compilation
    case ep
    case single
    case soundtrack
}

public enum PlaybackMode: String, Codable, Sendable, CaseIterable, Hashable {
    case direct
    case hls
}

/// A cross-reference to the identifier a `Work` (or one of its source
/// records) is known by in an external metadata provider
/// (`ExternalProvider` in `work.rs`). Rust's default externally-tagged
/// representation for a `#[serde(rename_all = "snake_case")]` enum mixing
/// unit variants and one tuple variant: unit variants serialize as a bare
/// JSON string (`"tmdb"`), the `Other(String)` escape hatch serializes as
/// `{"other": "..."}`.
public enum ExternalProvider: Codable, Sendable, Hashable {
    case tmdb
    case tvdb
    case imdb
    case musicBrainzArtist
    case musicBrainzReleaseGroup
    case goodreads
    case isbn
    case asin
    /// Escape hatch for providers with no first-class variant yet (e.g.
    /// AniDB, Discogs) — mirrors `ExternalProvider::Other(String)`.
    case other(String)

    private enum ObjectCodingKeys: String, CodingKey {
        case other
    }

    public init(from decoder: Decoder) throws {
        if let container = try? decoder.singleValueContainer(),
           let raw = try? container.decode(String.self) {
            switch raw {
            case "tmdb": self = .tmdb
            case "tvdb": self = .tvdb
            case "imdb": self = .imdb
            case "music_brainz_artist": self = .musicBrainzArtist
            case "music_brainz_release_group": self = .musicBrainzReleaseGroup
            case "goodreads": self = .goodreads
            case "isbn": self = .isbn
            case "asin": self = .asin
            default:
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Unrecognized ExternalProvider string \"\(raw)\""
                )
            }
            return
        }

        let keyed = try decoder.container(keyedBy: ObjectCodingKeys.self)
        let otherValue = try keyed.decode(String.self, forKey: .other)
        self = .other(otherValue)
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .tmdb, .tvdb, .imdb, .musicBrainzArtist, .musicBrainzReleaseGroup, .goodreads, .isbn, .asin:
            var container = encoder.singleValueContainer()
            try container.encode(wireStringValue)
        case .other(let value):
            var container = encoder.container(keyedBy: ObjectCodingKeys.self)
            try container.encode(value, forKey: .other)
        }
    }

    private var wireStringValue: String {
        switch self {
        case .tmdb: return "tmdb"
        case .tvdb: return "tvdb"
        case .imdb: return "imdb"
        case .musicBrainzArtist: return "music_brainz_artist"
        case .musicBrainzReleaseGroup: return "music_brainz_release_group"
        case .goodreads: return "goodreads"
        case .isbn: return "isbn"
        case .asin: return "asin"
        case .other(let value): return value
        }
    }
}

// MARK: - Structs

public struct ExternalRef: Codable, Hashable, Sendable {
    public var provider: ExternalProvider
    public var externalID: String

    enum CodingKeys: String, CodingKey {
        case provider
        case externalID = "external_id"
    }

    public init(provider: ExternalProvider, externalID: String) {
        self.provider = provider
        self.externalID = externalID
    }
}

/// A poster/backdrop/etc image attached to a `Work`. `url` is a plain
/// `String` (not `URL`/`format: uri` in the spec) — build a `URL` with
/// `URL(string:)` at the call site if needed.
public struct ImageAsset: Codable, Hashable, Sendable {
    public var kind: ImageKind
    public var url: String
    public var width: Int?
    public var height: Int?

    public init(kind: ImageKind, url: String, width: Int? = nil, height: Int? = nil) {
        self.kind = kind
        self.url = url
        self.width = width
        self.height = height
    }
}

/// The aggregate root for anything in the catalog — a movie is a `Work` of
/// kind `.movie` with no children; a series/artist/author is a `Work` whose
/// children (seasons, albums, books) come back in `WorkDetail.children`.
public struct Work: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var kind: WorkKind
    public var externalRefs: [ExternalRef]
    public var title: String
    public var sortTitle: String
    public var overview: String?
    public var images: [ImageAsset]
    public var genres: [String]
    public var tags: [String]
    public var addedAt: Date
    public var monitored: Bool
    public var availability: Availability

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case externalRefs = "external_refs"
        case title
        case sortTitle = "sort_title"
        case overview
        case images
        case genres
        case tags
        case addedAt = "added_at"
        case monitored
        case availability
    }

    public init(
        id: UUID,
        kind: WorkKind,
        externalRefs: [ExternalRef] = [],
        title: String,
        sortTitle: String,
        overview: String? = nil,
        images: [ImageAsset] = [],
        genres: [String] = [],
        tags: [String] = [],
        addedAt: Date,
        monitored: Bool,
        availability: Availability
    ) {
        self.id = id
        self.kind = kind
        self.externalRefs = externalRefs
        self.title = title
        self.sortTitle = sortTitle
        self.overview = overview
        self.images = images
        self.genres = genres
        self.tags = tags
        self.addedAt = addedAt
        self.monitored = monitored
        self.availability = availability
    }
}

/// A page of `GET /api/v1/catalog` (or `.../search`) results. `total` is
/// `nil` when the server skipped the count query.
public struct CatalogPage: Codable, Sendable {
    public var items: [Work]
    public var total: Int64?

    public init(items: [Work], total: Int64? = nil) {
        self.items = items
        self.total = total
    }
}

public struct Season: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var seriesWorkID: UUID
    public var seasonNumber: Int32
    public var title: String?
    public var overview: String?
    public var monitored: Bool
    public var availability: Availability

    enum CodingKeys: String, CodingKey {
        case id
        case seriesWorkID = "series_work_id"
        case seasonNumber = "season_number"
        case title
        case overview
        case monitored
        case availability
    }

    public init(
        id: UUID,
        seriesWorkID: UUID,
        seasonNumber: Int32,
        title: String? = nil,
        overview: String? = nil,
        monitored: Bool,
        availability: Availability
    ) {
        self.id = id
        self.seriesWorkID = seriesWorkID
        self.seasonNumber = seasonNumber
        self.title = title
        self.overview = overview
        self.monitored = monitored
        self.availability = availability
    }
}

/// `air_date`/`release_date`-style fields are Rust `NaiveDate` (plain
/// `YYYY-MM-DD`, no time/offset) — kept as `String?` rather than `Date?`
/// here since Foundation has no zero-config `YYYY-MM-DD`-only decoder and
/// nothing in this client does date arithmetic on them yet; render as-is or
/// parse with a `DateFormatter` (`dateFormat = "yyyy-MM-dd"`) at the call
/// site if that changes.
public struct Episode: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var seasonID: UUID
    public var episodeNumber: Int32
    public var title: String?
    public var overview: String?
    public var airDate: String?
    public var runtimeMinutes: Int32?
    public var monitored: Bool
    public var availability: Availability

    enum CodingKeys: String, CodingKey {
        case id
        case seasonID = "season_id"
        case episodeNumber = "episode_number"
        case title
        case overview
        case airDate = "air_date"
        case runtimeMinutes = "runtime_minutes"
        case monitored
        case availability
    }

    public init(
        id: UUID,
        seasonID: UUID,
        episodeNumber: Int32,
        title: String? = nil,
        overview: String? = nil,
        airDate: String? = nil,
        runtimeMinutes: Int32? = nil,
        monitored: Bool,
        availability: Availability
    ) {
        self.id = id
        self.seasonID = seasonID
        self.episodeNumber = episodeNumber
        self.title = title
        self.overview = overview
        self.airDate = airDate
        self.runtimeMinutes = runtimeMinutes
        self.monitored = monitored
        self.availability = availability
    }
}

/// Doc-only mirrored as `EpisodeDetailSchema` in the spec: the resolved
/// `MediaFile` id (via `MediaFileRepo::find_by_leaf`) that plays this
/// episode, `nil` when no file has synced for it yet. `id` mirrors the
/// wrapped `Episode.id` so this conforms to `Identifiable` directly (call
/// sites that used to `ForEach` over `[Episode]` need no other change).
public struct EpisodeDetail: Codable, Identifiable, Hashable, Sendable {
    public var episode: Episode
    public var mediaFileID: UUID?

    public var id: UUID { episode.id }

    enum CodingKeys: String, CodingKey {
        case episode
        case mediaFileID = "media_file_id"
    }

    public init(episode: Episode, mediaFileID: UUID? = nil) {
        self.episode = episode
        self.mediaFileID = mediaFileID
    }
}

public struct SeasonDetail: Codable, Sendable {
    public var season: Season
    public var episodes: [EpisodeDetail]

    public init(season: Season, episodes: [EpisodeDetail]) {
        self.season = season
        self.episodes = episodes
    }
}

public struct Album: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var artistWorkID: UUID
    public var title: String
    public var albumType: AlbumType
    public var releaseDate: String?
    public var monitored: Bool
    public var availability: Availability

    enum CodingKeys: String, CodingKey {
        case id
        case artistWorkID = "artist_work_id"
        case title
        case albumType = "album_type"
        case releaseDate = "release_date"
        case monitored
        case availability
    }

    public init(
        id: UUID,
        artistWorkID: UUID,
        title: String,
        albumType: AlbumType,
        releaseDate: String? = nil,
        monitored: Bool,
        availability: Availability
    ) {
        self.id = id
        self.artistWorkID = artistWorkID
        self.title = title
        self.albumType = albumType
        self.releaseDate = releaseDate
        self.monitored = monitored
        self.availability = availability
    }
}

public struct Track: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var albumID: UUID
    public var discNumber: Int32
    public var trackNumber: Int32
    public var title: String
    public var durationSeconds: Int32?
    public var availability: Availability

    enum CodingKeys: String, CodingKey {
        case id
        case albumID = "album_id"
        case discNumber = "disc_number"
        case trackNumber = "track_number"
        case title
        case durationSeconds = "duration_seconds"
        case availability
    }

    public init(
        id: UUID,
        albumID: UUID,
        discNumber: Int32,
        trackNumber: Int32,
        title: String,
        durationSeconds: Int32? = nil,
        availability: Availability
    ) {
        self.id = id
        self.albumID = albumID
        self.discNumber = discNumber
        self.trackNumber = trackNumber
        self.title = title
        self.durationSeconds = durationSeconds
        self.availability = availability
    }
}

/// Doc-only mirrored as `TrackDetailSchema` in the spec; see
/// `EpisodeDetail`'s doc comment for the resolved-`media_file_id` shape
/// this mirrors (nullable, `nil` until a file's synced for this track).
public struct TrackDetail: Codable, Identifiable, Hashable, Sendable {
    public var track: Track
    public var mediaFileID: UUID?

    public var id: UUID { track.id }

    enum CodingKeys: String, CodingKey {
        case track
        case mediaFileID = "media_file_id"
    }

    public init(track: Track, mediaFileID: UUID? = nil) {
        self.track = track
        self.mediaFileID = mediaFileID
    }
}

public struct AlbumDetail: Codable, Sendable {
    public var album: Album
    public var tracks: [TrackDetail]

    public init(album: Album, tracks: [TrackDetail]) {
        self.album = album
        self.tracks = tracks
    }
}

public struct Book: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var authorWorkID: UUID
    public var title: String
    public var isbn: String?
    public var releaseDate: String?
    public var seriesName: String?
    public var seriesPosition: Double?
    public var monitored: Bool
    public var availability: Availability

    enum CodingKeys: String, CodingKey {
        case id
        case authorWorkID = "author_work_id"
        case title
        case isbn
        case releaseDate = "release_date"
        case seriesName = "series_name"
        case seriesPosition = "series_position"
        case monitored
        case availability
    }

    public init(
        id: UUID,
        authorWorkID: UUID,
        title: String,
        isbn: String? = nil,
        releaseDate: String? = nil,
        seriesName: String? = nil,
        seriesPosition: Double? = nil,
        monitored: Bool,
        availability: Availability
    ) {
        self.id = id
        self.authorWorkID = authorWorkID
        self.title = title
        self.isbn = isbn
        self.releaseDate = releaseDate
        self.seriesName = seriesName
        self.seriesPosition = seriesPosition
        self.monitored = monitored
        self.availability = availability
    }
}

/// Doc-only mirrored as `BookDetailSchema` in the spec; see
/// `EpisodeDetail`'s doc comment for the resolved-`media_file_id` shape
/// this mirrors (nullable — presumably an audiobook file, `nil` until one
/// has synced for this book).
public struct BookDetail: Codable, Identifiable, Hashable, Sendable {
    public var book: Book
    public var mediaFileID: UUID?

    public var id: UUID { book.id }

    enum CodingKeys: String, CodingKey {
        case book
        case mediaFileID = "media_file_id"
    }

    public init(book: Book, mediaFileID: UUID? = nil) {
        self.book = book
        self.mediaFileID = mediaFileID
    }
}

/// The kind-specific "full tree" hanging off a `Work` in `WorkDetail`
/// (`WorkChildren` in `streamarr-catalog/src/lib.rs`, a plain
/// `#[derive(Serialize, Deserialize)]` enum with no `#[serde(tag = ...)]` —
/// so it uses Rust/serde's default externally-tagged representation: the
/// unit variant `Movie` serializes as the bare string `"Movie"`; the tuple
/// variants serialize as a single-key object, e.g. `{"Series": [...]}`.
public enum WorkChildren: Codable, Sendable {
    case movie
    case series([SeasonDetail])
    case artist([AlbumDetail])
    case author([BookDetail])

    private enum ObjectCodingKeys: String, CodingKey {
        case series = "Series"
        case artist = "Artist"
        case author = "Author"
    }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let tag = try? single.decode(String.self) {
            if tag == "Movie" {
                self = .movie
                return
            }
            throw DecodingError.dataCorruptedError(
                in: single,
                debugDescription: "Unrecognized WorkChildren tag \"\(tag)\""
            )
        }

        let container = try decoder.container(keyedBy: ObjectCodingKeys.self)
        if let seasons = try container.decodeIfPresent([SeasonDetail].self, forKey: .series) {
            self = .series(seasons)
        } else if let albums = try container.decodeIfPresent([AlbumDetail].self, forKey: .artist) {
            self = .artist(albums)
        } else if let books = try container.decodeIfPresent([BookDetail].self, forKey: .author) {
            self = .author(books)
        } else {
            throw DecodingError.dataCorrupted(DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "WorkChildren object matched none of Series/Artist/Author"
            ))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .movie:
            var single = encoder.singleValueContainer()
            try single.encode("Movie")
        case .series(let seasons):
            var container = encoder.container(keyedBy: ObjectCodingKeys.self)
            try container.encode(seasons, forKey: .series)
        case .artist(let albums):
            var container = encoder.container(keyedBy: ObjectCodingKeys.self)
            try container.encode(albums, forKey: .artist)
        case .author(let books):
            var container = encoder.container(keyedBy: ObjectCodingKeys.self)
            try container.encode(books, forKey: .author)
        }
    }
}

/// Doc-only mirrored as `WorkDetailSchema` in the spec.
public struct WorkDetail: Codable, Sendable {
    public var work: Work
    public var children: WorkChildren
    /// The resolved `MediaFile` id for a movie's own leaf (`LeafRef::Work`)
    /// — always `nil` for series/artist/author works, whose playable leaves
    /// are their children instead (`EpisodeDetail`/`TrackDetail`/
    /// `BookDetail.mediaFileID`), and `nil` for a movie too until a file
    /// has synced for it.
    public var mediaFileID: UUID?

    enum CodingKeys: String, CodingKey {
        case work
        case children
        case mediaFileID = "media_file_id"
    }

    public init(work: Work, children: WorkChildren, mediaFileID: UUID? = nil) {
        self.work = work
        self.children = children
        self.mediaFileID = mediaFileID
    }
}

// MARK: - Auth (session login)

/// Request body for `POST /api/v1/auth/login` (Round E). Under the server's
/// default `AuthMode::TrustedNetwork`, a login from a trusted source IP
/// succeeds with none of the optional fields set — only the four required
/// ones matter in that mode. `password`/`pin`/`profile_user_id`/`username`
/// are consulted only under the stricter `AuthMode` tiers this client
/// doesn't drive today (`FullAccount`/`ManagedProfiles`/PIN-gated modes);
/// see each field's doc comment in `backend/openapi/streamarr.yaml`'s
/// `LoginRequest` schema for exactly which tier reads it.
public struct LoginRequest: Codable, Sendable {
    /// Client-generated, stable-per-install device id — resend the same
    /// value on every subsequent login/refresh from this install (mirrors
    /// the spec's own `device_id` doc comment).
    public var deviceID: UUID
    public var deviceName: String
    public var clientPlatform: ClientPlatform
    public var clientVersion: String
    public var password: String?
    public var pin: String?
    /// `AuthMode::ManagedProfiles` only; ignored by every other tier.
    public var profileUserID: UUID?
    /// `AuthMode::FullAccount` only; ignored by every other tier.
    public var username: String?

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case deviceName = "device_name"
        case clientPlatform = "client_platform"
        case clientVersion = "client_version"
        case password
        case pin
        case profileUserID = "profile_user_id"
        case username
    }

    public init(
        deviceID: UUID,
        deviceName: String,
        clientPlatform: ClientPlatform,
        clientVersion: String,
        password: String? = nil,
        pin: String? = nil,
        profileUserID: UUID? = nil,
        username: String? = nil
    ) {
        self.deviceID = deviceID
        self.deviceName = deviceName
        self.clientPlatform = clientPlatform
        self.clientVersion = clientVersion
        self.password = password
        self.pin = pin
        self.profileUserID = profileUserID
        self.username = username
    }
}

/// `POST /api/v1/auth/login`'s 200 response — the same access+refresh token
/// pair shape the RFC 8628 device-flow `TokenResponse` returns, plus the
/// server-resolved `user_id` this session belongs to (the one thing
/// `TokenResponse` doesn't carry).
public struct LoginResponse: Codable, Sendable {
    public var accessToken: String
    public var refreshToken: String
    public var tokenType: String
    public var expiresIn: Int64
    public var userID: UUID

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case userID = "user_id"
    }

    public init(accessToken: String, refreshToken: String, tokenType: String, expiresIn: Int64, userID: UUID) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.userID = userID
    }
}

/// Request body for `POST /api/v1/auth/refresh`.
public struct RefreshRequest: Codable, Sendable {
    public var deviceID: UUID
    public var refreshToken: String

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case refreshToken = "refresh_token"
    }

    public init(deviceID: UUID, refreshToken: String) {
        self.deviceID = deviceID
        self.refreshToken = refreshToken
    }
}

/// Rotated access/refresh pair returned by `POST /api/v1/auth/refresh`.
public struct RefreshResponse: Codable, Sendable {
    public var accessToken: String
    public var refreshToken: String
    public var tokenType: String
    public var expiresIn: Int64
    public var userID: UUID

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case userID = "user_id"
    }

    public init(accessToken: String, refreshToken: String, tokenType: String, expiresIn: Int64, userID: UUID) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.userID = userID
    }
}

// MARK: - OAuth device authorization grant (RFC 8628)

/// Request body for `POST /api/v1/oauth/device/code`.
public struct DeviceCodeRequest: Codable, Sendable {
    public var clientPlatform: ClientPlatform

    enum CodingKeys: String, CodingKey {
        case clientPlatform = "client_platform"
    }

    public init(clientPlatform: ClientPlatform) {
        self.clientPlatform = clientPlatform
    }
}

/// `POST /api/v1/oauth/device/code`'s 200 response (RFC 8628 §3.2).
public struct DeviceCodeResponse: Codable, Sendable {
    public var deviceCode: String
    public var userCode: String
    public var verificationUri: String
    public var verificationUriComplete: String
    public var expiresIn: Int64
    public var interval: Int64

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationUri = "verification_uri"
        case verificationUriComplete = "verification_uri_complete"
        case expiresIn = "expires_in"
        case interval
    }

    public init(
        deviceCode: String,
        userCode: String,
        verificationUri: String,
        verificationUriComplete: String,
        expiresIn: Int64,
        interval: Int64
    ) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationUri = verificationUri
        self.verificationUriComplete = verificationUriComplete
        self.expiresIn = expiresIn
        self.interval = interval
    }
}

/// Request body for `POST /api/v1/oauth/token`. `grantType` must equal
/// `DeviceTokenRequest.deviceCodeGrantType` (mirrors the server's
/// `streamarr_api::oauth::DEVICE_CODE_GRANT_TYPE` constant, RFC 8628 §3.4)
/// or the server rejects it with `unsupported_grant_type` before even
/// looking up the device code.
public struct DeviceTokenRequest: Codable, Sendable {
    /// The RFC 8628 §3.4 device-code grant type URN — the only value the
    /// server currently accepts for `grant_type`.
    public static let deviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code"

    public var deviceCode: String
    public var grantType: String

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case grantType = "grant_type"
    }

    public init(deviceCode: String, grantType: String = DeviceTokenRequest.deviceCodeGrantType) {
        self.deviceCode = deviceCode
        self.grantType = grantType
    }
}

/// `POST /api/v1/oauth/token`'s 200 response.
public struct TokenResponse: Codable, Sendable {
    public var accessToken: String
    public var tokenType: String
    public var expiresIn: Int64
    public var refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
    }

    public init(accessToken: String, tokenType: String, expiresIn: Int64, refreshToken: String) {
        self.accessToken = accessToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.refreshToken = refreshToken
    }
}

/// `POST /api/v1/oauth/token`'s 400 response body. `error` is one of RFC
/// 8628 §3.5's four device-flow error codes, or RFC 6749 §5.2's
/// `unsupported_grant_type` — see `DeviceFlowErrorCode` in
/// `Auth/DeviceFlowClient.swift` for the typed version of this string.
public struct OAuthErrorBody: Codable, Sendable {
    public var error: String

    public init(error: String) {
        self.error = error
    }
}

// MARK: - Playback

/// `GET /api/v1/playback/{media_file_id}`'s 200 response. `url` is a plain
/// `String`, not `URL` — per the spec it may be a path relative to the API
/// server (see `StreamarrAPIClient.resolvedPlaybackURL(for:)`), not
/// necessarily an absolute URL.
public struct PlaybackInfoResponse: Codable, Sendable {
    public var mode: PlaybackMode
    public var url: String

    public init(mode: PlaybackMode, url: String) {
        self.mode = mode
        self.url = url
    }
}

// MARK: - System / version

public struct CompatibilityEntry: Codable, Sendable, Hashable {
    public var platform: ClientPlatform
    public var latestVersion: String
    public var minSupportedVersion: String
    public var deprecatedBelow: String?
    public var sunset: String?

    enum CodingKeys: String, CodingKey {
        case platform
        case latestVersion = "latest_version"
        case minSupportedVersion = "min_supported_version"
        case deprecatedBelow = "deprecated_below"
        case sunset
    }

    public init(
        platform: ClientPlatform,
        latestVersion: String,
        minSupportedVersion: String,
        deprecatedBelow: String? = nil,
        sunset: String? = nil
    ) {
        self.platform = platform
        self.latestVersion = latestVersion
        self.minSupportedVersion = minSupportedVersion
        self.deprecatedBelow = deprecatedBelow
        self.sunset = sunset
    }
}

/// `GET /api/system/version`'s response body.
public struct VersionEnvelope: Codable, Sendable {
    public var serverVersion: String
    public var apiVersion: String
    public var buildSha: String?
    public var compatibility: [CompatibilityEntry]

    enum CodingKeys: String, CodingKey {
        case serverVersion = "server_version"
        case apiVersion = "api_version"
        case buildSha = "build_sha"
        case compatibility
    }

    public init(
        serverVersion: String,
        apiVersion: String,
        buildSha: String? = nil,
        compatibility: [CompatibilityEntry] = []
    ) {
        self.serverVersion = serverVersion
        self.apiVersion = apiVersion
        self.buildSha = buildSha
        self.compatibility = compatibility
    }
}

// MARK: - Generic API error body

/// The `{"error": "<code>", "message": "<...>"}` shape every non-OAuth
/// error response in the spec uses (`streamarr_api::error::ErrorBody`).
public struct APIErrorBody: Codable, Sendable {
    public var error: String
    public var message: String

    public init(error: String, message: String) {
        self.error = error
        self.message = message
    }
}
