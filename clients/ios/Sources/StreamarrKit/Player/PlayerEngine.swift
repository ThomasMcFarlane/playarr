import AVFoundation
import AVKit
import Combine
import Observation

/// Everything `PlayerEngine.load(_:)` needs to start playing one media
/// file — resolved by the caller (typically `PlayerViewModel`) from
/// `StreamarrAPIClient.playbackInfo(mediaFileID:...)`'s
/// `PlaybackInfoResponse.url` (direct-play file URL or HLS manifest URL,
/// per `PlaybackInfoResponse.mode`).
public struct PlayableItem: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let streamURL: URL
    public let title: String
    public let startPositionSeconds: Double
    public let preferredAudioLanguageCode: String?
    public let preferredSubtitleLanguageCode: String?

    public init(
        id: UUID,
        streamURL: URL,
        title: String,
        startPositionSeconds: Double = 0,
        preferredAudioLanguageCode: String? = nil,
        preferredSubtitleLanguageCode: String? = nil
    ) {
        self.id = id
        self.streamURL = streamURL
        self.title = title
        self.startPositionSeconds = startPositionSeconds
        self.preferredAudioLanguageCode = preferredAudioLanguageCode
        self.preferredSubtitleLanguageCode = preferredSubtitleLanguageCode
    }
}

/// Client-side playback state machine — purely "what is the local
/// `AVPlayer` doing right now". The current OpenAPI spec has no
/// server-tracked playback-session/progress-reporting endpoints yet (only
/// the direct-play/transcode negotiation in `GET
/// /api/v1/playback/{media_file_id}`), so there is no separate
/// server-side session type to stay distinct from here.
public enum PlayerPlaybackState: Equatable, Sendable {
    case idle
    case loading
    case readyToPlay
    case playing
    case paused
    case buffering
    case ended
    case failed(String)
}

/// One selectable audio or subtitle track, as surfaced by
/// `PlayerEngine.availableAudioTracks()`/`availableSubtitleTracks()`.
public struct PlayerTrack: Identifiable, Equatable, Sendable {
    public let id: String
    public let languageCode: String?
    public let displayName: String
    public let isDefault: Bool

    public init(id: String, languageCode: String?, displayName: String, isDefault: Bool) {
        self.id = id
        self.languageCode = languageCode
        self.displayName = displayName
        self.isDefault = isDefault
    }
}

/// A real-shaped abstraction over "something that can play a
/// `PlayableItem`". `AVPlayerEngine` below is the AVFoundation/AVKit-backed
/// implementation used today; the protocol exists so:
///
///   - `PlayerViewModel` (and any unit tests) depend on player *behavior*,
///     never `AVPlayer` directly, so it can be driven by a fake in tests.
///   - a future tvOS target's player screen can reuse the exact same
///     `PlayerEngine` conformance and view-model call sites — only the
///     SwiftUI chrome/focus-engine navigation around it differs per
///     platform.
@MainActor
public protocol PlayerEngine: AnyObject {
    var state: PlayerPlaybackState { get }
    var currentTime: Double { get }
    var duration: Double { get }
    var rate: Float { get set }
    var isMuted: Bool { get set }

    var statePublisher: AnyPublisher<PlayerPlaybackState, Never> { get }
    var currentTimePublisher: AnyPublisher<Double, Never> { get }

    /// Exposes the underlying `AVPlayer` purely so a rendering surface
    /// (SwiftUI's `VideoPlayer`, or a `UIViewControllerRepresentable`
    /// wrapping `AVPlayerViewController`) has something to render. Every
    /// other concern — state, seeking, track selection — should go
    /// through this protocol, not this escape hatch, so call sites stay
    /// testable against a mock `PlayerEngine`.
    var avPlayer: AVPlayer { get }

    func load(_ item: PlayableItem) async throws
    func play()
    func pause()
    func stop()
    func seek(to seconds: Double) async

    func availableAudioTracks() async -> [PlayerTrack]
    func availableSubtitleTracks() async -> [PlayerTrack]
    func selectAudioTrack(id: String?)
    func selectSubtitleTrack(id: String?)

    /// Wires up (or, passing `nil`, tears down) AVKit picture-in-picture
    /// for the given player layer. Call once a hosting `AVPlayerLayer`
    /// exists (typically from the view that renders `avPlayer`).
    func setPictureInPictureLayer(_ layer: AVPlayerLayer?)
}

/// AVFoundation/AVKit-backed `PlayerEngine`. Owns a single `AVPlayer` and
/// republishes its KVO/notification-based state as both `Combine`
/// publishers and `@Observable`-tracked properties, so SwiftUI view models
/// can bind to it either way.
@MainActor
@Observable
public final class AVPlayerEngine: NSObject, PlayerEngine {
    public private(set) var state: PlayerPlaybackState = .idle
    public private(set) var currentTime: Double = 0
    public private(set) var duration: Double = 0

    public var rate: Float = 1 {
        didSet {
            guard state == .playing else { return }
            player.rate = rate
        }
    }

    /// Pass-through to `AVPlayer.isMuted`. Not independently
    /// observation-tracked (the underlying `player` is
    /// `@ObservationIgnored`) — callers that need a view to react to mute
    /// changes made elsewhere should keep their own `@State` in sync.
    public var isMuted: Bool {
        get { player.isMuted }
        set { player.isMuted = newValue }
    }

    public var avPlayer: AVPlayer { player }

    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var currentItem: AVPlayerItem?
    @ObservationIgnored private var timeObserverToken: Any?
    @ObservationIgnored private var itemStatusObservation: NSKeyValueObservation?
    @ObservationIgnored private var bufferEmptyObservation: NSKeyValueObservation?
    @ObservationIgnored private var likelyToKeepUpObservation: NSKeyValueObservation?
    @ObservationIgnored private var didPlayToEndObserver: NSObjectProtocol?
    @ObservationIgnored private var pictureInPictureController: AVPictureInPictureController?

    @ObservationIgnored private let stateSubject = PassthroughSubject<PlayerPlaybackState, Never>()
    @ObservationIgnored private let timeSubject = PassthroughSubject<Double, Never>()

    public var statePublisher: AnyPublisher<PlayerPlaybackState, Never> {
        stateSubject.eraseToAnyPublisher()
    }

    public var currentTimePublisher: AnyPublisher<Double, Never> {
        timeSubject.eraseToAnyPublisher()
    }

    public override init() {
        super.init()
        addPeriodicTimeObserver()
    }

    deinit {
        if let timeObserverToken {
            player.removeTimeObserver(timeObserverToken)
        }
        if let didPlayToEndObserver {
            NotificationCenter.default.removeObserver(didPlayToEndObserver)
        }
    }

    public func load(_ item: PlayableItem) async throws {
        updateState(.loading)

        let asset = AVURLAsset(url: item.streamURL)
        let (_, assetDuration) = try await asset.load(.isPlayable, .duration)

        let playerItem = AVPlayerItem(asset: asset)
        observe(playerItem)
        currentItem = playerItem
        player.replaceCurrentItem(with: playerItem)

        duration = CMTimeGetSeconds(assetDuration)

        if item.startPositionSeconds > 0 {
            await seek(to: item.startPositionSeconds)
        }

        updateState(.readyToPlay)
    }

    public func play() {
        player.play()
        player.rate = rate
        updateState(.playing)
    }

    public func pause() {
        player.pause()
        updateState(.paused)
    }

    public func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentItem = nil
        currentTime = 0
        updateState(.idle)
    }

    public func seek(to seconds: Double) async {
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        await player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        currentTime = seconds
        timeSubject.send(seconds)
    }

    public func availableAudioTracks() async -> [PlayerTrack] {
        await tracks(for: .audible)
    }

    public func availableSubtitleTracks() async -> [PlayerTrack] {
        await tracks(for: .legible)
    }

    public func selectAudioTrack(id: String?) {
        selectTrack(id: id, characteristic: .audible)
    }

    public func selectSubtitleTrack(id: String?) {
        selectTrack(id: id, characteristic: .legible)
    }

    public func setPictureInPictureLayer(_ layer: AVPlayerLayer?) {
        guard let layer else {
            pictureInPictureController = nil
            return
        }
        guard AVPictureInPictureController.isPictureInPictureSupported() else { return }
        pictureInPictureController = AVPictureInPictureController(playerLayer: layer)
    }

    // MARK: - Private

    private func addPeriodicTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            let seconds = CMTimeGetSeconds(time)
            guard seconds.isFinite else { return }
            // `addPeriodicTimeObserver`'s closure is `@Sendable` even though
            // we pinned `queue: .main`, so hop explicitly rather than
            // mutate MainActor-isolated state directly from it.
            Task { @MainActor in
                self.currentTime = seconds
                self.timeSubject.send(seconds)
            }
        }
    }

    private func observe(_ item: AVPlayerItem) {
        itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] playerItem, _ in
            guard let self else { return }
            Task { @MainActor in
                switch playerItem.status {
                case .readyToPlay:
                    self.updateState(.readyToPlay)
                case .failed:
                    let message = playerItem.error?.localizedDescription ?? "Unknown playback error"
                    self.updateState(.failed(message))
                case .unknown:
                    break
                @unknown default:
                    break
                }
            }
        }

        bufferEmptyObservation = item.observe(\.isPlaybackBufferEmpty, options: [.new]) { [weak self] playerItem, _ in
            guard let self, playerItem.isPlaybackBufferEmpty else { return }
            Task { @MainActor in
                self.updateState(.buffering)
            }
        }

        likelyToKeepUpObservation = item.observe(\.isPlaybackLikelyToKeepUp, options: [.new]) { [weak self] playerItem, _ in
            guard let self, playerItem.isPlaybackLikelyToKeepUp else { return }
            Task { @MainActor in
                guard self.state == .buffering else { return }
                self.updateState(.playing)
            }
        }

        didPlayToEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.updateState(.ended)
            }
        }
    }

    private func tracks(for characteristic: AVMediaCharacteristic) async -> [PlayerTrack] {
        guard let asset = currentItem?.asset,
              let group = try? await asset.loadMediaSelectionGroup(for: characteristic) else {
            return []
        }
        return group.options.map { option in
            PlayerTrack(
                id: trackID(for: option),
                languageCode: option.extendedLanguageTag,
                displayName: option.displayName,
                isDefault: group.defaultOption == option
            )
        }
    }

    private func selectTrack(id: String?, characteristic: AVMediaCharacteristic) {
        guard let currentItem else { return }
        Task {
            guard let group = try? await currentItem.asset.loadMediaSelectionGroup(for: characteristic) else { return }
            guard let id else {
                currentItem.select(nil, in: group)
                return
            }
            let match = group.options.first { trackID(for: $0) == id }
            currentItem.select(match, in: group)
        }
    }

    private func trackID(for option: AVMediaSelectionOption) -> String {
        "\(option.mediaType.rawValue)-\(option.extendedLanguageTag ?? option.displayName)"
    }

    private func updateState(_ newState: PlayerPlaybackState) {
        state = newState
        stateSubject.send(newState)
    }
}
