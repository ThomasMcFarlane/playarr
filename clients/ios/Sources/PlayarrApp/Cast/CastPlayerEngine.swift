import AVFoundation
import Combine
import Foundation
import GoogleCast
import PlayarrKit

/// `PlayerEngine` implementation backed by an active Cast session's
/// `GCKRemoteMediaClient`, so `PlayerViewModel`'s existing transport-control
/// call sites (`togglePlayPause()`, `seek(to:)`, `selectAudioTrack(id:)`,
/// ...) keep working unchanged once `PlayerViewModel` swaps its `engine` to
/// one of these -- see `PlayerViewModel`'s `beginCasting()`/`endCasting()`.
///
/// `avPlayer` is always `nil` here -- this is *why*
/// `PlayerEngine.avPlayer` was relaxed to `AVPlayer?` for this build: there
/// is no local `AVPlayer` while a Cast session owns playback.
/// `PlayerView` swaps its rendering surface to a "Now casting" card instead
/// of a `VideoPlayer` whenever `CastSessionCoordinator.isCasting` is true.
@MainActor
final class CastPlayerEngine: NSObject, PlayerEngine {
    private(set) var state: PlayerPlaybackState = .idle {
        didSet { stateSubject.send(state) }
    }
    private(set) var currentTime: Double = 0 {
        didSet { timeSubject.send(currentTime) }
    }
    private(set) var duration: Double = 0

    var rate: Float = 1 {
        didSet { coordinator.remoteMediaClient?.setPlaybackRate(rate) }
    }

    /// Cast's mute control is device-level (`GCKCastSession`), not a
    /// per-stream `AVPlayer.isMuted` the way local playback has -- there is
    /// no per-title mute independent of the receiver device's own volume.
    var isMuted: Bool {
        get { coordinator.isDeviceMuted }
        set { coordinator.setDeviceMuted(newValue) }
    }

    var avPlayer: AVPlayer? { nil }

    var statePublisher: AnyPublisher<PlayerPlaybackState, Never> { stateSubject.eraseToAnyPublisher() }
    var currentTimePublisher: AnyPublisher<Double, Never> { timeSubject.eraseToAnyPublisher() }

    private let coordinator: CastSessionCoordinator
    private let apiClient: PlayarrAPIClient
    private let stateSubject = PassthroughSubject<PlayerPlaybackState, Never>()
    private let timeSubject = PassthroughSubject<Double, Never>()
    private var positionPollTask: Task<Void, Never>?
    private var isListening = false

    init(coordinator: CastSessionCoordinator = .shared, apiClient: PlayarrAPIClient) {
        self.coordinator = coordinator
        self.apiClient = apiClient
        super.init()
    }

    deinit {
        positionPollTask?.cancel()
    }

    func load(_ item: PlayableItem) async throws {
        state = .loading
        // `PlayableItem` is shared with the local `AVPlayerEngine` and only
        // carries what that engine needs -- it has no work-kind/season/
        // episode metadata, because `PlayerView`'s caller only ever passes
        // it a media file id + title today (see `PlayerView.init`). `.other`
        // is the protocol's documented catch-all for exactly this "just
        // play this media file" case; `item.streamURL`/`item.httpHeaders`
        // are deliberately unused below -- the receiver does its own
        // negotiation and never touches the sender's locally-negotiated URL.
        let castItem = PlayarrCastItem(mediaFileId: item.id.uuidString, kind: .other, title: item.title)
        let intent = PlayarrCastPlaybackIntent(
            startPositionMs: Int64(max(0, item.startPositionSeconds) * 1_000),
            preferredAudioLanguage: item.preferredAudioLanguageCode,
            preferredSubtitleLanguage: item.preferredSubtitleLanguageCode
        )
        try await coordinator.loadItem(castItem, playback: intent, apiClient: apiClient)
        startListening()
        state = .readyToPlay
    }

    func play() { coordinator.remoteMediaClient?.play() }
    func pause() { coordinator.remoteMediaClient?.pause() }

    func stop() {
        coordinator.remoteMediaClient?.stop()
        stopListening()
        state = .idle
    }

    /// The receiver -- not this sender -- decides whether this seek needs a
    /// fresh negotiated session (HLS) or a raw engine seek (direct play);
    /// see `PlayarrCastPlaybackIntent.startPositionMs`'s doc comment. The
    /// sender only ever issues a normal Cast seek request here.
    func seek(to seconds: Double) async {
        guard let client = coordinator.remoteMediaClient else { return }
        let options = GCKMediaSeekOptions()
        options.interval = seconds
        client.seek(with: options)
        currentTime = seconds
    }

    func availableAudioTracks() async -> [PlayerTrack] {
        (coordinator.receiverState?.audioTracks ?? []).map(Self.playerTrack)
    }

    func availableSubtitleTracks() async -> [PlayerTrack] {
        (coordinator.receiverState?.subtitleTracks ?? []).map(Self.playerTrack)
    }

    func selectAudioTrack(id: String?) {
        coordinator.sendSelectTracks(audioTrackId: id, subtitleTrackId: nil)
    }

    func selectSubtitleTrack(id: String?) {
        coordinator.sendSelectTracks(audioTrackId: nil, subtitleTrackId: id)
    }

    /// No-op: Cast has no local rendering surface to picture-in-picture --
    /// the receiver device is the display.
    func setPictureInPictureLayer(_ layer: AVPlayerLayer?) {}

    // MARK: - Private

    private static func playerTrack(_ option: PlayarrCastTrackOption) -> PlayerTrack {
        PlayerTrack(
            id: option.id,
            languageCode: option.language,
            displayName: option.label,
            isDefault: option.isDefault,
            isForced: option.forced
        )
    }

    private func startListening() {
        guard !isListening else { return }
        isListening = true
        coordinator.remoteMediaClient?.add(self)
        positionPollTask?.cancel()
        // `GCKRemoteMediaClient` doesn't push a per-second position update
        // the way `AVPlayer.addPeriodicTimeObserver` does -- polling
        // `approximateStreamPosition()` on the same ~0.5s cadence
        // `AVPlayerEngine` uses for its own periodic observer is the
        // standard way CAF sender apps keep a scrubber moving smoothly
        // between full `GCKMediaStatus` updates.
        positionPollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled, let self else { return }
                self.refreshFromMediaStatus()
            }
        }
    }

    private func stopListening() {
        guard isListening else { return }
        isListening = false
        coordinator.remoteMediaClient?.remove(self)
        positionPollTask?.cancel()
        positionPollTask = nil
    }

    private func refreshFromMediaStatus() {
        guard let client = coordinator.remoteMediaClient else { return }
        currentTime = client.approximateStreamPosition()
        let streamDuration = client.mediaStatus?.mediaInformation?.streamDuration ?? 0
        if streamDuration > 0 {
            duration = streamDuration
        }
    }
}

extension CastPlayerEngine: GCKRemoteMediaClientListener {
    func remoteMediaClient(_ client: GCKRemoteMediaClient, didUpdate mediaStatus: GCKMediaStatus?) {
        guard let mediaStatus else { return }
        switch mediaStatus.playerState {
        case .idle: state = .idle
        case .playing: state = .playing
        case .paused: state = .paused
        case .buffering: state = .buffering
        case .loading: state = .loading
        @unknown default: break
        }
        refreshFromMediaStatus()
    }
}
