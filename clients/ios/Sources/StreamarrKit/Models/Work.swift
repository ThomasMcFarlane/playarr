import Foundation

// MIRROR NOTE: at the time this scaffold was written,
// `backend/crates/streamarr-model/src/work.rs` did not yet exist on disk —
// only its exported type names (`Availability`, `ExternalProvider`,
// `ExternalRef`, `ImageAsset`, `ImageKind`, `Work`, `WorkKind`) were visible
// via `pub use work::{...}` in `streamarr-model`'s `lib.rs`. Field lists and
// JSON casing below are inferred from those names plus common domain
// conventions (Jellyfin/Plex-style media-server "item" records) and are
// NOT verified against the real Rust struct definitions. Reconcile against
// `work.rs` once it lands, in particular: exact field names, which fields
// are optional, and whether the wire format really is snake_case (assumed
// here, matching serde's default with no `rename_all` observed elsewhere
// in the crate).

/// A top-level piece of media (currently: a movie or a series entry). Ties
/// together everything the catalog knows about one "thing you can browse
/// to" — episodes live under `Series`/`Season`/`Episode` (see
/// `Series.swift`), not as `Work` records of their own.
public struct Work: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var kind: WorkKind
    public var sourceInstanceID: UUID
    public var title: String
    public var sortTitle: String
    public var overview: String?
    public var releaseDate: Date?
    public var genres: [String]
    public var runtimeMinutes: Int?
    public var communityRating: Double?
    public var contentRating: String?
    public var images: [ImageAsset]
    public var externalRefs: [ExternalRef]
    public var availability: Availability
    public var createdAt: Date
    public var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case sourceInstanceID = "source_instance_id"
        case title
        case sortTitle = "sort_title"
        case overview
        case releaseDate = "release_date"
        case genres
        case runtimeMinutes = "runtime_minutes"
        case communityRating = "community_rating"
        case contentRating = "content_rating"
        case images
        case externalRefs = "external_refs"
        case availability
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: UUID,
        kind: WorkKind,
        sourceInstanceID: UUID,
        title: String,
        sortTitle: String,
        overview: String? = nil,
        releaseDate: Date? = nil,
        genres: [String] = [],
        runtimeMinutes: Int? = nil,
        communityRating: Double? = nil,
        contentRating: String? = nil,
        images: [ImageAsset] = [],
        externalRefs: [ExternalRef] = [],
        availability: Availability,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.kind = kind
        self.sourceInstanceID = sourceInstanceID
        self.title = title
        self.sortTitle = sortTitle
        self.overview = overview
        self.releaseDate = releaseDate
        self.genres = genres
        self.runtimeMinutes = runtimeMinutes
        self.communityRating = communityRating
        self.contentRating = contentRating
        self.images = images
        self.externalRefs = externalRefs
        self.availability = availability
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// What kind of top-level item a `Work` record represents. `Series`,
/// `Album`, and `Book` are separate top-level types in the Rust crate (see
/// `series.rs`, `music.rs`, `publishing.rs`), so this only covers the item
/// kinds a `Work` itself can directly stand for.
public enum WorkKind: String, Codable, Sendable, CaseIterable, Hashable {
    case movie
    case series
}

/// Whether (and why/why not) a `Work` currently has playable media behind
/// it. Distinct from `MediaFile` presence: a `Work` can exist (e.g. from a
/// user request, mirroring the `streamarr-requests` crate) before any file
/// has actually landed on a `SourceInstance`.
public struct Availability: Codable, Hashable, Sendable {
    public var status: AvailabilityStatus
    public var sourceInstanceIDs: [UUID]
    public var detail: String?

    enum CodingKeys: String, CodingKey {
        case status
        case sourceInstanceIDs = "source_instance_ids"
        case detail
    }

    public init(status: AvailabilityStatus, sourceInstanceIDs: [UUID] = [], detail: String? = nil) {
        self.status = status
        self.sourceInstanceIDs = sourceInstanceIDs
        self.detail = detail
    }
}

public enum AvailabilityStatus: String, Codable, Sendable, CaseIterable, Hashable {
    case available
    case partiallyAvailable = "partially_available"
    case requested
    case unavailable
}

/// A poster/backdrop/etc image attached to a `Work` (or, via the same
/// shape, a `Series`/`Season`).
public struct ImageAsset: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var kind: ImageKind
    public var url: URL
    public var width: Int?
    public var height: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case url
        case width
        case height
    }

    public init(id: UUID, kind: ImageKind, url: URL, width: Int? = nil, height: Int? = nil) {
        self.id = id
        self.kind = kind
        self.url = url
        self.width = width
        self.height = height
    }
}

public enum ImageKind: String, Codable, Sendable, CaseIterable, Hashable {
    case poster
    case backdrop
    case banner
    case logo
    case thumb
}

/// A reference to the same item in an external metadata provider, used for
/// scraping/enrichment and for deep-linking out to IMDb/TMDB/etc from the
/// UI.
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

public enum ExternalProvider: String, Codable, Sendable, CaseIterable, Hashable {
    case imdb
    case tmdb
    case tvdb
    case musicbrainz
    case openLibrary = "open_library"
}
