import Foundation

// MARK: - Backend wire types
//
// Mirrors the "media downloads" backend contract this client integrates
// against (see the sibling `backend/` crate's downloads module, developed
// in parallel in this same worktree):
//   - GET  /api/v1/media/{media_file_id}/download-options
//   - POST /api/v1/downloads
//   - GET  /api/v1/downloads
//   - GET  /api/v1/downloads/{id}
//   - GET  /api/v1/downloads/{id}/file  (range-resumable; no typed body —
//     `DownloadRepository` builds a plain authenticated `URLRequest` for it)
//   - DELETE /api/v1/downloads/{id}
//
// Follows this file's siblings in `Networking/OpenAPISchemas.swift`:
// snake_case wire keys via explicit `CodingKeys`, explicit public
// initializers (this package has no memberwise-synthesis-across-modules
// story otherwise).

/// One purchasable/downloadable quality for a media file, as returned by
/// `GET /api/v1/media/{media_file_id}/download-options`. The `"original"`
/// option always has `sizeIsEstimate == false` (a real
/// `MediaFile.size_bytes` count); every named transcode profile has
/// `sizeIsEstimate == true` (estimated from bitrate × duration).
public struct MediaFileDownloadOption: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var label: String
    public var profile: String?
    public var height: Int32?
    public var estimatedSizeBytes: Int64?
    public var sizeIsEstimate: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, profile, height
        case estimatedSizeBytes = "estimated_size_bytes"
        case sizeIsEstimate = "size_is_estimate"
    }

    public init(
        id: String,
        label: String,
        profile: String? = nil,
        height: Int32? = nil,
        estimatedSizeBytes: Int64? = nil,
        sizeIsEstimate: Bool
    ) {
        self.id = id
        self.label = label
        self.profile = profile
        self.height = height
        self.estimatedSizeBytes = estimatedSizeBytes
        self.sizeIsEstimate = sizeIsEstimate
    }
}

/// `GET /api/v1/media/{media_file_id}/download-options`'s 200 response.
public struct MediaFileDownloadOptionsResponse: Codable, Sendable {
    public var mediaFileID: UUID
    public var container: String
    public var options: [MediaFileDownloadOption]

    enum CodingKeys: String, CodingKey {
        case mediaFileID = "media_file_id"
        case container
        case options
    }

    public init(mediaFileID: UUID, container: String, options: [MediaFileDownloadOption]) {
        self.mediaFileID = mediaFileID
        self.container = container
        self.options = options
    }
}

/// Request body for `POST /api/v1/downloads`.
public struct CreateDownloadRequest: Codable, Sendable {
    public var mediaFileID: UUID
    public var qualityID: String

    enum CodingKeys: String, CodingKey {
        case mediaFileID = "media_file_id"
        case qualityID = "quality_id"
    }

    public init(mediaFileID: UUID, qualityID: String) {
        self.mediaFileID = mediaFileID
        self.qualityID = qualityID
    }
}

/// Server-side lifecycle of one `DownloadTicket` — distinct from this
/// client's own on-device `DownloadState` (`DownloadRecord.state`), which
/// additionally tracks local `URLSession` transfer progress the server has
/// no notion of.
public enum DownloadTicketStatus: String, Codable, Sendable, CaseIterable, Hashable {
    case queued
    case processing
    case ready
    case failed
    case expired
    case canceled
}

/// `POST /api/v1/downloads`'s 201/200 response, and
/// `GET /api/v1/downloads`/`GET /api/v1/downloads/{id}`'s element/response
/// shape. `qualityID == "original"` tickets come back `.ready` immediately;
/// a named transcode profile starts `.queued` and transitions to `.ready`
/// asynchronously — `DownloadRepository` polls `GET /api/v1/downloads/{id}`
/// until it leaves that pending state.
public struct DownloadTicket: Codable, Sendable, Identifiable, Hashable {
    public var id: UUID
    public var mediaFileID: UUID
    public var qualityID: String
    public var status: DownloadTicketStatus
    public var container: String
    public var sizeBytes: Int64?
    public var requestedAt: Date
    public var readyAt: Date?
    public var expiresAt: Date?
    public var errorMessage: String?

    enum CodingKeys: String, CodingKey {
        case id
        case mediaFileID = "media_file_id"
        case qualityID = "quality_id"
        case status
        case container
        case sizeBytes = "size_bytes"
        case requestedAt = "requested_at"
        case readyAt = "ready_at"
        case expiresAt = "expires_at"
        case errorMessage = "error_message"
    }

    public init(
        id: UUID,
        mediaFileID: UUID,
        qualityID: String,
        status: DownloadTicketStatus,
        container: String,
        sizeBytes: Int64? = nil,
        requestedAt: Date,
        readyAt: Date? = nil,
        expiresAt: Date? = nil,
        errorMessage: String? = nil
    ) {
        self.id = id
        self.mediaFileID = mediaFileID
        self.qualityID = qualityID
        self.status = status
        self.container = container
        self.sizeBytes = sizeBytes
        self.requestedAt = requestedAt
        self.readyAt = readyAt
        self.expiresAt = expiresAt
        self.errorMessage = errorMessage
    }
}

// MARK: - On-device domain types

/// How long a completed download should be kept before
/// `DownloadExpirySweeper` reclaims it. Persisted on `DownloadRecord` as
/// JSON-encoded `keepUntilData` (Swift's automatic enum-with-associated-
/// values `Codable` synthesis, SE-0295) — purely a local, on-device
/// encoding with no backend counterpart, so its wire shape is an
/// implementation detail.
public enum KeepUntilPolicy: Codable, Sendable, Equatable {
    case forever
    case specificDate(Date)
    case afterWatched(amount: Int, unit: TimeUnit)

    public enum TimeUnit: String, Codable, Sendable, CaseIterable {
        case days
        case weeks
    }

    /// Whether this policy considers a download expired as of `now`, given
    /// the record's own `watchedAt` (`nil` until the user has actually
    /// finished playing it — see `PlayerViewModel`/`DownloadRepository` for
    /// where that gets set).
    public func isExpired(now: Date = Date(), watchedAt: Date?) -> Bool {
        switch self {
        case .forever:
            return false
        case .specificDate(let date):
            return now >= date
        case .afterWatched(let amount, let unit):
            guard let watchedAt else { return false }
            let secondsPerUnit: TimeInterval = unit == .days ? 86_400 : 86_400 * 7
            return now.timeIntervalSince(watchedAt) >= Double(amount) * secondsPerUnit
        }
    }
}

/// Local `URLSession` transfer/lifecycle state for one `DownloadRecord` —
/// see `DownloadTicketStatus` for the distinct server-side notion this
/// composes with (a record moves `.queued` → `.preparing` while its ticket
/// is still `.queued`/`.processing` server-side, then `.downloading` once
/// the actual file transfer starts).
public enum DownloadState: String, Codable, Sendable, CaseIterable, Hashable {
    case queued
    case preparing
    case downloading
    case paused
    case completed
    case failed
}

/// One playable leaf (movie/episode/track/book) a caller wants downloaded,
/// resolved from this client's own catalog model — the input to
/// `DownloadRepository.enqueue(candidates:profile:keepUntil:)`.
/// `DownloadOptionsSheet` builds a batch of these for a container target
/// (season/album/series/artist) so each leaf's concrete download-options/
/// create-ticket round trip only happens once enqueueing actually starts,
/// not while the sheet is merely showing an aggregate size estimate.
public struct DownloadCandidate: Identifiable, Hashable, Sendable {
    public var mediaFileID: UUID
    public var workID: UUID
    public var title: String
    public var subtitle: String?
    public var posterURLString: String?

    public var id: UUID { mediaFileID }

    public init(
        mediaFileID: UUID,
        workID: UUID,
        title: String,
        subtitle: String? = nil,
        posterURLString: String? = nil
    ) {
        self.mediaFileID = mediaFileID
        self.workID = workID
        self.title = title
        self.subtitle = subtitle
        self.posterURLString = posterURLString
    }
}
