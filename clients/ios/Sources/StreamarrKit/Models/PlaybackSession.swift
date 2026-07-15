import Foundation

// MIRROR NOTE: see the note at the top of Work.swift — `playback.rs` did
// not exist on disk at scaffold time, only `pub use playback::{
// PlaybackEvent, PlaybackEventKind, PlaybackSession, PlayMethod,
// StopReason, TranscodeReason}` in `lib.rs`. Fields below are inferred,
// not verified. Note the deliberate naming: this file's `PlaybackSession`/
// `PlaybackEvent` are the *server-tracked* playback record; the *client-side*
// player's own state machine lives in `Player/PlayerEngine.swift` as
// `PlayerPlaybackState`, named differently on purpose so the two never
// collide as symbols in this module.

/// A server-tracked "someone is watching this" record — created via
/// `StreamarrAPIClient.startPlaybackSession`, updated with `PlaybackEvent`s
/// as playback proceeds, and closed with `endPlaybackSession`. Used for
/// resume points, "continue watching", and concurrent-stream limits
/// (`Policy.maxConcurrentStreams`).
public struct PlaybackSession: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var userID: UUID
    public var deviceID: UUID
    public var workID: UUID
    public var episodeID: UUID?
    public var mediaFileID: UUID
    public var renditionID: UUID?
    public var playMethod: PlayMethod
    public var positionSeconds: Double
    public var durationSeconds: Double?
    public var isPaused: Bool
    public var startedAt: Date
    public var updatedAt: Date
    public var endedAt: Date?
    public var stopReason: StopReason?

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case deviceID = "device_id"
        case workID = "work_id"
        case episodeID = "episode_id"
        case mediaFileID = "media_file_id"
        case renditionID = "rendition_id"
        case playMethod = "play_method"
        case positionSeconds = "position_seconds"
        case durationSeconds = "duration_seconds"
        case isPaused = "is_paused"
        case startedAt = "started_at"
        case updatedAt = "updated_at"
        case endedAt = "ended_at"
        case stopReason = "stop_reason"
    }

    public init(
        id: UUID,
        userID: UUID,
        deviceID: UUID,
        workID: UUID,
        episodeID: UUID? = nil,
        mediaFileID: UUID,
        renditionID: UUID? = nil,
        playMethod: PlayMethod,
        positionSeconds: Double = 0,
        durationSeconds: Double? = nil,
        isPaused: Bool = false,
        startedAt: Date,
        updatedAt: Date,
        endedAt: Date? = nil,
        stopReason: StopReason? = nil
    ) {
        self.id = id
        self.userID = userID
        self.deviceID = deviceID
        self.workID = workID
        self.episodeID = episodeID
        self.mediaFileID = mediaFileID
        self.renditionID = renditionID
        self.playMethod = playMethod
        self.positionSeconds = positionSeconds
        self.durationSeconds = durationSeconds
        self.isPaused = isPaused
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.endedAt = endedAt
        self.stopReason = stopReason
    }
}

/// Whether the server had to transcode/remux to serve this session, and if
/// so why — surfaced in the UI as a "why is this transcoding?" hint and
/// used by `streamarr-telemetry` to track transcode load.
public enum PlayMethod: String, Codable, Sendable, CaseIterable, Hashable {
    case directPlay = "direct_play"
    case directStream = "direct_stream"
    case transcode
}

public enum StopReason: String, Codable, Sendable, CaseIterable, Hashable {
    case finished
    case userStopped = "user_stopped"
    case error
    case idleTimeout = "idle_timeout"
    case supersededBySession = "superseded_by_session"
}

/// A single point-in-time event within a `PlaybackSession` — the append-only
/// log the position/duration on the session itself is folded from.
public struct PlaybackEvent: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public var sessionID: UUID
    public var kind: PlaybackEventKind
    public var positionSeconds: Double
    public var occurredAt: Date
    public var transcodeReason: TranscodeReason?

    enum CodingKeys: String, CodingKey {
        case id
        case sessionID = "session_id"
        case kind
        case positionSeconds = "position_seconds"
        case occurredAt = "occurred_at"
        case transcodeReason = "transcode_reason"
    }

    public init(
        id: UUID,
        sessionID: UUID,
        kind: PlaybackEventKind,
        positionSeconds: Double,
        occurredAt: Date,
        transcodeReason: TranscodeReason? = nil
    ) {
        self.id = id
        self.sessionID = sessionID
        self.kind = kind
        self.positionSeconds = positionSeconds
        self.occurredAt = occurredAt
        self.transcodeReason = transcodeReason
    }
}

public enum PlaybackEventKind: String, Codable, Sendable, CaseIterable, Hashable {
    case start
    case pause
    case resume
    case seek
    case bufferingStart = "buffering_start"
    case bufferingEnd = "buffering_end"
    case stop
    case heartbeat
}

public enum TranscodeReason: String, Codable, Sendable, CaseIterable, Hashable {
    case containerNotSupported = "container_not_supported"
    case videoCodecNotSupported = "video_codec_not_supported"
    case audioCodecNotSupported = "audio_codec_not_supported"
    case bitrateLimitExceeded = "bitrate_limit_exceeded"
    case subtitleBurnIn = "subtitle_burn_in"
}
