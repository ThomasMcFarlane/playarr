import AVFoundation
import Combine
import Foundation
import Observation
import StreamarrKit

/// View model for `PlayerView`. Binds a `PlayerEngine` (default:
/// `AVPlayerEngine`, injectable for tests/previews) to a server-tracked
/// `PlaybackSession`, translating engine state changes into `@Observable`
/// properties the view reads, and view actions (play/pause/seek/stop) into
/// both engine calls and `StreamarrAPIClient` playback-event calls.
@MainActor
@Observable
public final class PlayerViewModel {
    public private(set) var engineState: PlayerPlaybackState = .idle
    public private(set) var currentTime: Double = 0
    public private(set) var duration: Double = 0
    public private(set) var session: PlaybackSession?
    public private(set) var errorMessage: String?

    /// Exposed purely so `PlayerView` can hand it to SwiftUI's
    /// `VideoPlayer` for rendering. See the doc comment on
    /// `PlayerEngine.avPlayer`.
    public var avPlayer: AVPlayer { engine.avPlayer }

    private let engine: PlayerEngine
    private let apiClient: StreamarrAPIClient
    @ObservationIgnored private var cancellables: Set<AnyCancellable> = []

    public init(engine: PlayerEngine, apiClient: StreamarrAPIClient) {
        self.engine = engine
        self.apiClient = apiClient
        bind()
    }

    public func start(work: Work, mediaFile: MediaFile, deviceID: UUID, streamURL: URL) async {
        do {
            let session = try await apiClient.startPlaybackSession(
                workID: work.id,
                mediaFileID: mediaFile.id,
                deviceID: deviceID
            )
            self.session = session

            let item = PlayableItem(
                id: mediaFile.id,
                streamURL: streamURL,
                title: work.title,
                startPositionSeconds: session.positionSeconds
            )
            try await engine.load(item)
            duration = engine.duration
            engine.play()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    public func togglePlayPause() {
        switch engineState {
        case .playing:
            engine.pause()
        default:
            engine.play()
        }
    }

    public func seek(to seconds: Double) async {
        await engine.seek(to: seconds)
    }

    public func stop(reason: StopReason) async {
        engine.stop()
        guard let session else { return }
        do {
            try await apiClient.endPlaybackSession(id: session.id, stopReason: reason)
        } catch {
            errorMessage = String(describing: error)
        }
        self.session = nil
    }

    // MARK: - Private

    private func bind() {
        engine.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.engineState = state }
            .store(in: &cancellables)

        engine.currentTimePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] time in self?.currentTime = time }
            .store(in: &cancellables)
    }
}
