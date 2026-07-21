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
    case site
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

// MARK: - Viewer library state

public enum WatchState: String, Codable, Sendable, CaseIterable, Hashable {
    case unseen
    case partWatched = "part_watched"
    case watched
}

public struct WatchProgress: Codable, Identifiable, Hashable, Sendable {
    public var mediaFileID: UUID
    public var workID: UUID
    public var positionMS: Int64
    public var durationMS: Int64
    public var state: WatchState
    public var updatedAt: Date?

    public var id: UUID { mediaFileID }

    enum CodingKeys: String, CodingKey {
        case mediaFileID = "media_file_id"
        case workID = "work_id"
        case positionMS = "position_ms"
        case durationMS = "duration_ms"
        case state
        case updatedAt = "updated_at"
    }

    public init(
        mediaFileID: UUID,
        workID: UUID,
        positionMS: Int64,
        durationMS: Int64,
        state: WatchState,
        updatedAt: Date? = nil
    ) {
        self.mediaFileID = mediaFileID
        self.workID = workID
        self.positionMS = positionMS
        self.durationMS = durationMS
        self.state = state
        self.updatedAt = updatedAt
    }
}

public enum PlaylistMediaType: String, Codable, Sendable, CaseIterable, Hashable {
    case video
    case audio
}

public struct Playlist: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var name: String
    public var ownerUserID: UUID?
    public var parentPlaylistID: UUID?
    public var isSystem: Bool
    public var mediaType: PlaylistMediaType
    public var createdAt: Date
    public var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case ownerUserID = "owner_user_id"
        case parentPlaylistID = "parent_playlist_id"
        case isSystem = "is_system"
        case mediaType = "media_type"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: UUID,
        name: String,
        ownerUserID: UUID? = nil,
        parentPlaylistID: UUID? = nil,
        isSystem: Bool,
        mediaType: PlaylistMediaType,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.name = name
        self.ownerUserID = ownerUserID
        self.parentPlaylistID = parentPlaylistID
        self.isSystem = isSystem
        self.mediaType = mediaType
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct PlaylistItem: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var playlistID: UUID
    public var workID: UUID
    public var trackID: UUID?
    public var position: Int32
    public var addedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case playlistID = "playlist_id"
        case workID = "work_id"
        case trackID = "track_id"
        case position
        case addedAt = "added_at"
    }

    public init(
        id: UUID,
        playlistID: UUID,
        workID: UUID,
        trackID: UUID? = nil,
        position: Int32,
        addedAt: Date
    ) {
        self.id = id
        self.playlistID = playlistID
        self.workID = workID
        self.trackID = trackID
        self.position = position
        self.addedAt = addedAt
    }
}

public struct AvailableProfile: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var username: String
    public var displayName: String
    public var pinLocked: Bool
    public var isCurrent: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case displayName = "display_name"
        case pinLocked = "pin_locked"
        case isCurrent = "is_current"
    }

    public init(id: UUID, username: String, displayName: String, pinLocked: Bool, isCurrent: Bool) {
        self.id = id
        self.username = username
        self.displayName = displayName
        self.pinLocked = pinLocked
        self.isCurrent = isCurrent
    }
}

public struct SignupRequest: Codable, Sendable {
    public var displayName: String
    public var email: String?
    public var inviteToken: String
    public var password: String
    public var username: String
    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
        case email
        case inviteToken = "invite_token"
        case password, username
    }
    public init(displayName: String, email: String? = nil, inviteToken: String, password: String, username: String) {
        self.displayName = displayName; self.email = email; self.inviteToken = inviteToken; self.password = password; self.username = username
    }
}

public struct UserAccount: Codable, Identifiable, Sendable {
    public let id: UUID
    public var username: String
    public var displayName: String
    public var email: String?
    public var disabled: Bool
    public var isAdmin: Bool
    public var canStream: Bool
    public var libraryAllow: [UUID]
    public var preferredAudioLanguage: String
    public var createdAt: Date
    enum CodingKeys: String, CodingKey {
        case id, username, email, disabled
        case displayName = "display_name"
        case isAdmin = "is_admin"
        case canStream = "can_stream"
        case libraryAllow = "library_allow"
        case preferredAudioLanguage = "preferred_audio_language"
        case createdAt = "created_at"
    }
}

public struct Person: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var name: String
    public var headshotURL: String?
    enum CodingKeys: String, CodingKey { case id, name; case headshotURL = "headshot_url" }
    public init(id: UUID, name: String, headshotURL: String? = nil) { self.id = id; self.name = name; self.headshotURL = headshotURL }
}

public struct Credit: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var person: Person
    public var character: String?
    public var department: String?
    public var job: String?
    public init(id: UUID, person: Person, character: String? = nil, department: String? = nil, job: String? = nil) {
        self.id = id; self.person = person; self.character = character; self.department = department; self.job = job
    }
}

public struct WorkCredits: Codable, Hashable, Sendable {
    public var cast: [Credit]
    public var crew: [Credit]
    public init(cast: [Credit], crew: [Credit]) { self.cast = cast; self.crew = crew }
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

/// One `PeerAddressBundle` entry: a single reachable URL attributed to the
/// peer node it belongs to — mirrors
/// `streamarr_api::admin_peer::PeerAddressEntry` field for field. This
/// attribution is the entire point of `PeerAddressBundle.addresses` not
/// being a bare `[String]`: per `docs/architecture/peer-groups.md` §3.7,
/// refresh tokens are never synced across peer nodes — only
/// accounts/policies are — so a client retrying a failed refresh needs to
/// know whether a given URL is *another address of the same node* that
/// issued the token (worth retrying) or a genuinely different node
/// (guaranteed to 401, since that node's own database has no record of a
/// token it never issued). See `AccessTokenCoordinator`'s refresh-retry
/// loop in `APIClient.swift`.
public struct PeerAddressEntry: Codable, Sendable, Equatable {
    public var peerNodeID: UUID
    public var url: String

    enum CodingKeys: String, CodingKey {
        case peerNodeID = "peer_node_id"
        case url
    }

    public init(peerNodeID: UUID, url: String) {
        self.peerNodeID = peerNodeID
        self.url = url
    }
}

/// `docs/architecture/peer-groups.md` §6.1/§7.1's self-healing address
/// book — mirrors `streamarr_api::admin_peer::PeerAddressBundle` field for
/// field. Carried on `LoginResponse`/`RefreshResponse` (`null`/absent for
/// a standalone, never-grouped node — see those types' own
/// `peerAddresses` doc comments), and folded into a `KnownServerGroup`
/// (`Auth/KnownServerGroup.swift`) via
/// `KnownServerGroupStoring.merge(_:successfulURL:)`.
public struct PeerAddressBundle: Codable, Sendable, Equatable {
    /// `nil` for a standalone deployment that has never founded or joined
    /// a peer group.
    public var groupID: UUID?
    public var groupName: String?
    /// Every active member's client-reachable addresses, each attributed
    /// to the peer node it came from, flattened and priority-ordered
    /// (lower `PeerAddress.priority` first). Empty — never absent —
    /// when nothing is configured yet.
    public var addresses: [PeerAddressEntry]

    enum CodingKeys: String, CodingKey {
        case groupID = "group_id"
        case groupName = "group_name"
        case addresses
    }

    public init(groupID: UUID? = nil, groupName: String? = nil, addresses: [PeerAddressEntry] = []) {
        self.groupID = groupID
        self.groupName = groupName
        self.addresses = addresses
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
    /// `docs/architecture/peer-groups.md` §7.1's self-healing address
    /// book: this node's current `PeerAddressBundle`, so the client can
    /// pick up newly added/removed peers without a separate round trip.
    /// `nil`/absent for a standalone (never grouped) node — see
    /// `streamarr_api::admin_peer::peer_addresses_for_response`'s doc
    /// comment for why that lookup is skipped rather than always attached.
    public var peerAddresses: PeerAddressBundle?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case userID = "user_id"
        case peerAddresses = "peer_addresses"
    }

    public init(
        accessToken: String,
        refreshToken: String,
        tokenType: String,
        expiresIn: Int64,
        userID: UUID,
        peerAddresses: PeerAddressBundle? = nil
    ) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.userID = userID
        self.peerAddresses = peerAddresses
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
    /// `docs/architecture/peer-groups.md` §7.1's self-healing address
    /// book — see `LoginResponse.peerAddresses`'s identical doc comment.
    public var peerAddresses: PeerAddressBundle?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case userID = "user_id"
        case peerAddresses = "peer_addresses"
    }

    public init(
        accessToken: String,
        refreshToken: String,
        tokenType: String,
        expiresIn: Int64,
        userID: UUID,
        peerAddresses: PeerAddressBundle? = nil
    ) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.tokenType = tokenType
        self.expiresIn = expiresIn
        self.userID = userID
        self.peerAddresses = peerAddresses
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
    public var audioTracks: [PlaybackAudioTrackOption]
    public var durationMS: Int64
    public var mimeType: String
    public var qualityOptions: [PlaybackQualityOption]
    public var selectedAudioTrackID: String?
    public var selectedQualityID: String
    public var selectedSubtitleTrackID: String?
    public var sessionID: UUID?
    public var sourceOffsetMS: Int64
    public var subtitleTracks: [PlaybackSubtitleTrackOption]

    enum CodingKeys: String, CodingKey {
        case mode, url
        case audioTracks = "audio_tracks"
        case durationMS = "duration_ms"
        case mimeType = "mime_type"
        case qualityOptions = "quality_options"
        case selectedAudioTrackID = "selected_audio_track_id"
        case selectedQualityID = "selected_quality_id"
        case selectedSubtitleTrackID = "selected_subtitle_track_id"
        case sessionID = "session_id"
        case sourceOffsetMS = "source_offset_ms"
        case subtitleTracks = "subtitle_tracks"
    }

    public init(
        mode: PlaybackMode,
        url: String,
        audioTracks: [PlaybackAudioTrackOption] = [],
        durationMS: Int64 = 0,
        mimeType: String = "",
        qualityOptions: [PlaybackQualityOption] = [],
        selectedAudioTrackID: String? = nil,
        selectedQualityID: String = "original",
        selectedSubtitleTrackID: String? = nil,
        sessionID: UUID? = nil,
        sourceOffsetMS: Int64 = 0,
        subtitleTracks: [PlaybackSubtitleTrackOption] = []
    ) {
        self.mode = mode
        self.url = url
        self.audioTracks = audioTracks
        self.durationMS = durationMS
        self.mimeType = mimeType
        self.qualityOptions = qualityOptions
        self.selectedAudioTrackID = selectedAudioTrackID
        self.selectedQualityID = selectedQualityID
        self.selectedSubtitleTrackID = selectedSubtitleTrackID
        self.sessionID = sessionID
        self.sourceOffsetMS = sourceOffsetMS
        self.subtitleTracks = subtitleTracks
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        mode = try values.decode(PlaybackMode.self, forKey: .mode)
        url = try values.decode(String.self, forKey: .url)
        audioTracks = try values.decodeIfPresent([PlaybackAudioTrackOption].self, forKey: .audioTracks) ?? []
        durationMS = try values.decodeIfPresent(Int64.self, forKey: .durationMS) ?? 0
        mimeType = try values.decodeIfPresent(String.self, forKey: .mimeType) ?? ""
        qualityOptions = try values.decodeIfPresent([PlaybackQualityOption].self, forKey: .qualityOptions) ?? []
        selectedAudioTrackID = try values.decodeIfPresent(String.self, forKey: .selectedAudioTrackID)
        selectedQualityID = try values.decodeIfPresent(String.self, forKey: .selectedQualityID) ?? "original"
        selectedSubtitleTrackID = try values.decodeIfPresent(String.self, forKey: .selectedSubtitleTrackID)
        sessionID = try values.decodeIfPresent(UUID.self, forKey: .sessionID)
        sourceOffsetMS = try values.decodeIfPresent(Int64.self, forKey: .sourceOffsetMS) ?? 0
        subtitleTracks = try values.decodeIfPresent([PlaybackSubtitleTrackOption].self, forKey: .subtitleTracks) ?? []
    }
}

public struct PlaybackAudioTrackOption: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var streamIndex: Int32
    public var label: String
    public var language: String?
    public var codec: String?
    public var channels: Int32?
    public var isDefault: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, language, codec, channels
        case streamIndex = "stream_index"
        case isDefault = "is_default"
    }
}

public struct PlaybackSubtitleTrackOption: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var streamIndex: Int32
    public var label: String
    public var language: String?
    public var codec: String
    public var forced: Bool
    public var isDefault: Bool
    public var url: String

    enum CodingKeys: String, CodingKey {
        case id, label, language, codec, forced, url
        case streamIndex = "stream_index"
        case isDefault = "is_default"
    }
}

public struct PlaybackQualityOption: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var label: String
    public var profile: String?
    public var height: Int32?
    public var videoBitrateBPS: Int64?

    enum CodingKeys: String, CodingKey {
        case id, label, profile, height
        case videoBitrateBPS = "video_bitrate_bps"
    }
}

public struct MediaChapter: Codable, Hashable, Sendable, Identifiable {
    public var index: Int32
    public var startMS: Int64
    public var endMS: Int64?
    public var title: String?
    public var id: Int32 { index }

    enum CodingKeys: String, CodingKey {
        case index, title
        case startMS = "start_ms"
        case endMS = "end_ms"
    }
}

public struct MediaPlaybackPreference: Codable, Hashable, Sendable {
    public var qualityID: String
    public var audioTrackID: String?
    public var subtitleTrackID: String?

    enum CodingKeys: String, CodingKey {
        case qualityID = "quality_id"
        case audioTrackID = "audio_track_id"
        case subtitleTrackID = "subtitle_track_id"
    }

    public init(qualityID: String, audioTrackID: String? = nil, subtitleTrackID: String? = nil) {
        self.qualityID = qualityID
        self.audioTrackID = audioTrackID
        self.subtitleTrackID = subtitleTrackID
    }
}

public struct MediaPlaybackOptions: Codable, Hashable, Sendable {
    public var audioTracks: [PlaybackAudioTrackOption]
    public var preferences: MediaPlaybackPreference
    public var qualityOptions: [PlaybackQualityOption]
    public var subtitleTracks: [PlaybackSubtitleTrackOption]

    enum CodingKeys: String, CodingKey {
        case audioTracks = "audio_tracks"
        case preferences
        case qualityOptions = "quality_options"
        case subtitleTracks = "subtitle_tracks"
    }
}

public struct PlayerPreferences: Codable, Hashable, Sendable {
    public var preferredAudioLanguage: String
    enum CodingKeys: String, CodingKey { case preferredAudioLanguage = "preferred_audio_language" }
    public init(preferredAudioLanguage: String) { self.preferredAudioLanguage = preferredAudioLanguage }
}

public struct CreatePlaylistRequest: Codable, Sendable {
    public var name: String
    public var isSystem: Bool?
    public var mediaType: PlaylistMediaType?
    public var parentPlaylistID: UUID?
    enum CodingKeys: String, CodingKey {
        case name
        case isSystem = "is_system"
        case mediaType = "media_type"
        case parentPlaylistID = "parent_playlist_id"
    }
    public init(name: String, isSystem: Bool? = nil, mediaType: PlaylistMediaType? = nil, parentPlaylistID: UUID? = nil) {
        self.name = name; self.isSystem = isSystem; self.mediaType = mediaType; self.parentPlaylistID = parentPlaylistID
    }
}

public struct UpdatePlaylistRequest: Codable, Sendable {
    public var name: String
    public var parentPlaylistID: UUID?
    enum CodingKeys: String, CodingKey { case name; case parentPlaylistID = "parent_playlist_id" }
    public init(name: String, parentPlaylistID: UUID? = nil) { self.name = name; self.parentPlaylistID = parentPlaylistID }
}

public struct AddPlaylistItemRequest: Codable, Sendable {
    public var workID: UUID
    public var trackID: UUID?
    enum CodingKeys: String, CodingKey { case workID = "work_id"; case trackID = "track_id" }
    public init(workID: UUID, trackID: UUID? = nil) { self.workID = workID; self.trackID = trackID }
}

public struct ReorderPlaylistItemsRequest: Codable, Sendable {
    public var itemIDs: [UUID]
    enum CodingKeys: String, CodingKey { case itemIDs = "item_ids" }
    public init(itemIDs: [UUID]) { self.itemIDs = itemIDs }
}

public enum ProfileAvatarKind: String, Codable, Sendable { case preset, custom }
public struct ProfileAvatarPreference: Codable, Hashable, Sendable {
    public var kind: ProfileAvatarKind
    public var value: String
    public init(kind: ProfileAvatarKind, value: String) { self.kind = kind; self.value = value }
}
public struct ProfileAvatarSetting: Codable, Hashable, Sendable {
    public var preference: ProfileAvatarPreference?
    public init(preference: ProfileAvatarPreference?) { self.preference = preference }
}
public struct UpdateProfileAvatarRequest: Codable, Sendable {
    public var preference: ProfileAvatarPreference
    public init(preference: ProfileAvatarPreference) { self.preference = preference }
}
public struct ProfilePinSetting: Codable, Hashable, Sendable {
    public var pinLocked: Bool
    enum CodingKeys: String, CodingKey { case pinLocked = "pin_locked" }
}
public struct UpdateProfilePinRequest: Codable, Sendable {
    public var pin: String?
    public init(pin: String?) { self.pin = pin }
}
public struct VerifyProfilePinRequest: Codable, Sendable {
    public var pin: String
    public init(pin: String) { self.pin = pin }
}
public struct VerifyProfilePinResponse: Codable, Sendable { public var verified: Bool }

public enum UserInviteRequestStatus: String, Codable, Sendable { case pending, approved, denied, generated }
public struct UserInviteRequest: Codable, Identifiable, Sendable {
    public var id: UUID
    public var userID: UUID
    public var username: String
    public var displayName: String
    public var message: String?
    public var status: UserInviteRequestStatus
    public var canStream: Bool
    public var libraryAllow: [UUID]
    public var requestedAt: Date
    public var reviewedAt: Date?
    public var generatedAt: Date?
    enum CodingKeys: String, CodingKey {
        case id, username, message, status
        case userID = "user_id"
        case displayName = "display_name"
        case canStream = "can_stream"
        case libraryAllow = "library_allow"
        case requestedAt = "requested_at"
        case reviewedAt = "reviewed_at"
        case generatedAt = "generated_at"
    }
}
public struct CreateUserInviteRequest: Codable, Sendable {
    public var message: String?
    public init(message: String? = nil) { self.message = message }
}
public struct UserInvite: Codable, Sendable {
    public var inviteToken: String
    public var expiresAt: Date
    enum CodingKeys: String, CodingKey { case inviteToken = "invite_token"; case expiresAt = "expires_at" }
}

public struct PlaybackEventRequest: Codable, Sendable {
    public var kind: String
    public var positionMS: Int64?
    public var fromMS: Int64?
    public var toMS: Int64?
    public var reason: String?
    public var message: String?
    enum CodingKeys: String, CodingKey {
        case kind, reason, message
        case positionMS = "position_ms"
        case fromMS = "from_ms"
        case toMS = "to_ms"
    }
    public init(kind: String, positionMS: Int64? = nil, fromMS: Int64? = nil, toMS: Int64? = nil, reason: String? = nil, message: String? = nil) {
        self.kind = kind; self.positionMS = positionMS; self.fromMS = fromMS; self.toMS = toMS; self.reason = reason; self.message = message
    }
}

public struct UpdateWatchProgressRequest: Codable, Sendable {
    public var positionMS: Int64
    public var durationMS: Int64
    public var completed: Bool?
    /// Additive, optional (Round: media downloads) — when this update is
    /// being replayed after the fact (e.g. progress recorded while playing
    /// a local download offline, then synced once back online), the moment
    /// it actually happened rather than when it's replayed. Omitted
    /// (`nil`) callers are unaffected: the server falls back to `now()`.
    public var occurredAt: Date?
    enum CodingKeys: String, CodingKey {
        case positionMS = "position_ms"
        case durationMS = "duration_ms"
        case completed
        case occurredAt = "occurred_at"
    }
    public init(positionMS: Int64, durationMS: Int64, completed: Bool? = nil, occurredAt: Date? = nil) {
        self.positionMS = positionMS; self.durationMS = durationMS; self.completed = completed; self.occurredAt = occurredAt
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
