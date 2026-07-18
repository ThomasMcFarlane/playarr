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
    public private(set) var qualityOptions: [PlaybackQualityOption] = []
    public private(set) var audioTracks: [PlaybackAudioTrackOption] = []
    public private(set) var subtitleTracks: [PlaybackSubtitleTrackOption] = []
    public private(set) var chapters: [MediaChapter] = []
    public private(set) var selectedQualityID = "original"
    public private(set) var selectedAudioTrackID: String?
    public private(set) var selectedSubtitleTrackID: String?

    /// Exposed purely so `PlayerView` can hand it to SwiftUI's
    /// `VideoPlayer` for rendering. See the doc comment on
    /// `PlayerEngine.avPlayer`.
    public var avPlayer: AVPlayer { engine.avPlayer }

    private let engine: PlayerEngine
    private let apiClient: StreamarrAPIClient
    @ObservationIgnored private var cancellables: Set<AnyCancellable> = []
    @ObservationIgnored private var heartbeatTask: Task<Void, Never>?
    @ObservationIgnored private var activeMediaFileID: UUID?
    @ObservationIgnored private var activeSessionID: UUID?
    @ObservationIgnored private var activeTitle = ""
    @ObservationIgnored private var qualityOverrideID: String?

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
        await finishActiveSession(reason: "user_stopped")
        loadState = .loadingPlaybackInfo
        errorMessage = nil
        do {
            let defaults = NativePlayerDefaults.read()
            let progress = try? await apiClient.getWatchProgress(mediaFileID: mediaFileID)
            let requestedProfile: String?
            if let qualityOverrideID {
                requestedProfile = qualityOptions.first(where: { $0.id == qualityOverrideID })?.profile
            } else {
                requestedProfile = defaults.profile
            }
            let info = try await apiClient.playbackInfo(
                mediaFileID: mediaFileID,
                containers: ["mp4", "mov", "m4v"],
                videoCodecs: ["h264", "hevc"],
                audioCodecs: ["aac", "ac3", "eac3"],
                maxBitrateBps: nil,
                profile: requestedProfile
            )
            playbackMode = info.mode
            activeMediaFileID = mediaFileID
            activeSessionID = info.sessionID
            activeTitle = title
            qualityOptions = info.qualityOptions
            audioTracks = info.audioTracks
            subtitleTracks = info.subtitleTracks
            selectedQualityID = info.selectedQualityID
            selectedAudioTrackID = info.selectedAudioTrackID
            selectedSubtitleTrackID = info.selectedSubtitleTrackID
            chapters = (try? await apiClient.mediaChapters(mediaFileID: mediaFileID)) ?? []

            guard let streamURL = apiClient.resolvedURL(forPath: info.url) else {
                throw APIError.invalidResponse
            }

            let requestHeaders = try await apiClient.playbackRequestHeaders()
            let item = PlayableItem(
                id: mediaFileID,
                streamURL: streamURL,
                title: title,
                startPositionSeconds: progress.map { Double($0.positionMS) / 1_000 } ?? 0,
                preferredAudioLanguageCode: defaults.audioLanguage,
                preferredSubtitleLanguageCode: defaults.subtitleMode == "off" ? nil : defaults.subtitleLanguage,
                httpHeaders: requestHeaders
            )
            try await engine.load(item)
            await applyTrackDefaults(defaults)
            duration = engine.duration > 0 ? engine.duration : Double(info.durationMS) / 1_000
            engine.play()
            loadState = .playing
            if let sessionID = info.sessionID {
                try? await apiClient.recordPlaybackEvent(sessionID: sessionID, event: PlaybackEventRequest(kind: "start"))
            }
            startHeartbeat()
        } catch let error as APIError {
            await failActiveSession(message: error.displayMessage)
            errorMessage = error.displayMessage
            loadState = .failed(error.displayMessage)
        } catch {
            await failActiveSession(message: error.localizedDescription)
            errorMessage = error.localizedDescription
            loadState = .failed(error.localizedDescription)
        }
    }

    public func togglePlayPause() {
        switch engineState {
        case .playing:
            engine.pause()
            sendEvent(PlaybackEventRequest(kind: "pause", positionMS: positionMS))
            persistProgress()
        default:
            engine.play()
            sendEvent(PlaybackEventRequest(kind: "resume", positionMS: positionMS))
        }
    }

    public func seek(to seconds: Double) async {
        let from = positionMS
        await engine.seek(to: seconds)
        sendEvent(PlaybackEventRequest(kind: "seek", fromMS: from, toMS: Int64(seconds * 1_000)))
        persistProgress()
    }

    public func stop() {
        let sessionID = activeSessionID
        let mediaFileID = activeMediaFileID
        let position = positionMS
        let duration = durationMS
        heartbeatTask?.cancel()
        heartbeatTask = nil
        engine.stop()
        loadState = .idle
        playbackMode = nil
        activeSessionID = nil
        activeMediaFileID = nil
        if let sessionID {
            Task { try? await apiClient.recordPlaybackEvent(sessionID: sessionID, event: PlaybackEventRequest(kind: "stop", positionMS: position, reason: "user_stopped")) }
        }
        if let mediaFileID, duration > 0 {
            Task {
                try? await apiClient.updateWatchProgress(
                    mediaFileID: mediaFileID,
                    body: UpdateWatchProgressRequest(positionMS: position, durationMS: duration, completed: position >= duration - 30_000)
                )
            }
        }
    }

    public func selectQuality(_ id: String) async {
        guard let mediaFileID = activeMediaFileID else { return }
        selectedQualityID = id
        qualityOverrideID = id
        await persistMediaOptions()
        await play(mediaFileID: mediaFileID, title: activeTitle)
    }

    public func selectAudioTrack(_ id: String?) async {
        selectedAudioTrackID = id
        await persistMediaOptions()
        guard let mediaFileID = activeMediaFileID else { return }
        await play(mediaFileID: mediaFileID, title: activeTitle)
    }

    public func selectSubtitleTrack(_ id: String?) async {
        selectedSubtitleTrackID = id
        await persistMediaOptions()
        guard let mediaFileID = activeMediaFileID else { return }
        await play(mediaFileID: mediaFileID, title: activeTitle)
    }

    // MARK: - Private

    private func bind() {
        engine.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                self.engineState = state
                switch state {
                case .ended:
                    Task { await self.completeActiveSession() }
                case .failed(let message):
                    self.errorMessage = message
                    self.loadState = .failed(message)
                    Task { await self.failActiveSession(message: message) }
                default:
                    break
                }
            }
            .store(in: &cancellables)

        engine.currentTimePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] time in self?.currentTime = time }
            .store(in: &cancellables)
    }

    private var positionMS: Int64 { Int64(max(0, currentTime) * 1_000) }
    private var durationMS: Int64 { Int64(max(0, duration) * 1_000) }

    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                guard !Task.isCancelled, let self else { return }
                await self.heartbeat()
            }
        }
    }

    private func heartbeat() async {
        if let sessionID = activeSessionID {
            try? await apiClient.recordPlaybackEvent(
                sessionID: sessionID,
                event: PlaybackEventRequest(kind: "heartbeat", positionMS: positionMS)
            )
        }
        if let mediaFileID = activeMediaFileID, durationMS > 0 {
            _ = try? await apiClient.updateWatchProgress(
                mediaFileID: mediaFileID,
                body: UpdateWatchProgressRequest(
                    positionMS: positionMS,
                    durationMS: durationMS,
                    completed: positionMS >= durationMS - 30_000
                )
            )
        }
    }

    private func persistProgress() {
        Task { await heartbeat() }
    }

    private func sendEvent(_ event: PlaybackEventRequest) {
        guard let sessionID = activeSessionID else { return }
        Task { try? await apiClient.recordPlaybackEvent(sessionID: sessionID, event: event) }
    }

    private func persistMediaOptions() async {
        guard let mediaFileID = activeMediaFileID else { return }
        _ = try? await apiClient.updateMediaPlaybackOptions(
            mediaFileID: mediaFileID,
            body: MediaPlaybackPreference(
                qualityID: selectedQualityID,
                audioTrackID: selectedAudioTrackID,
                subtitleTrackID: selectedSubtitleTrackID
            )
        )
    }

    private func finishActiveSession(reason: String) async {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        guard let sessionID = activeSessionID else { return }
        await heartbeat()
        try? await apiClient.recordPlaybackEvent(
            sessionID: sessionID,
            event: PlaybackEventRequest(kind: "stop", positionMS: positionMS, reason: reason)
        )
        activeSessionID = nil
    }

    private func completeActiveSession() async {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        if let mediaFileID = activeMediaFileID, durationMS > 0 {
            _ = try? await apiClient.updateWatchProgress(
                mediaFileID: mediaFileID,
                body: UpdateWatchProgressRequest(positionMS: durationMS, durationMS: durationMS, completed: true)
            )
        }
        guard let sessionID = activeSessionID else { return }
        await heartbeat()
        try? await apiClient.recordPlaybackEvent(
            sessionID: sessionID,
            event: PlaybackEventRequest(kind: "stop", positionMS: durationMS, reason: "completed")
        )
        activeSessionID = nil
        activeMediaFileID = nil
    }

    private func failActiveSession(message: String) async {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        guard let sessionID = activeSessionID else { return }
        await heartbeat()
        try? await apiClient.recordPlaybackEvent(
            sessionID: sessionID,
            event: PlaybackEventRequest(kind: "error", message: message)
        )
        activeSessionID = nil
        activeMediaFileID = nil
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
