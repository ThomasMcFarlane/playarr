import AVFoundation
import Combine
import Foundation
import Observation
import PlayarrKit

struct NativePlayerDefaults: Equatable {
    static let qualityKey = "com.playarr.ios.player.quality"
    static let subtitleModeKey = "com.playarr.ios.player.subtitle-mode"
    static let subtitleLanguageKey = "com.playarr.ios.player.subtitle-language"
    static let audioLanguageKey = "com.playarr.ios.player.audio-language"

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
    /// Title of whatever is currently loaded (changes when the queue advances).
    public private(set) var currentTitle = ""
    /// Series and `S{n}:E{m}` (or album) line for the loaded item.
    public private(set) var currentSubtitle: String?
    /// End card / up-next countdown state; see `EndOfPlaybackMachine`.
    public let endOfPlayback = EndOfPlaybackController()
    /// Invoked when the user taps Exit on the end card or countdown.
    @ObservationIgnored public var onExit: () -> Void = {}

    /// Exposed purely so `PlayerView` can hand it to SwiftUI's
    /// `VideoPlayer` for rendering. See the doc comment on
    /// `PlayerEngine.avPlayer`. `nil` whenever `engine` is a
    /// `CastPlayerEngine` -- `PlayerView` shows a "Now casting" card
    /// instead of a `VideoPlayer` in that case (see
    /// `CastSessionCoordinator.isCasting`).
    public var avPlayer: AVPlayer? { engine.avPlayer }

    /// `true` once a Cast session has taken over transport control.
    /// `togglePlayPause()`/`seek(to:)`/track & quality selection all keep
    /// working unchanged below (they operate on `engine`, whatever it
    /// currently is), but the *local* server-session heartbeat/progress
    /// machinery must stay quiet while this is true, since the receiver
    /// owns progress reporting during a cast -- see `heartbeat()`'s guard.
    private var isCasting = false
    /// `true` while playing an already-downloaded local file (see
    /// `playLocalFile`) -- `PlayerView` hides its cast affordance in this
    /// case, since a sandboxed `file://` URL is unreachable from a real
    /// Chromecast device.
    public private(set) var isPlayingLocalFile = false

    /// Not `let`: swapped between a local `AVPlayerEngine` and a
    /// `CastPlayerEngine` by `beginCasting()`/`endCasting()` below, so
    /// every existing call site here (`togglePlayPause`, `seek(to:)`, track
    /// selection, ...) keeps working unchanged regardless of which one is
    /// currently active.
    private var engine: PlayerEngine
    private let apiClient: PlayarrAPIClient
    private let downloadRepository: DownloadRepository
    private let castCoordinator: CastSessionCoordinator
    @ObservationIgnored private var cancellables: Set<AnyCancellable> = []
    @ObservationIgnored private var heartbeatTask: Task<Void, Never>?
    @ObservationIgnored private var activeMediaFileID: UUID?
    @ObservationIgnored private var activeSessionID: UUID?
    @ObservationIgnored private var activeTitle = ""
    /// Survives `completeActiveSession()` (which clears `activeMediaFileID`)
    /// so Replay knows what to restart.
    @ObservationIgnored private var lastMediaFileID: UUID?
    @ObservationIgnored private var qualityOverrideID: String?

    public init(
        engine: PlayerEngine,
        apiClient: PlayarrAPIClient,
        downloadRepository: DownloadRepository,
        castCoordinator: CastSessionCoordinator = .shared
    ) {
        self.engine = engine
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.castCoordinator = castCoordinator
        bind()
        endOfPlayback.perform = { [weak self] action in
            guard let self else { return }
            switch action {
            case .none: break
            case .play(let entry):
                self.currentSubtitle = entry.subtitle
                Task { await self.play(mediaFileID: entry.mediaFileID, title: entry.title) }
            case .replay: Task { await self.replay() }
            case .exit: self.onExit()
            }
        }
        // "Last registrant wins": whichever `PlayerViewModel` is
        // constructed most recently is the one a subsequent cast handoff
        // acts on -- see `CastSessionCoordinator.onReadyToLoad`'s doc
        // comment. The `[weak self]` captures make a callback that fires
        // after this instance is gone a safe no-op, so there's nothing to
        // explicitly unregister in a `deinit`.
        castCoordinator.onReadyToLoad = { [weak self] in await self?.beginCasting() }
        castCoordinator.onSessionEnded = { [weak self] in self?.endCasting() }
    }

    /// Calls the real playback-negotiation endpoint for `mediaFileID`, then
    /// loads and starts the returned URL in the local `PlayerEngine`. If
    /// this media file has already been downloaded (`DownloadRepository
    /// .localFileURL(forMediaFileID:)` resolves), plays straight from that
    /// local file instead — no network call, works fully offline — before
    /// ever reaching the network `playbackInfo()` negotiation below.
    /// `title` is display-only (the API has nothing else to show while
    /// negotiating/loading).
    public func play(mediaFileID: UUID, title: String, startFromBeginning: Bool = false) async {
        await finishActiveSession(reason: "user_stopped")
        endOfPlayback.playbackResumed()
        currentTitle = title
        lastMediaFileID = mediaFileID
        loadState = .loadingPlaybackInfo
        errorMessage = nil
        isPlayingLocalFile = false

        if let localFileURL = downloadRepository.localFileURL(forMediaFileID: mediaFileID) {
            await playLocalFile(localFileURL, mediaFileID: mediaFileID, title: title, startFromBeginning: startFromBeginning)
            return
        }

        do {
            let defaults = NativePlayerDefaults.read()
            let progress = startFromBeginning ? nil : try? await apiClient.getWatchProgress(mediaFileID: mediaFileID)
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
                startPositionSeconds: progress.map { Double(PlaybackQueueBuilder.resumeMS(positionMS: $0.positionMS, durationMS: $0.durationMS)) / 1_000 } ?? 0,
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

    /// Plays a downloaded file directly with no `playbackInfo()` network
    /// call — the whole point of a download is that this works offline.
    /// Still opportunistically fetches/updates server watch progress
    /// (`try?`-guarded so a lack of connectivity never blocks playback),
    /// and skips every server-playback-session call (`recordPlaybackEvent`)
    /// since there is no `PlaybackInfoResponse.sessionID` for a purely
    /// local play.
    private func playLocalFile(_ fileURL: URL, mediaFileID: UUID, title: String, startFromBeginning: Bool = false) async {
        isPlayingLocalFile = true
        let defaults = NativePlayerDefaults.read()
        let progress = startFromBeginning ? nil : try? await apiClient.getWatchProgress(mediaFileID: mediaFileID)
        playbackMode = .direct
        activeMediaFileID = mediaFileID
        activeSessionID = nil
        activeTitle = title
        qualityOptions = []
        audioTracks = []
        subtitleTracks = []
        selectedQualityID = "original"
        selectedAudioTrackID = nil
        selectedSubtitleTrackID = nil
        chapters = []

        let item = PlayableItem(
            id: mediaFileID,
            streamURL: fileURL,
            title: title,
            startPositionSeconds: progress.map { Double(PlaybackQueueBuilder.resumeMS(positionMS: $0.positionMS, durationMS: $0.durationMS)) / 1_000 } ?? 0,
            preferredAudioLanguageCode: defaults.audioLanguage,
            preferredSubtitleLanguageCode: defaults.subtitleMode == "off" ? nil : defaults.subtitleLanguage
        )
        do {
            try await engine.load(item)
            await applyTrackDefaults(defaults)
            duration = engine.duration
            engine.play()
            loadState = .playing
            startHeartbeat()
        } catch {
            errorMessage = error.localizedDescription
            loadState = .failed(error.localizedDescription)
        }
    }

    /// Items that follow the current one; drives the up-next countdown.
    public func setQueue(_ entries: [PlaybackQueueEntry], advance: EndOfPlaybackMachine.Advance = .countdown, subtitle: String? = nil) {
        endOfPlayback.setQueue(entries, advance: advance)
        currentSubtitle = subtitle
    }

    /// Restarts the finished item from the beginning (end card "Replay").
    public func replay() async {
        guard let mediaFileID = lastMediaFileID else { return }
        await play(mediaFileID: mediaFileID, title: currentTitle, startFromBeginning: true)
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

    /// No-op while casting -- ending the *cast session* goes through
    /// `CastSessionCoordinator.endSession(reason:)` (from the "Now
    /// casting" card or `RootView`'s persistent affordance), never this
    /// method; see `viewDidDisappear()`.
    public func stop() {
        guard !isCasting else { return }
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

    /// Cast-aware replacement for calling `stop()` directly from
    /// `PlayerView.onDisappear` -- navigating away from the local view must
    /// not kill an active cast session (casting keeps playing on the
    /// receiver regardless of what the sender app is showing).
    public func viewDidDisappear() {
        // Leaving the screen (including to a suggestion) is an explicit
        // action: the countdown stops and does not restart.
        endOfPlayback.cancelCountdown()
        endOfPlayback.stopTimer()
        guard !isCasting else { return }
        stop()
    }

    public func selectQuality(_ id: String) async {
        guard let mediaFileID = activeMediaFileID else { return }
        selectedQualityID = id
        qualityOverrideID = id
        await persistMediaOptions()
        if isCasting {
            // Live in-place quality switch on the already-connected
            // receiver -- not a full reload/renegotiation the way local
            // playback needs below.
            castCoordinator.sendSelectQuality(id)
            return
        }
        await play(mediaFileID: mediaFileID, title: activeTitle)
    }

    public func selectAudioTrack(_ id: String?) async {
        selectedAudioTrackID = id
        await persistMediaOptions()
        if isCasting {
            engine.selectAudioTrack(id: id)
            return
        }
        guard let mediaFileID = activeMediaFileID else { return }
        await play(mediaFileID: mediaFileID, title: activeTitle)
    }

    public func selectSubtitleTrack(_ id: String?) async {
        selectedSubtitleTrackID = id
        await persistMediaOptions()
        if isCasting {
            engine.selectSubtitleTrack(id: id)
            return
        }
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
                    self.endOfPlayback.mediaEnded()
                    Task { await self.completeActiveSession() }
                case .failed(let message):
                    self.errorMessage = message
                    self.loadState = .failed(message)
                    Task { await self.failActiveSession(message: message) }
                case .playing:
                    self.endOfPlayback.playbackResumed()
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
        // The receiver owns progress/event reporting while a cast is
        // active (its own heartbeat, against its own negotiated session) --
        // posting from here too would be a second writer racing the same
        // endpoint. See the design doc's note on why the sender stops its
        // own local session before handing off to cast in the first place.
        guard !isCasting else { return }
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
            // Anchors `KeepUntilPolicy.afterWatched` for a downloaded copy
            // of this media file, if any — a no-op if it was never
            // downloaded, or was already marked watched once before.
            downloadRepository.markWatched(mediaFileID: mediaFileID)
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

    // MARK: - Casting

    /// Fires when `CastSessionCoordinator`'s receiver handshake completes
    /// (see `onReadyToLoad`). Stops this view model's own local session
    /// first -- the sender must never keep posting progress once the
    /// receiver owns it -- then swaps `engine` to a `CastPlayerEngine` so
    /// every existing transport-control call site above keeps working
    /// unchanged.
    private func beginCasting() async {
        guard let mediaFileID = activeMediaFileID, !isCasting, !isPlayingLocalFile else { return }
        let resumePosition = currentTime
        // Casting cancels any running countdown; the receiver owns the queue.
        endOfPlayback.playbackResumed()
        await finishActiveSession(reason: "user_stopped")
        engine.pause()
        isCasting = true

        let defaults = NativePlayerDefaults.read()
        let castEngine = CastPlayerEngine(coordinator: castCoordinator, apiClient: apiClient)
        engine = castEngine
        cancellables.removeAll()
        bind()

        do {
            try await castEngine.load(PlayableItem(
                id: mediaFileID,
                // Never read by `CastPlayerEngine.load(_:)` -- the receiver
                // negotiates its own stream and never touches a
                // sender-local URL. `apiClient.baseURL` is just a
                // convenient, always-valid `URL` to satisfy this shared
                // struct's non-optional field.
                streamURL: apiClient.baseURL,
                title: activeTitle,
                startPositionSeconds: resumePosition,
                preferredAudioLanguageCode: defaults.audioLanguage,
                preferredSubtitleLanguageCode: defaults.subtitleMode == "off" ? nil : defaults.subtitleLanguage
            ))
            engine.play()
        } catch {
            errorMessage = error.localizedDescription
            isCasting = false
            engine = AVPlayerEngine()
            cancellables.removeAll()
            bind()
            Task { await self.play(mediaFileID: mediaFileID, title: self.activeTitle) }
        }
    }

    /// Fires when the Cast session ends for any reason (see
    /// `onSessionEnded`) -- swaps back to a local `AVPlayerEngine` and
    /// resumes from wherever the receiver left off (its own heartbeat
    /// should have kept server-side watch progress current throughout the
    /// cast).
    private func endCasting() {
        guard isCasting else { return }
        isCasting = false
        engine = AVPlayerEngine()
        cancellables.removeAll()
        bind()
        if let mediaFileID = activeMediaFileID {
            Task { await self.play(mediaFileID: mediaFileID, title: self.activeTitle) }
        }
    }
}
