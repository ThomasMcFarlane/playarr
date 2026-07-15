import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `media.rs` did not
// exist on disk at scaffold time, only `pub use media::{MediaFile,
// ProducedBy, Rendition, RenditionStatus}` in `lib.rs`. Fields below are
// inferred, not verified.

/// A concrete file on a `SourceInstance` backing a `Work` (or, for a
/// series, one of its `Episode`s). This is the thing `PlayerEngine` is
/// ultimately asked to play — either directly (`ProducedBy.originalSource`)
/// or via one of its `renditions` when direct play isn't possible.
public struct MediaFile: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var workID: UUID
    public var episodeID: UUID?
    public var sourceInstanceID: UUID
    public var relativePath: String
    public var container: String
    public var sizeBytes: Int64
    public var durationSeconds: Double?
    public var videoCodec: String?
    public var audioCodec: String?
    public var resolutionWidth: Int?
    public var resolutionHeight: Int?
    public var producedBy: ProducedBy
    public var renditions: [Rendition]
    public var addedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case workID = "work_id"
        case episodeID = "episode_id"
        case sourceInstanceID = "source_instance_id"
        case relativePath = "relative_path"
        case container
        case sizeBytes = "size_bytes"
        case durationSeconds = "duration_seconds"
        case videoCodec = "video_codec"
        case audioCodec = "audio_codec"
        case resolutionWidth = "resolution_width"
        case resolutionHeight = "resolution_height"
        case producedBy = "produced_by"
        case renditions
        case addedAt = "added_at"
    }

    public init(
        id: UUID,
        workID: UUID,
        episodeID: UUID? = nil,
        sourceInstanceID: UUID,
        relativePath: String,
        container: String,
        sizeBytes: Int64,
        durationSeconds: Double? = nil,
        videoCodec: String? = nil,
        audioCodec: String? = nil,
        resolutionWidth: Int? = nil,
        resolutionHeight: Int? = nil,
        producedBy: ProducedBy = .originalSource,
        renditions: [Rendition] = [],
        addedAt: Date
    ) {
        self.id = id
        self.workID = workID
        self.episodeID = episodeID
        self.sourceInstanceID = sourceInstanceID
        self.relativePath = relativePath
        self.container = container
        self.sizeBytes = sizeBytes
        self.durationSeconds = durationSeconds
        self.videoCodec = videoCodec
        self.audioCodec = audioCodec
        self.resolutionWidth = resolutionWidth
        self.resolutionHeight = resolutionHeight
        self.producedBy = producedBy
        self.renditions = renditions
        self.addedAt = addedAt
    }
}

/// How a `MediaFile` (or one of its `Rendition`s) came to exist — ties into
/// the `streamarr-transcode`/`streamarr-tdarr-client` crates on the
/// backend.
public enum ProducedBy: String, Codable, Sendable, CaseIterable, Hashable {
    case originalSource = "original_source"
    case transcode
    case remux
}

/// A pre- or on-demand-transcoded variant of a `MediaFile`, produced when a
/// requesting device can't direct-play the original (see `PlayMethod` in
/// `PlaybackSession.swift`).
public struct Rendition: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var mediaFileID: UUID
    public var status: RenditionStatus
    public var container: String
    public var videoCodec: String
    public var audioCodec: String
    public var maxBitrateKbps: Int?
    public var resolutionHeight: Int?
    public var url: URL?
    public var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case mediaFileID = "media_file_id"
        case status
        case container
        case videoCodec = "video_codec"
        case audioCodec = "audio_codec"
        case maxBitrateKbps = "max_bitrate_kbps"
        case resolutionHeight = "resolution_height"
        case url
        case createdAt = "created_at"
    }

    public init(
        id: UUID,
        mediaFileID: UUID,
        status: RenditionStatus,
        container: String,
        videoCodec: String,
        audioCodec: String,
        maxBitrateKbps: Int? = nil,
        resolutionHeight: Int? = nil,
        url: URL? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.mediaFileID = mediaFileID
        self.status = status
        self.container = container
        self.videoCodec = videoCodec
        self.audioCodec = audioCodec
        self.maxBitrateKbps = maxBitrateKbps
        self.resolutionHeight = resolutionHeight
        self.url = url
        self.createdAt = createdAt
    }
}

public enum RenditionStatus: String, Codable, Sendable, CaseIterable, Hashable {
    case queued
    case processing
    case ready
    case failed
}
