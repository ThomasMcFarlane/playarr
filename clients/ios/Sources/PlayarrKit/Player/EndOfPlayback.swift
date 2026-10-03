import Foundation
import Observation

/// One entry in a playback queue (the next episode of a season, the next
/// track of an album, or the next item of a playlist).
public struct PlaybackQueueEntry: Hashable, Identifiable, Sendable {
    public let mediaFileID: UUID
    public let title: String
    public let subtitle: String?

    public var id: UUID { mediaFileID }

    public init(mediaFileID: UUID, title: String, subtitle: String? = nil) {
        self.mediaFileID = mediaFileID
        self.title = title
        self.subtitle = subtitle
    }
}

/// Pure end-of-playback state machine, shared by the iOS and Apple TV
/// players.
///
/// When media finishes it moves to either `.endCard` (nothing queued:
/// Replay, Exit, suggestions) or `.upNext` (something queued: a countdown
/// with Play now, Cancel, Exit and suggestions). When the countdown reaches
/// zero the queued entry starts automatically. Cancelling the countdown
/// falls back to the end card for the finished item and is sticky: the
/// countdown never restarts without a new playback. See
/// `docs/architecture/end-of-playback.md`.
public struct EndOfPlaybackMachine: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        /// Media is playing (or loading); no end-of-playback UI is shown.
        case playing
        /// Finished with nothing queued, or the countdown was cancelled.
        case endCard
        /// Finished with a queued entry; `remaining` whole seconds left.
        case upNext(remaining: Int)
    }

    /// Side effect the host (view model) must perform after a transition.
    public enum Action: Equatable, Sendable {
        case none
        case play(PlaybackQueueEntry)
        case replay
        case exit
    }

    /// `END_SCREEN_COUNTDOWN_SECONDS` in the shared spec.
    public static let defaultCountdownSeconds = 10

    /// How a queued entry follows the finished one.
    public enum Advance: Equatable, Sendable {
        /// Video: show the up-next countdown.
        case countdown
        /// Audio queues: chain straight into the next track with no card.
        case immediate
    }

    public private(set) var phase: Phase = .playing
    /// Entries still to play after the current one, in order.
    public private(set) var queue: [PlaybackQueueEntry]
    public let countdownSeconds: Int
    public var advance: Advance
    /// "Autoplay next": when `false` the up-next card is shown but the
    /// countdown does not run. Neither Apple client has the preference yet,
    /// so it defaults to `true`.
    public var autoplaysNext: Bool

    public init(
        queue: [PlaybackQueueEntry] = [],
        countdownSeconds: Int = EndOfPlaybackMachine.defaultCountdownSeconds,
        advance: Advance = .countdown,
        autoplaysNext: Bool = true
    ) {
        self.queue = queue
        self.countdownSeconds = max(1, countdownSeconds)
        self.advance = advance
        self.autoplaysNext = autoplaysNext
    }

    public var nextEntry: PlaybackQueueEntry? { queue.first }

    /// `true` while the countdown overlay is showing.
    public var isCountingDown: Bool {
        if case .upNext = phase { return true }
        return false
    }

    public mutating func setQueue(_ entries: [PlaybackQueueEntry]) {
        queue = entries
    }

    /// The engine reported the end of the media.
    @discardableResult
    public mutating func mediaEnded() -> Action {
        guard phase == .playing else { return .none }
        if queue.isEmpty {
            phase = .endCard
        } else if advance == .immediate {
            return .play(queue.removeFirst())
        } else {
            phase = .upNext(remaining: countdownSeconds)
        }
        return .none
    }

    /// One second elapsed. Starts the next entry when the countdown ends.
    public mutating func tick() -> Action {
        guard case .upNext(let remaining) = phase, autoplaysNext else { return .none }
        if remaining <= 1 { return playNow() }
        phase = .upNext(remaining: remaining - 1)
        return .none
    }

    /// "Play now" / "Play next": start the queued entry immediately.
    public mutating func playNow() -> Action {
        guard !queue.isEmpty, phase != .playing else { return .none }
        let entry = queue.removeFirst()
        phase = .playing
        return .play(entry)
    }

    /// "Cancel": stop the countdown and fall back to the end card.
    public mutating func cancelCountdown() {
        guard isCountingDown else { return }
        phase = .endCard
    }

    /// "Replay": restart the finished media from the beginning.
    public mutating func replay() -> Action {
        guard phase != .playing else { return .none }
        phase = .playing
        return .replay
    }

    /// "Exit": leave the player.
    public mutating func exit() -> Action {
        phase = .playing
        return .exit
    }

    /// Playback resumed (user seeked back, or a new item loaded): hide the
    /// end-of-playback UI without touching the queue.
    public mutating func playbackResumed() {
        phase = .playing
    }
}

/// Drives `EndOfPlaybackMachine` with a one-second countdown timer and
/// exposes it to SwiftUI. The host supplies `perform` to carry out actions.
@MainActor
@Observable
public final class EndOfPlaybackController {
    public private(set) var machine: EndOfPlaybackMachine

    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private let tickInterval: Duration
    @ObservationIgnored public var perform: @MainActor (EndOfPlaybackMachine.Action) -> Void = { _ in }

    public init(
        queue: [PlaybackQueueEntry] = [],
        countdownSeconds: Int = EndOfPlaybackMachine.defaultCountdownSeconds,
        tickInterval: Duration = .seconds(1)
    ) {
        machine = EndOfPlaybackMachine(queue: queue, countdownSeconds: countdownSeconds)
        self.tickInterval = tickInterval
    }

    public var phase: EndOfPlaybackMachine.Phase { machine.phase }
    public var nextEntry: PlaybackQueueEntry? { machine.nextEntry }
    public var isCountingDown: Bool { machine.isCountingDown }

    public func setQueue(_ entries: [PlaybackQueueEntry], advance: EndOfPlaybackMachine.Advance = .countdown) {
        machine.setQueue(entries)
        machine.advance = advance
    }

    public func mediaEnded() {
        let action = machine.mediaEnded()
        if machine.isCountingDown { resumeTimer() }
        apply(action)
    }

    /// Resumes a countdown paused by `stopTimer()` (app returned to the
    /// foreground); continues from the current second.
    public func resumeTimer() {
        guard machine.isCountingDown, machine.autoplaysNext, timer == nil else { return }
        startTimer()
    }

    public func playbackResumed() {
        stopTimer()
        machine.playbackResumed()
    }

    public func playNow() { apply(machine.playNow()) }
    public func replay() { apply(machine.replay()) }
    public func exit() { apply(machine.exit()) }

    public func cancelCountdown() {
        stopTimer()
        machine.cancelCountdown()
    }

    /// Pauses the timer without changing state (app backgrounded, view
    /// disappearing). `resumeTimer()` continues from the same second.
    public func stopTimer() {
        timer?.cancel()
        timer = nil
    }

    private func startTimer() {
        stopTimer()
        let interval = tickInterval
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard !Task.isCancelled, let self else { return }
                self.tickOnce()
            }
        }
    }

    private func tickOnce() {
        apply(machine.tick())
        if !machine.isCountingDown { stopTimer() }
    }

    private func apply(_ action: EndOfPlaybackMachine.Action) {
        if !machine.isCountingDown { stopTimer() }
        if action != .none { perform(action) }
    }
}

/// Builds queues from detail payloads so both clients resolve "what is next"
/// identically (section 3 of the spec).
public enum PlaybackQueueBuilder {
    public static func episodeSubtitle(series: String, season: Int32, episode: Int32) -> String {
        "\(series) · S\(season):E\(episode)"
    }

    /// Playable episodes after `episodeID` in series order: the rest of its
    /// season, then every following season. Entries without a media file are
    /// skipped.
    public static func episodes(after episodeID: UUID, seriesTitle: String, seasons: [SeasonDetail]) -> [PlaybackQueueEntry] {
        let ordered = seasons
            .sorted { $0.season.seasonNumber < $1.season.seasonNumber }
            .flatMap { season in
                season.episodes
                    .sorted { $0.episode.episodeNumber < $1.episode.episodeNumber }
                    .map { (season.season.seasonNumber, $0) }
            }
        guard let index = ordered.firstIndex(where: { $0.1.id == episodeID }) else { return [] }
        return ordered.dropFirst(index + 1).compactMap { seasonNumber, detail in
            detail.mediaFileID.map {
                PlaybackQueueEntry(
                    mediaFileID: $0,
                    title: detail.episode.title ?? "Episode \(detail.episode.episodeNumber)",
                    subtitle: episodeSubtitle(series: seriesTitle, season: seasonNumber, episode: detail.episode.episodeNumber)
                )
            }
        }
    }

    /// Playable tracks after `trackID` within one album's list.
    public static func tracks(after trackID: UUID, in tracks: [TrackDetail], albumTitle: String) -> [PlaybackQueueEntry] {
        guard let index = tracks.firstIndex(where: { $0.id == trackID }) else { return [] }
        return tracks.dropFirst(index + 1).compactMap { detail in
            detail.mediaFileID.map { PlaybackQueueEntry(mediaFileID: $0, title: detail.track.title, subtitle: albumTitle) }
        }
    }

    /// Items within this many milliseconds of the end count as watched, so
    /// starting them replays from the beginning.
    public static let watchedTailMS: Int64 = 5_000

    /// Resume position for an item with saved progress.
    public static func resumeMS(positionMS: Int64, durationMS: Int64) -> Int64 {
        durationMS > 0 && positionMS >= durationMS - watchedTailMS ? 0 : max(0, positionMS)
    }
}
