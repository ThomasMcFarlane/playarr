import AVFoundation
import Combine
import Foundation
import Observation
import PlayarrKit
import UIKit

@MainActor
@Observable
final class TVHomeViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var works: [Work] = []
    /// Server-computed Home shelves (same source as the web Home).
    private(set) var rails: [HomeRail] = []
    /// Web `loadOnDeck`: part-watched titles, most recent first (at most 10), with their progress (0...1).
    private(set) var onDeck: [Work] = []
    private(set) var progress: [UUID: Double] = [:]
    private let apiClient: PlayarrAPIClient

    init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    /// shortcut: series that need a Resume choice (stacked resume plans) are not added; add them with the plans API.
    private func loadOnDeck() async {
        guard let rows = try? await apiClient.listWatchProgress() else { return }
        var seen = Set<UUID>()
        let recent = rows.filter { $0.state == .partWatched }
            .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
            .filter { seen.insert($0.workID).inserted }
            .prefix(10)
        progress = Dictionary(recent.map { ($0.workID, $0.durationMS > 0 ? Double($0.positionMS) / Double($0.durationMS) : 0) },
                              uniquingKeysWith: { first, _ in first })
        let api = apiClient
        let works = await withTaskGroup(of: (Int, Work?).self) { group in
            for (index, row) in recent.enumerated() {
                group.addTask { (index, try? await api.fetchWork(id: row.workID).work) }
            }
            var found: [(Int, Work)] = []
            for await (index, work) in group { if let work { found.append((index, work)) } }
            return found.sorted { $0.0 < $1.0 }.map(\.1)
        }
        onDeck = works
    }

    func load() async {
        if state != .loaded { state = .loading } // a reload keeps the rails on screen (no blank flash)
        // The web Home builds every rail from the server's shelves: when they load, nothing else is needed.
        if TVParityLaunch.requestedScreen == nil, let fetched = try? await apiClient.fetchHomeRails(), !fetched.isEmpty {
            rails = fetched
            state = .loaded
            await loadOnDeck()
            return
        }
        // Offline fixture catalogue only when no access token was injected
        // (ATS/tunnel unavailable). Prefer live API when signed in.
        if TVParityLaunch.requestedScreen != nil,
           !ProcessInfo.processInfo.arguments.contains("-PlayarrAccessToken") {
            works = TVParityFixtures.sampleWorks()
            state = .loaded
            return
        }
        do {
            // SPA Home pulls a mixed recent list plus kind-scoped rails.
            // Parallel browse keeps “New movies” populated even when the
            // mixed page is series-heavy.
            async let mixed = apiClient.browseCatalog(
                kind: nil, genre: nil, tag: nil, sort: "recent", limit: 40, offset: 0
            )
            async let movies = apiClient.browseCatalog(
                kind: .movie, genre: nil, tag: nil, sort: "recent", limit: 24, offset: 0
            )
            async let series = apiClient.browseCatalog(
                kind: .series, genre: nil, tag: nil, sort: "recent", limit: 24, offset: 0
            )
            let mixedItems = try await mixed.items
            let movieItems = try await movies.items
            let seriesItems = try await series.items
            // Prefer series, then movies, then remaining mixed for rail feeds.
            works = seriesItems + movieItems + mixedItems.filter {
                $0.kind != .series && $0.kind != .movie
            }
            // De-dupe while preserving order.
            var seen = Set<UUID>()
            works = works.filter { seen.insert($0.id).inserted }
            state = .loaded
        } catch {
            // Parity suite must still paint production rails when the tunnel
            // token expires or the API is in full-account mode.
            if TVParityLaunch.requestedScreen != nil {
                works = TVParityFixtures.sampleWorks()
                state = .loaded
                return
            }
            if let error = error as? APIError {
                state = .failed(error.displayMessage)
            } else {
                state = .failed(error.localizedDescription)
            }
        }
    }
}

@MainActor
@Observable
final class TVSearchViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    var query = ""
    private(set) var state: State = .idle
    private(set) var results: [Work] = []
    private let apiClient: PlayarrAPIClient

    init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            state = .idle
            return
        }

        state = .loading
        do {
            results = try await apiClient.searchCatalog(query: trimmed, limit: 60) // the web asks for 60
            state = .loaded
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

@MainActor
@Observable
final class TVWorkDetailViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var detail: WorkDetail?
    /// Titles similar to this one (`/similar`), shown under a movie's chapters.
    private(set) var similar: [Work] = []
    /// How long a series usually takes to appear after release.
    private(set) var availabilityLag: AvailabilityLag?
    /// The episode the series' resume plan points at (the page opens focused on it).
    private(set) var resumeTarget: SeriesResumeTarget?
    private let workID: UUID
    private let seedWork: Work?
    private let apiClient: PlayarrAPIClient

    init(workID: UUID, apiClient: PlayarrAPIClient, seedWork: Work? = nil) {
        self.workID = workID
        self.seedWork = seedWork
        self.apiClient = apiClient
    }

    func load() async {
        state = .loading
        // Parity detail screens use deterministic fixtures (UUIDs are not on
        // the live server). Prefer seed work so production SwiftUI still
        // paints a real detail layout without a network round-trip.
        if TVParityLaunch.requestedScreen != nil, let seedWork {
            let children: WorkChildren
            switch seedWork.kind {
            case .movie: children = .movie
            case .series: children = .series([])
            case .artist: children = .artist([])
            case .author: children = .author([])
            default: children = .movie
            }
            detail = WorkDetail(
                work: seedWork,
                children: children,
                mediaFileID: seedWork.kind == .movie
                    ? UUID(uuidString: "00000000-0000-4000-8000-000000000099")
                    : nil
            )
            state = .loaded
            return
        }
        do {
            let loaded = try await apiClient.fetchWork(id: workID)
            detail = loaded
            state = .loaded
            similar = (try? await apiClient.fetchSimilarWorks(id: workID, limit: 12)) ?? []
            if loaded.work.kind == .series {
                availabilityLag = (try? await apiClient.fetchAvailabilityLag(id: workID)) ?? nil
                resumeTarget = (try? await apiClient.fetchSeriesResumeTarget(seriesID: workID)) ?? nil
            }
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

@MainActor
@Observable
final class TVPlayerViewModel {
    enum State: Equatable {
        case idle
        case negotiating
        case ready
        case failed(String)
    }

    private(set) var state: State = .idle
    private(set) var playbackMode: PlaybackMode?
    private(set) var currentTitle = ""
    private(set) var currentSubtitle: String?
    /// Playback position, duration and play state, for the chrome.
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var isPlaying = false
    private(set) var qualityLabel = TVParityLaunch.livePlayer != nil ? "Original \u{00B7} 0.3 Mbps" : "Original"
    private(set) var selectedQualityID = "original"
    @ObservationIgnored private var positionObservation: AnyCancellable?
    let engine: PlayerEngine
    /// End card / up-next countdown; see `EndOfPlaybackMachine`.
    let endOfPlayback = EndOfPlaybackController()
    /// Invoked when the viewer chooses Exit on the end card or countdown.
    @ObservationIgnored var onExit: () -> Void = {}
    @ObservationIgnored private var stateObservation: AnyCancellable?
    @ObservationIgnored private var lastMediaFileID: UUID?
    /// Media file whose progress is being reported; nil once flushed on exit.
    @ObservationIgnored private var activeMediaFileID: UUID?
    @ObservationIgnored private var heartbeatTask: Task<Void, Never>?

    // `PlayerEngine.avPlayer` was relaxed to `AVPlayer?` for the iOS Cast
    // sender build (a Cast-backed engine has no local `AVPlayer` at all) --
    // this tvOS conformer never uses a Cast-backed engine (only
    // `AVPlayerEngine` via this type's own `init` default below), but the
    // protocol-typed access here still has to widen to match. Cannot be
    // compiled/verified from this environment; see the iOS build's report
    // for the equivalent, verified-elsewhere reasoning.
    var player: AVPlayer? { engine.avPlayer }

    private let apiClient: PlayarrAPIClient

    init(apiClient: PlayarrAPIClient, engine: PlayerEngine = AVPlayerEngine()) {
        self.apiClient = apiClient
        self.engine = engine
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
        stateObservation = engine.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] playback in
                Task { @MainActor in self?.handle(playback) }
            }
        positionObservation = engine.currentTimePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] seconds in
                Task { @MainActor in
                    guard let self else { return }
                    self.position = seconds
                    // A transcode playlist grows while it plays: keep the server's duration until the stream knows its own.
                    let reported = self.engine.duration
                    if self.duration <= 0, reported.isFinite, reported > 0 { self.duration = reported }
                }
            }
    }

    private func handle(_ playback: PlayerPlaybackState) {
        isPlaying = playback == .playing
        switch playback {
        case .ended:
            endOfPlayback.mediaEnded()
            heartbeatTask?.cancel()
            heartbeatTask = nil
            flushProgress(completed: true)
        case .playing: endOfPlayback.playbackResumed()
        default: break
        }
    }

    /// Polls the stream URL until it answers (at most about 20 s); any non-404 answer ends the wait.
    private static func waitForPlaylist(_ url: URL, headers: [String: String]) async {
        var request = URLRequest(url: url)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        for _ in 0..<40 {
            guard let (_, response) = try? await URLSession.shared.data(for: request),
                  (response as? HTTPURLResponse)?.statusCode == 404 else { return }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }

    /// Restarts the finished item from the start (end card "Replay").
    func replay() async {
        guard let mediaFileID = lastMediaFileID else { return }
        await play(mediaFileID: mediaFileID, title: currentTitle, startFromBeginning: true)
    }

    func play(mediaFileID: UUID, title: String, startFromBeginning: Bool = false) async {
        endOfPlayback.playbackResumed()
        currentTitle = title
        lastMediaFileID = mediaFileID
        state = .negotiating
        do {
            // Resume from the server's saved position (web: getWatchProgress).
            let saved = startFromBeginning ? nil : try? await apiClient.getWatchProgress(mediaFileID: mediaFileID)
            let info = try await apiClient.playbackInfo(
                mediaFileID: mediaFileID,
                containers: ["mp4", "mov", "m4v"], // AVPlayer cannot open Matroska: the server remuxes it
                videoCodecs: ["h264", "hevc"],
                audioCodecs: ["aac", "ac3", "eac3"],
                maxBitrateBps: 40_000_000,
                profile: "apple-tv"
            )
            guard let streamURL = apiClient.resolvedURL(forPath: info.url) else {
                throw APIError.invalidResponse
            }

            playbackMode = info.mode
            applyQuality(info)
            let resumeSeconds = saved.map {
                Double(PlaybackQueueBuilder.resumeMS(positionMS: $0.positionMS, durationMS: $0.durationMS)) / 1_000
            } ?? 0
            // The stream needs the session like every API call (AVPlayer does not send it on its own).
            let headers = try await apiClient.playbackRequestHeaders()
            // A transcode session writes its playlist a moment after the server answers (404 until then); AVPlayer
            // gives up on the first 404, so wait for it like the web player does.
            await Self.waitForPlaylist(streamURL, headers: headers)
            try await engine.load(PlayableItem(id: mediaFileID, streamURL: streamURL, title: title,
                                               startPositionSeconds: resumeSeconds, httpHeaders: headers))
            // `-PlayarrMuted` (shared test simulators, e.g. the device wall Mac): the player never makes a sound.
            if ProcessInfo.processInfo.arguments.contains("-PlayarrMuted") {
                engine.isMuted = true
                NSLog("PlayarrTV: player muted by -PlayarrMuted (isMuted=%@)", engine.isMuted ? "true" : "false")
            }
            engine.play()
            state = .ready
            activeMediaFileID = mediaFileID
            startHeartbeat()
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func setSubtitle(_ subtitle: String?) { currentSubtitle = subtitle }

    func togglePlay() {
        if isPlaying {
            engine.pause()
            flushProgress(completed: false)
        } else {
            engine.play()
        }
    }

    /// A zero position without completion means playback never started (or a
    /// stalled resume); writing it would wipe the server's resume point.
    nonisolated static func shouldWriteProgress(positionMS: Int64, completed: Bool) -> Bool {
        completed || positionMS > 0
    }

    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, let self else { return }
                if self.isPlaying { await self.writeProgress(completed: false) }
            }
        }
    }

    /// The progress to report now, captured synchronously so a later
    /// teardown cannot change it. Nil when nothing should be written.
    private func progressSnapshot(completed: Bool) -> (UUID, UpdateWatchProgressRequest)? {
        guard let mediaFileID = activeMediaFileID else { return nil }
        let durationMS = duration.isFinite ? Int64(max(0, duration) * 1_000) : 0
        let positionMS = completed ? durationMS : (position.isFinite ? Int64(max(0, position) * 1_000) : 0)
        guard durationMS > 0, Self.shouldWriteProgress(positionMS: positionMS, completed: completed) else { return nil }
        return (mediaFileID, UpdateWatchProgressRequest(
            positionMS: positionMS,
            durationMS: durationMS,
            completed: completed || positionMS >= durationMS - 30_000
        ))
    }

    private func writeProgress(completed: Bool) async {
        guard let (mediaFileID, body) = progressSnapshot(completed: completed) else { return }
        _ = try? await apiClient.updateWatchProgress(mediaFileID: mediaFileID, body: body)
    }

    /// Writes the position under a UIKit background task so it survives
    /// suspension and view teardown. The returned task completes once the
    /// server has the write.
    @discardableResult
    private func flushProgress(completed: Bool) -> Task<Void, Never> {
        let snapshot = progressSnapshot(completed: completed)
        let client = apiClient
        let app = UIApplication.shared
        var taskID = UIBackgroundTaskIdentifier.invalid
        taskID = app.beginBackgroundTask(withName: "playarr.progress-flush") {
            app.endBackgroundTask(taskID)
            taskID = .invalid
        }
        return Task { @MainActor in
            if let (mediaFileID, body) = snapshot {
                _ = try? await client.updateWatchProgress(mediaFileID: mediaFileID, body: body)
            }
            if taskID != .invalid { app.endBackgroundTask(taskID) }
        }
    }

    /// App left the foreground: pause and flush.
    func didEnterBackground() {
        if isPlaying { engine.pause() }
        flushProgress(completed: false)
    }

    /// Stops and returns only once the progress write has been delivered.
    func stopAndFlush() async { await stop().value }

    func seek(by seconds: Double) {
        let target = min(max(0, position + seconds), duration > 0 ? duration : position + seconds)
        Task { await engine.seek(to: target) }
    }

    /// The quality label the controls show (web `qualityDisplayLabel`): "Original · 0.3 Mbps".
    private func applyQuality(_ info: PlaybackInfoResponse) {
        selectedQualityID = info.selectedQualityID
        let option = info.qualityOptions.first { $0.id == info.selectedQualityID }
        if option?.id == "original" || option == nil {
            if let bps = option?.videoBitrateBPS, bps > 0, Double(bps) / 1_000_000 >= 0.05 {
                qualityLabel = String(format: "Original \u{00B7} %.1f Mbps", Double(bps) / 1_000_000)
            } else {
                qualityLabel = "Original"
            }
        } else if let option {
            qualityLabel = option.label
        }
        duration = Double(info.durationMS) / 1000
    }

    /// Reads playback info only (parity route): no stream is started.
    func loadInfo(mediaFileID: UUID) async {
        if let info = try? await apiClient.playbackInfo(
            mediaFileID: mediaFileID,
            containers: ["mp4", "mov", "m4v", "mkv"], // parity route: info only, never played
            videoCodecs: ["h264", "hevc"],
            audioCodecs: ["aac", "ac3", "eac3"],
            maxBitrateBps: 40_000_000,
            profile: "apple-tv"
        ) {
            applyQuality(info)
        }
    }

    @discardableResult
    func stop() -> Task<Void, Never> {
        // Leaving the screen (including to a suggestion) is explicit: the
        // countdown stops and does not restart.
        endOfPlayback.cancelCountdown()
        endOfPlayback.stopTimer()
        heartbeatTask?.cancel()
        heartbeatTask = nil
        // The snapshot is taken before the engine resets the position.
        let flush = flushProgress(completed: false)
        engine.stop()
        activeMediaFileID = nil
        state = .idle
        return flush
    }
}
