import AVFoundation
import Combine
import Foundation
import Observation
import StreamarrKit

struct NativePlayerDefaults: Equatable {
    static let qualityKey = "com.streamarr.ios.player.quality"
    static let subtitleModeKey = "com.streamarr.ios.player.subtitle-mode"
    static let subtitleLanguageKey = "com.streamarr.ios.player.subtitle-language"
    static let audioLanguageKey = "com.streamarr.ios.player.audio-language"

    let qualityID: String
    let subtitleMode: String
    let subtitleLanguage: String
    let audioLanguage: String

    var profile: String? { qualityID == "original" ? nil : qualityID }

    static func read(from defaults: UserDefaults = .standard) -> NativePlayerDefaults {
        NativePlayerDefaults(
            qualityID: defaults.string(forKey: qualityKey) ?? "original",
            subtitleMode: defaults.string(forKey: subtitleModeKey) ?? "off",
            subtitleLanguage: defaults.string(forKey: subtitleLanguageKey) ?? "en",
            audioLanguage: defaults.string(forKey: audioLanguageKey) ?? "en"
        )
    }
}

/// View model for `PlayerView`. Binds a `PlayerEngine` (default:
/// `AVPlayerEngine`, injectable for tests/previews) to the real playback
/// pipeline: calls `GET /api/v1/playback/{media_file_id}` first to get the
/// server's direct-play/transcode decision (`PlaybackInfoResponse`), then
/// configures the engine with whatever URL it returns, per
/// `PlaybackInfoResponse.mode` (`.direct` or `.hls`) — the engine itself
/// doesn't need to branch on that (`AVPlayer`/`AVURLAsset` play an HLS
/// `.m3u8` URL exactly like a direct file URL), but it's kept around on
/// this view model so the UI can show *why* something is (or isn't)
/// transcoding.
@MainActor
@Observable
public final class PlayerViewModel {
    public enum LoadState: Equatable, Sendable {
        case idle
        case loadingPlaybackInfo
        case playing
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var engineState: PlayerPlaybackState = .idle
    public private(set) var currentTime: Double = 0
    public private(set) var duration: Double = 0
    public private(set) var playbackMode: PlaybackMode?
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

    /// Calls the real playback-negotiation endpoint for `mediaFileID`, then
    /// loads and starts the returned URL in the local `PlayerEngine`.
    /// `title` is display-only (the API has nothing else to show while
    /// negotiating/loading).
    public func play(mediaFileID: UUID, title: String) async {
        loadState = .loadingPlaybackInfo
        errorMessage = nil
        do {
            let defaults = NativePlayerDefaults.read()
            let info = try await apiClient.playbackInfo(
                mediaFileID: mediaFileID,
                containers: ["mp4", "mov", "m4v"],
                videoCodecs: ["h264", "hevc"],
                audioCodecs: ["aac", "ac3", "eac3"],
                maxBitrateBps: nil,
                profile: defaults.profile
            )
            playbackMode = info.mode

            guard let streamURL = apiClient.resolvedURL(forPath: info.url) else {
                throw APIError.invalidResponse
            }

            let requestHeaders = try await apiClient.playbackRequestHeaders()
            let item = PlayableItem(
                id: mediaFileID,
                streamURL: streamURL,
                title: title,
                preferredAudioLanguageCode: defaults.audioLanguage,
                preferredSubtitleLanguageCode: defaults.subtitleMode == "off" ? nil : defaults.subtitleLanguage,
                httpHeaders: requestHeaders
            )
            try await engine.load(item)
            await applyTrackDefaults(defaults)
            duration = engine.duration
            engine.play()
            loadState = .playing
        } catch let error as APIError {
            errorMessage = error.displayMessage
            loadState = .failed(error.displayMessage)
        } catch {
            errorMessage = error.localizedDescription
            loadState = .failed(error.localizedDescription)
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

    public func stop() {
        engine.stop()
        loadState = .idle
        playbackMode = nil
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

    private func applyTrackDefaults(_ defaults: NativePlayerDefaults) async {
        let audioTracks = await engine.availableAudioTracks()
        let preferredAudio = audioTracks.first {
            $0.languageCode?.lowercased().hasPrefix(defaults.audioLanguage.lowercased()) == true
        }
        engine.selectAudioTrack(id: preferredAudio?.id)

        guard defaults.subtitleMode != "off" else {
            engine.selectSubtitleTrack(id: nil)
            return
        }
        let subtitleTracks = await engine.availableSubtitleTracks()
        let eligibleSubtitles = defaults.subtitleMode == "forced"
            ? subtitleTracks.filter(\.isForced)
            : subtitleTracks
        let preferredSubtitle = eligibleSubtitles.first {
            $0.languageCode?.lowercased().hasPrefix(defaults.subtitleLanguage.lowercased()) == true
        } ?? eligibleSubtitles.first(where: \.isDefault) ?? eligibleSubtitles.first
        engine.selectSubtitleTrack(id: preferredSubtitle?.id)
    }
}
