import Foundation

// MARK: - Playarr Cast protocol (canonical shape)
//
// Swift mirror of `@streamarr-tv/cast-protocol`'s TypeScript definitions --
// see the design doc's "The Playarr Cast protocol" section for the
// authoritative source this must match exactly. Namespace:
// "urn:x-cast:app.playarr.cast.v1". Encoding: JSON, camelCase throughout
// (deliberately unlike the snake_case Streamarr HTTP API), which is why
// none of the types below need `CodingKeys` for field-name translation --
// only the discriminated unions (`PlayarrCastSenderMessage`,
// `PlayarrCastReceiverMessage`) need hand-written `Codable` at all, to
// route on the wire `"type"` tag. Message cap 64 KB -- never put
// manifests, playlists, artwork, or subtitle text on this channel.
//
// This is an APP-TARGET file (`StreamarrApp`, not `StreamarrKit`):
// `StreamarrKit` is also linked by the tvOS app at `clients/apple-tv/`,
// which never links the Cast SDK, so no Cast-shaped type may enter it.
//
// A note on optionality, since Swift's `?` doesn't distinguish the two
// TypeScript shapes this mirrors differently:
//   - `T | undefined` (TS `field?: T`)  -> Swift `var field: T?` with a
//     `= nil` default in this type's memberwise initializer (the key is
//     omitted from the wire when absent -- see `encodeIfPresent` call
//     sites in the union `Codable` conformances below).
//   - `T | null` (TS `field: T | null`, no `?`) -> Swift `var field: T?`
//     with *no* default (the key is always present on the wire, value
//     possibly `null` -- see plain `encode(_:forKey:)` call sites, which
//     Foundation's `Optional: Encodable` conformance renders as an
//     explicit JSON `null` rather than omitting the key).
enum PlayarrCastProtocol {
    static let namespace = "urn:x-cast:app.playarr.cast.v1"
    static let protocolVersion = 1
    /// Message channel cap -- never put manifests, playlists, artwork or
    /// subtitle text on this channel; see `encodePlayarrCastMessage`.
    static let maxMessageBytes = 64 * 1_024
}

enum PlayarrCastProtocolError: Error, LocalizedError {
    case messageTooLarge(byteCount: Int)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .messageTooLarge(let byteCount):
            return "Playarr Cast message is \(byteCount) bytes, over the \(PlayarrCastProtocol.maxMessageBytes)-byte channel cap."
        case .encodingFailed:
            return "Playarr Cast message couldn't be encoded as UTF-8 JSON."
        }
    }
}

// MARK: - Shared value types

struct PlayarrCastPeer: Codable, Equatable, Sendable {
    var peerNodeId: String
    var url: String
}

struct PlayarrCastServer: Codable, Equatable, Sendable {
    var baseUrl: String
    var peers: [PlayarrCastPeer]?

    init(baseUrl: String, peers: [PlayarrCastPeer]? = nil) {
        self.baseUrl = baseUrl
        self.peers = peers
    }
}

struct PlayarrCastCredentials: Codable, Equatable, Sendable {
    var deviceId: String
    var accessToken: String
    /// Epoch milliseconds.
    var accessTokenExpiresAt: Int64
    var refreshToken: String
}

enum PlayarrCastItemKind: String, Codable, Equatable, Sendable {
    case movie
    case episode
    case track
    case other
}

struct PlayarrCastItem: Codable, Equatable, Sendable {
    var mediaFileId: String
    var workId: String?
    var kind: PlayarrCastItemKind
    var title: String
    var subtitle: String?
    var seasonNumber: Int?
    var episodeNumber: Int?
    /// ISO 8601.
    var releaseDate: String?
    var durationMs: Int64?

    init(
        mediaFileId: String,
        workId: String? = nil,
        kind: PlayarrCastItemKind,
        title: String,
        subtitle: String? = nil,
        seasonNumber: Int? = nil,
        episodeNumber: Int? = nil,
        releaseDate: String? = nil,
        durationMs: Int64? = nil
    ) {
        self.mediaFileId = mediaFileId
        self.workId = workId
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.seasonNumber = seasonNumber
        self.episodeNumber = episodeNumber
        self.releaseDate = releaseDate
        self.durationMs = durationMs
    }
}

struct PlayarrCastPlaybackIntent: Codable, Equatable, Sendable {
    /// Absolute source-timeline position, NOT engine time -- see the design
    /// doc: an on-demand HLS seek is a new server session, not a raw
    /// media-element seek, so this is never a `currentTime` to hand an
    /// `AVPlayer`/CAF engine directly.
    var startPositionMs: Int64
    var autoplay: Bool
    var preferredAudioTrackId: String?
    var preferredSubtitleTrackId: String?
    var preferredAudioLanguage: String?
    var preferredSubtitleLanguage: String?
    var qualityId: String?
    var maxBitrateBps: Int64?

    init(
        startPositionMs: Int64,
        autoplay: Bool = true,
        preferredAudioTrackId: String? = nil,
        preferredSubtitleTrackId: String? = nil,
        preferredAudioLanguage: String? = nil,
        preferredSubtitleLanguage: String? = nil,
        qualityId: String? = nil,
        maxBitrateBps: Int64? = nil
    ) {
        self.startPositionMs = startPositionMs
        self.autoplay = autoplay
        self.preferredAudioTrackId = preferredAudioTrackId
        self.preferredSubtitleTrackId = preferredSubtitleTrackId
        self.preferredAudioLanguage = preferredAudioLanguage
        self.preferredSubtitleLanguage = preferredSubtitleLanguage
        self.qualityId = qualityId
        self.maxBitrateBps = maxBitrateBps
    }
}

enum PlayarrCastSenderPlatform: String, Codable, Equatable, Sendable {
    case web
    case androidMobile = "android-mobile"
    case ios
}

struct PlayarrCastSender: Codable, Equatable, Sendable {
    var platform: PlayarrCastSenderPlatform
    var appVersion: String
    var deviceName: String
    /// BCP-47.
    var language: String
}

struct PlayarrCastQueueEntry: Codable, Equatable, Sendable, Identifiable {
    var mediaFileId: String
    var workId: String?
    var kind: PlayarrCastItemKind
    var title: String
    var subtitle: String?
    var seasonNumber: Int?
    var episodeNumber: Int?
    var durationMs: Int64?

    var id: String { mediaFileId }

    init(
        mediaFileId: String,
        workId: String? = nil,
        kind: PlayarrCastItemKind,
        title: String,
        subtitle: String? = nil,
        seasonNumber: Int? = nil,
        episodeNumber: Int? = nil,
        durationMs: Int64? = nil
    ) {
        self.mediaFileId = mediaFileId
        self.workId = workId
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.seasonNumber = seasonNumber
        self.episodeNumber = episodeNumber
        self.durationMs = durationMs
    }
}

/// Sent as `GCKMediaLoadRequestData.customData` on the standard CAF LOAD
/// request -- unlike every other type below, this never travels over the
/// custom `PlayarrCastChannel`. Deliberately does not extend the envelope
/// shape (no `requestId`): it's the payload of a CAF-level load, not a
/// message on the Playarr namespace.
struct PlayarrCastLoadRequest: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var server: PlayarrCastServer
    var credentials: PlayarrCastCredentials
    var item: PlayarrCastItem
    var playback: PlayarrCastPlaybackIntent
    var sender: PlayarrCastSender
    var queue: [PlayarrCastQueueEntry]?

    init(
        protocolVersion: Int = PlayarrCastProtocol.protocolVersion,
        server: PlayarrCastServer,
        credentials: PlayarrCastCredentials,
        item: PlayarrCastItem,
        playback: PlayarrCastPlaybackIntent,
        sender: PlayarrCastSender,
        queue: [PlayarrCastQueueEntry]? = nil
    ) {
        self.protocolVersion = protocolVersion
        self.server = server
        self.credentials = credentials
        self.item = item
        self.playback = playback
        self.sender = sender
        self.queue = queue
    }
}

// MARK: - Receiver state value types

struct PlayarrCastDeviceCapabilities: Codable, Equatable, Sendable {
    var supportsH264: Bool
    var supportsHevc: Bool
    var supportsVp9: Bool
    var supportsAv1: Bool
    var supports4k: Bool
    var supportsHdr: Bool
}

/// `language`/`height`/`videoBitrateBps` etc. below are TS `T | null` (no
/// `?`) -- always-present keys, nullable values -- so these two types
/// deliberately get no custom initializer: Swift's synthesized memberwise
/// init already requires callers to pass an explicit (possibly-`nil`)
/// value for every field, which is exactly "nullable, no default."
struct PlayarrCastTrackOption: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var label: String
    var language: String?
    var forced: Bool
    var isDefault: Bool
}

struct PlayarrCastQualityOption: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var label: String
    var height: Int?
    var videoBitrateBps: Int64?
}

enum PlayarrCastStopReason: String, Codable, Equatable, Sendable {
    case completed
    case userStopped = "user_stopped"
    case error
    case deviceDisconnected = "device_disconnected"
}

enum PlayarrCastErrorCode: String, Codable, Equatable, Sendable {
    case unsupportedProtocolVersion = "unsupported_protocol_version"
    case invalidLoadRequest = "invalid_load_request"
    case serverUnreachable = "server_unreachable"
    case insecureServer = "insecure_server"
    case authFailed = "auth_failed"
    case negotiationFailed = "negotiation_failed"
    case playbackFailed = "playback_failed"
    case sessionExpired = "session_expired"
    case unknown
}

enum PlayarrCastPlaybackMode: String, Codable, Equatable, Sendable {
    case direct
    case hls
}

// MARK: - Sender -> receiver messages
//
// Each payload struct below intentionally does *not* store its own `type`
// literal -- the wire `"type"` tag is owned entirely by the enclosing
// `PlayarrCastSenderMessage`/`PlayarrCastReceiverMessage` union's hand
// -written `Codable` conformance, which is the only place that needs to
// know the discriminant string.

struct PlayarrCastAuthUpdateMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var credentials: PlayarrCastCredentials

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil, credentials: PlayarrCastCredentials) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.credentials = credentials
    }
}

struct PlayarrCastSelectTracksMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    /// `string | undefined` -- omitted from the wire when `nil` (see
    /// `encodeIfPresent` in the union's `encode(to:)`): "don't change the
    /// audio track."
    var audioTrackId: String?
    /// `string | null` -- always sent (see plain `encode(_:forKey:)` in the
    /// union's `encode(to:)`): `nil` here means "explicitly turn subtitles
    /// off," not "leave subtitle selection untouched," matching how
    /// `PlayerEngine.selectSubtitleTrack(id: nil)` already behaves
    /// elsewhere in this codebase.
    var subtitleTrackId: String?

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil, audioTrackId: String? = nil, subtitleTrackId: String? = nil) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.audioTrackId = audioTrackId
        self.subtitleTrackId = subtitleTrackId
    }
}

struct PlayarrCastSelectQualityMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var qualityId: String

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil, qualityId: String) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.qualityId = qualityId
    }
}

struct PlayarrCastSetQueueMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var items: [PlayarrCastQueueEntry]

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil, items: [PlayarrCastQueueEntry]) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.items = items
    }
}

struct PlayarrCastPlayNextMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
    }
}

struct PlayarrCastRequestStateMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
    }
}

struct PlayarrCastEndSessionMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var reason: PlayarrCastStopReason

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil, reason: PlayarrCastStopReason) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.reason = reason
    }
}

enum PlayarrCastSenderMessage: Equatable, Sendable {
    case authUpdate(PlayarrCastAuthUpdateMessage)
    case selectTracks(PlayarrCastSelectTracksMessage)
    case selectQuality(PlayarrCastSelectQualityMessage)
    case setQueue(PlayarrCastSetQueueMessage)
    case playNext(PlayarrCastPlayNextMessage)
    case requestState(PlayarrCastRequestStateMessage)
    case endSession(PlayarrCastEndSessionMessage)
}

extension PlayarrCastSenderMessage: Codable {
    private enum MessageType: String, Codable {
        case authUpdate = "auth.update"
        case selectTracks = "tracks.select"
        case selectQuality = "quality.select"
        case setQueue = "queue.set"
        case playNext = "queue.playNext"
        case requestState = "state.request"
        case endSession = "session.end"
    }

    private enum CodingKeys: String, CodingKey {
        case type, protocolVersion, requestId
        case credentials, audioTrackId, subtitleTrackId, qualityId, items, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        let requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
        switch try container.decode(MessageType.self, forKey: .type) {
        case .authUpdate:
            self = .authUpdate(PlayarrCastAuthUpdateMessage(
                protocolVersion: protocolVersion,
                requestId: requestId,
                credentials: try container.decode(PlayarrCastCredentials.self, forKey: .credentials)
            ))
        case .selectTracks:
            self = .selectTracks(PlayarrCastSelectTracksMessage(
                protocolVersion: protocolVersion,
                requestId: requestId,
                audioTrackId: try container.decodeIfPresent(String.self, forKey: .audioTrackId),
                subtitleTrackId: try container.decodeIfPresent(String.self, forKey: .subtitleTrackId)
            ))
        case .selectQuality:
            self = .selectQuality(PlayarrCastSelectQualityMessage(
                protocolVersion: protocolVersion,
                requestId: requestId,
                qualityId: try container.decode(String.self, forKey: .qualityId)
            ))
        case .setQueue:
            self = .setQueue(PlayarrCastSetQueueMessage(
                protocolVersion: protocolVersion,
                requestId: requestId,
                items: try container.decode([PlayarrCastQueueEntry].self, forKey: .items)
            ))
        case .playNext:
            self = .playNext(PlayarrCastPlayNextMessage(protocolVersion: protocolVersion, requestId: requestId))
        case .requestState:
            self = .requestState(PlayarrCastRequestStateMessage(protocolVersion: protocolVersion, requestId: requestId))
        case .endSession:
            self = .endSession(PlayarrCastEndSessionMessage(
                protocolVersion: protocolVersion,
                requestId: requestId,
                reason: try container.decode(PlayarrCastStopReason.self, forKey: .reason)
            ))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .authUpdate(let message):
            try container.encode(MessageType.authUpdate, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.credentials, forKey: .credentials)
        case .selectTracks(let message):
            try container.encode(MessageType.selectTracks, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encodeIfPresent(message.audioTrackId, forKey: .audioTrackId)
            try container.encode(message.subtitleTrackId, forKey: .subtitleTrackId)
        case .selectQuality(let message):
            try container.encode(MessageType.selectQuality, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.qualityId, forKey: .qualityId)
        case .setQueue(let message):
            try container.encode(MessageType.setQueue, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.items, forKey: .items)
        case .playNext(let message):
            try container.encode(MessageType.playNext, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
        case .requestState(let message):
            try container.encode(MessageType.requestState, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
        case .endSession(let message):
            try container.encode(MessageType.endSession, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.reason, forKey: .reason)
        }
    }
}

// MARK: - Receiver -> sender messages

struct PlayarrCastReadyMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var receiverVersion: String
    var supportedProtocolVersion: Int
    var deviceCapabilities: PlayarrCastDeviceCapabilities

    init(
        protocolVersion: Int = PlayarrCastProtocol.protocolVersion,
        requestId: String? = nil,
        receiverVersion: String,
        supportedProtocolVersion: Int,
        deviceCapabilities: PlayarrCastDeviceCapabilities
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.receiverVersion = receiverVersion
        self.supportedProtocolVersion = supportedProtocolVersion
        self.deviceCapabilities = deviceCapabilities
    }
}

struct PlayarrCastStateMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var mediaFileId: String
    var sessionId: String?
    var negotiating: Bool
    var mode: PlayarrCastPlaybackMode?
    var sourceOffsetMs: Int64
    var positionMs: Int64
    var durationMs: Int64
    var audioTracks: [PlayarrCastTrackOption]
    var subtitleTracks: [PlayarrCastTrackOption]
    var qualityOptions: [PlayarrCastQualityOption]
    var selectedAudioTrackId: String?
    var selectedSubtitleTrackId: String?
    var selectedQualityId: String
    var queue: [PlayarrCastQueueEntry]

    init(
        protocolVersion: Int = PlayarrCastProtocol.protocolVersion,
        requestId: String? = nil,
        mediaFileId: String,
        sessionId: String?,
        negotiating: Bool,
        mode: PlayarrCastPlaybackMode?,
        sourceOffsetMs: Int64,
        positionMs: Int64,
        durationMs: Int64,
        audioTracks: [PlayarrCastTrackOption],
        subtitleTracks: [PlayarrCastTrackOption],
        qualityOptions: [PlayarrCastQualityOption],
        selectedAudioTrackId: String?,
        selectedSubtitleTrackId: String?,
        selectedQualityId: String,
        queue: [PlayarrCastQueueEntry]
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.mediaFileId = mediaFileId
        self.sessionId = sessionId
        self.negotiating = negotiating
        self.mode = mode
        self.sourceOffsetMs = sourceOffsetMs
        self.positionMs = positionMs
        self.durationMs = durationMs
        self.audioTracks = audioTracks
        self.subtitleTracks = subtitleTracks
        self.qualityOptions = qualityOptions
        self.selectedAudioTrackId = selectedAudioTrackId
        self.selectedSubtitleTrackId = selectedSubtitleTrackId
        self.selectedQualityId = selectedQualityId
        self.queue = queue
    }
}

struct PlayarrCastAuthRotatedMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var credentials: PlayarrCastCredentials

    init(protocolVersion: Int = PlayarrCastProtocol.protocolVersion, requestId: String? = nil, credentials: PlayarrCastCredentials) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.credentials = credentials
    }
}

struct PlayarrCastErrorMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    var requestId: String?
    var code: PlayarrCastErrorCode
    var message: String
    var apiStatus: Int?
    var retryable: Bool

    init(
        protocolVersion: Int = PlayarrCastProtocol.protocolVersion,
        requestId: String? = nil,
        code: PlayarrCastErrorCode,
        message: String,
        apiStatus: Int? = nil,
        retryable: Bool
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.code = code
        self.message = message
        self.apiStatus = apiStatus
        self.retryable = retryable
    }
}

struct PlayarrCastAckMessage: Codable, Equatable, Sendable {
    var protocolVersion: Int
    /// Required (not optional) here -- this concrete message type narrows
    /// the envelope's `requestId?: string` to a mandatory `string`, since an
    /// ack is meaningless without correlating back to the request it
    /// acknowledges. Deliberately has no default value in this initializer.
    var requestId: String
    var ok: Bool
    var code: PlayarrCastErrorCode?
    var message: String?

    init(
        protocolVersion: Int = PlayarrCastProtocol.protocolVersion,
        requestId: String,
        ok: Bool,
        code: PlayarrCastErrorCode? = nil,
        message: String? = nil
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.ok = ok
        self.code = code
        self.message = message
    }
}

enum PlayarrCastReceiverMessage: Equatable, Sendable {
    case ready(PlayarrCastReadyMessage)
    case state(PlayarrCastStateMessage)
    case authRotated(PlayarrCastAuthRotatedMessage)
    case error(PlayarrCastErrorMessage)
    case ack(PlayarrCastAckMessage)
}

extension PlayarrCastReceiverMessage: Codable {
    private enum MessageType: String, Codable {
        case ready
        case state
        case authRotated = "auth.rotated"
        case error
        case ack
    }

    private enum CodingKeys: String, CodingKey {
        case type, protocolVersion, requestId
        case receiverVersion, supportedProtocolVersion, deviceCapabilities
        case mediaFileId, sessionId, negotiating, mode, sourceOffsetMs, positionMs, durationMs
        case audioTracks, subtitleTracks, qualityOptions
        case selectedAudioTrackId, selectedSubtitleTrackId, selectedQualityId, queue
        case credentials
        case code, message, apiStatus, retryable
        case ok
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        switch try container.decode(MessageType.self, forKey: .type) {
        case .ready:
            self = .ready(PlayarrCastReadyMessage(
                protocolVersion: protocolVersion,
                requestId: try container.decodeIfPresent(String.self, forKey: .requestId),
                receiverVersion: try container.decode(String.self, forKey: .receiverVersion),
                supportedProtocolVersion: try container.decode(Int.self, forKey: .supportedProtocolVersion),
                deviceCapabilities: try container.decode(PlayarrCastDeviceCapabilities.self, forKey: .deviceCapabilities)
            ))
        case .state:
            self = .state(PlayarrCastStateMessage(
                protocolVersion: protocolVersion,
                requestId: try container.decodeIfPresent(String.self, forKey: .requestId),
                mediaFileId: try container.decode(String.self, forKey: .mediaFileId),
                sessionId: try container.decodeIfPresent(String.self, forKey: .sessionId),
                negotiating: try container.decode(Bool.self, forKey: .negotiating),
                mode: try container.decodeIfPresent(PlayarrCastPlaybackMode.self, forKey: .mode),
                sourceOffsetMs: try container.decode(Int64.self, forKey: .sourceOffsetMs),
                positionMs: try container.decode(Int64.self, forKey: .positionMs),
                durationMs: try container.decode(Int64.self, forKey: .durationMs),
                audioTracks: try container.decode([PlayarrCastTrackOption].self, forKey: .audioTracks),
                subtitleTracks: try container.decode([PlayarrCastTrackOption].self, forKey: .subtitleTracks),
                qualityOptions: try container.decode([PlayarrCastQualityOption].self, forKey: .qualityOptions),
                selectedAudioTrackId: try container.decodeIfPresent(String.self, forKey: .selectedAudioTrackId),
                selectedSubtitleTrackId: try container.decodeIfPresent(String.self, forKey: .selectedSubtitleTrackId),
                selectedQualityId: try container.decode(String.self, forKey: .selectedQualityId),
                queue: try container.decode([PlayarrCastQueueEntry].self, forKey: .queue)
            ))
        case .authRotated:
            self = .authRotated(PlayarrCastAuthRotatedMessage(
                protocolVersion: protocolVersion,
                requestId: try container.decodeIfPresent(String.self, forKey: .requestId),
                credentials: try container.decode(PlayarrCastCredentials.self, forKey: .credentials)
            ))
        case .error:
            self = .error(PlayarrCastErrorMessage(
                protocolVersion: protocolVersion,
                requestId: try container.decodeIfPresent(String.self, forKey: .requestId),
                code: try container.decode(PlayarrCastErrorCode.self, forKey: .code),
                message: try container.decode(String.self, forKey: .message),
                apiStatus: try container.decodeIfPresent(Int.self, forKey: .apiStatus),
                retryable: try container.decode(Bool.self, forKey: .retryable)
            ))
        case .ack:
            self = .ack(PlayarrCastAckMessage(
                protocolVersion: protocolVersion,
                requestId: try container.decode(String.self, forKey: .requestId),
                ok: try container.decode(Bool.self, forKey: .ok),
                code: try container.decodeIfPresent(PlayarrCastErrorCode.self, forKey: .code),
                message: try container.decodeIfPresent(String.self, forKey: .message)
            ))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ready(let message):
            try container.encode(MessageType.ready, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.receiverVersion, forKey: .receiverVersion)
            try container.encode(message.supportedProtocolVersion, forKey: .supportedProtocolVersion)
            try container.encode(message.deviceCapabilities, forKey: .deviceCapabilities)
        case .state(let message):
            try container.encode(MessageType.state, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.mediaFileId, forKey: .mediaFileId)
            try container.encode(message.sessionId, forKey: .sessionId)
            try container.encode(message.negotiating, forKey: .negotiating)
            try container.encode(message.mode, forKey: .mode)
            try container.encode(message.sourceOffsetMs, forKey: .sourceOffsetMs)
            try container.encode(message.positionMs, forKey: .positionMs)
            try container.encode(message.durationMs, forKey: .durationMs)
            try container.encode(message.audioTracks, forKey: .audioTracks)
            try container.encode(message.subtitleTracks, forKey: .subtitleTracks)
            try container.encode(message.qualityOptions, forKey: .qualityOptions)
            try container.encode(message.selectedAudioTrackId, forKey: .selectedAudioTrackId)
            try container.encode(message.selectedSubtitleTrackId, forKey: .selectedSubtitleTrackId)
            try container.encode(message.selectedQualityId, forKey: .selectedQualityId)
            try container.encode(message.queue, forKey: .queue)
        case .authRotated(let message):
            try container.encode(MessageType.authRotated, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.credentials, forKey: .credentials)
        case .error(let message):
            try container.encode(MessageType.error, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encodeIfPresent(message.requestId, forKey: .requestId)
            try container.encode(message.code, forKey: .code)
            try container.encode(message.message, forKey: .message)
            try container.encodeIfPresent(message.apiStatus, forKey: .apiStatus)
            try container.encode(message.retryable, forKey: .retryable)
        case .ack(let message):
            try container.encode(MessageType.ack, forKey: .type)
            try container.encode(message.protocolVersion, forKey: .protocolVersion)
            try container.encode(message.requestId, forKey: .requestId)
            try container.encode(message.ok, forKey: .ok)
            try container.encodeIfPresent(message.code, forKey: .code)
            try container.encodeIfPresent(message.message, forKey: .message)
        }
    }
}

// MARK: - Top-level message union + helpers

enum PlayarrCastMessage: Equatable, Sendable {
    case sender(PlayarrCastSenderMessage)
    case receiver(PlayarrCastReceiverMessage)
}

extension PlayarrCastMessage: Codable {
    init(from decoder: Decoder) throws {
        if let senderMessage = try? PlayarrCastSenderMessage(from: decoder) {
            self = .sender(senderMessage)
            return
        }
        self = .receiver(try PlayarrCastReceiverMessage(from: decoder))
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .sender(let message): try message.encode(to: encoder)
        case .receiver(let message): try message.encode(to: encoder)
        }
    }
}

/// Mirrors the TS type guard of the same name: attempts to decode `raw` (a
/// JSON string, as delivered by `GCKCastChannel.didReceiveTextMessage(_:)`)
/// as a `PlayarrCastLoadRequest`, reporting whether it succeeded.
func isPlayarrCastLoadRequest(_ raw: String) -> Bool {
    guard let data = raw.data(using: .utf8) else { return false }
    return (try? JSONDecoder().decode(PlayarrCastLoadRequest.self, from: data)) != nil
}

func isPlayarrCastSenderMessage(_ raw: String) -> Bool {
    guard let data = raw.data(using: .utf8) else { return false }
    return (try? JSONDecoder().decode(PlayarrCastSenderMessage.self, from: data)) != nil
}

func isPlayarrCastReceiverMessage(_ raw: String) -> Bool {
    guard let data = raw.data(using: .utf8) else { return false }
    return (try? JSONDecoder().decode(PlayarrCastReceiverMessage.self, from: data)) != nil
}

/// Never throws -- returns `nil` for anything that isn't valid JSON or
/// doesn't match either message union.
func parsePlayarrCastMessage(_ raw: String) -> PlayarrCastMessage? {
    guard let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(PlayarrCastMessage.self, from: data)
}

/// Throws `PlayarrCastProtocolError.messageTooLarge` past the 64 KB channel
/// cap (mirrors the TS `RangeError`).
func encodePlayarrCastMessage(_ message: PlayarrCastMessage) throws -> String {
    let data = try JSONEncoder().encode(message)
    guard data.count <= PlayarrCastProtocol.maxMessageBytes else {
        throw PlayarrCastProtocolError.messageTooLarge(byteCount: data.count)
    }
    guard let string = String(data: data, encoding: .utf8) else {
        throw PlayarrCastProtocolError.encodingFailed
    }
    return string
}
