import Foundation
import PlayarrKit
import XCTest

final class EndOfPlaybackMachineTests: XCTestCase {
    private func entry(_ n: Int) -> PlaybackQueueEntry {
        PlaybackQueueEntry(
            mediaFileID: UUID(uuidString: "00000000-0000-0000-0000-00000000000\(n)")!,
            title: "Item \(n)"
        )
    }

    func testEndsOnEndCardWhenQueueIsEmpty() {
        var machine = EndOfPlaybackMachine()
        XCTAssertEqual(machine.phase, .playing)
        machine.mediaEnded()
        XCTAssertEqual(machine.phase, .endCard)
        XCTAssertEqual(machine.tick(), .none)
        XCTAssertEqual(machine.playNow(), .none)
    }

    func testStartsCountdownWhenQueued() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)], countdownSeconds: 5)
        machine.mediaEnded()
        XCTAssertEqual(machine.phase, .upNext(remaining: 5))
        XCTAssertTrue(machine.isCountingDown)
    }

    func testCountdownTicksThenAutoplaysNextEntry() {
        var machine = EndOfPlaybackMachine(queue: [entry(1), entry(2)], countdownSeconds: 3)
        machine.mediaEnded()
        XCTAssertEqual(machine.tick(), .none)
        XCTAssertEqual(machine.phase, .upNext(remaining: 2))
        XCTAssertEqual(machine.tick(), .none)
        XCTAssertEqual(machine.phase, .upNext(remaining: 1))
        XCTAssertEqual(machine.tick(), .play(entry(1)))
        XCTAssertEqual(machine.phase, .playing)
        XCTAssertEqual(machine.queue, [entry(2)])
    }

    func testPlayNowSkipsCountdown() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)])
        machine.mediaEnded()
        XCTAssertEqual(machine.playNow(), .play(entry(1)))
        XCTAssertEqual(machine.phase, .playing)
        XCTAssertTrue(machine.queue.isEmpty)
    }

    func testCancelFallsBackToEndCardAndKeepsQueue() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)])
        machine.mediaEnded()
        machine.cancelCountdown()
        XCTAssertEqual(machine.phase, .endCard)
        XCTAssertEqual(machine.nextEntry, entry(1))
        XCTAssertEqual(machine.tick(), .none)
        // "Play next" remains available from the end card.
        XCTAssertEqual(machine.playNow(), .play(entry(1)))
    }

    func testReplayAndExit() {
        var machine = EndOfPlaybackMachine()
        XCTAssertEqual(machine.replay(), .none, "nothing to replay while playing")
        machine.mediaEnded()
        XCTAssertEqual(machine.replay(), .replay)
        XCTAssertEqual(machine.phase, .playing)
        machine.mediaEnded()
        XCTAssertEqual(machine.exit(), .exit)
    }

    func testPlaybackResumedHidesUIWithoutDroppingQueue() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)])
        machine.mediaEnded()
        machine.playbackResumed()
        XCTAssertEqual(machine.phase, .playing)
        XCTAssertEqual(machine.queue.count, 1)
    }

    func testMediaEndedIsIgnoredOutsidePlaying() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)], countdownSeconds: 4)
        machine.mediaEnded()
        _ = machine.tick()
        machine.mediaEnded()
        XCTAssertEqual(machine.phase, .upNext(remaining: 3))
    }

    func testImmediateAdvanceChainsWithoutCard() {
        var machine = EndOfPlaybackMachine(queue: [entry(1), entry(2)], advance: .immediate)
        XCTAssertEqual(machine.mediaEnded(), .play(entry(1)))
        XCTAssertEqual(machine.phase, .playing)
        XCTAssertEqual(machine.mediaEnded(), .play(entry(2)))
        // Queue exhausted: the ended card shows, with no countdown.
        XCTAssertEqual(machine.mediaEnded(), .none)
        XCTAssertEqual(machine.phase, .endCard)
    }

    func testCountdownDoesNotRunWhenAutoplayIsOff() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)], countdownSeconds: 3, autoplaysNext: false)
        machine.mediaEnded()
        XCTAssertEqual(machine.phase, .upNext(remaining: 3))
        XCTAssertEqual(machine.tick(), .none)
        XCTAssertEqual(machine.phase, .upNext(remaining: 3))
        XCTAssertEqual(machine.playNow(), .play(entry(1)))
    }

    func testCountdownSecondsClampedToAtLeastOne() {
        var machine = EndOfPlaybackMachine(queue: [entry(1)], countdownSeconds: 0)
        machine.mediaEnded()
        XCTAssertEqual(machine.phase, .upNext(remaining: 1))
    }
}

final class PlaybackQueueBuilderTests: XCTestCase {
    private func episode(_ number: Int32, season: UUID, file: Bool = true) -> EpisodeDetail {
        EpisodeDetail(
            episode: Episode(
                id: UUID(), seasonID: season, episodeNumber: number, title: "Ep \(number)",
                monitored: true, availability: .available
            ),
            mediaFileID: file ? UUID() : nil
        )
    }

    private func season(_ number: Int32, _ episodes: (UUID) -> [EpisodeDetail]) -> SeasonDetail {
        let id = UUID()
        return SeasonDetail(
            season: Season(id: id, seriesWorkID: UUID(), seasonNumber: number, monitored: true, availability: .available),
            episodes: episodes(id)
        )
    }

    func testEpisodesContinueIntoNextSeasonInSeriesOrder() {
        let s2 = season(2) { [self.episode(1, season: $0)] }
        let s1 = season(1) { [self.episode(1, season: $0), self.episode(2, season: $0), self.episode(3, season: $0, file: false)] }
        let queue = PlaybackQueueBuilder.episodes(after: s1.episodes[0].id, seriesTitle: "Show", seasons: [s2, s1])
        XCTAssertEqual(queue.map(\.title), ["Ep 2", "Ep 1"], "unavailable episode skipped, then season 2")
        XCTAssertEqual(queue.first?.subtitle, "Show · S1:E2")
        XCTAssertEqual(queue.last?.subtitle, "Show · S2:E1")
    }

    func testLastEpisodeHasNoNext() {
        let s1 = season(1) { [self.episode(1, season: $0)] }
        XCTAssertTrue(PlaybackQueueBuilder.episodes(after: s1.episodes[0].id, seriesTitle: "Show", seasons: [s1]).isEmpty)
        XCTAssertTrue(PlaybackQueueBuilder.episodes(after: UUID(), seriesTitle: "Show", seasons: [s1]).isEmpty)
    }

    func testTracksAfterSkipsUnavailable() {
        let album = UUID()
        func track(_ n: Int32, file: Bool) -> TrackDetail {
            TrackDetail(
                track: Track(id: UUID(), albumID: album, discNumber: 1, trackNumber: n, title: "T\(n)", availability: .available),
                mediaFileID: file ? UUID() : nil
            )
        }
        let tracks = [track(1, file: true), track(2, file: false), track(3, file: true)]
        let queue = PlaybackQueueBuilder.tracks(after: tracks[0].id, in: tracks, albumTitle: "Album")
        XCTAssertEqual(queue.map(\.title), ["T3"])
    }

    func testResumeNearEndRestartsFromZero() {
        XCTAssertEqual(PlaybackQueueBuilder.resumeMS(positionMS: 596_000, durationMS: 600_000), 0)
        XCTAssertEqual(PlaybackQueueBuilder.resumeMS(positionMS: 300_000, durationMS: 600_000), 300_000)
        XCTAssertEqual(PlaybackQueueBuilder.resumeMS(positionMS: 10, durationMS: 0), 10)
    }
}

@MainActor
final class EndOfPlaybackControllerTests: XCTestCase {
    func testTimerAutoplaysQueuedEntry() async throws {
        let next = PlaybackQueueEntry(mediaFileID: UUID(), title: "Next")
        let controller = EndOfPlaybackController(queue: [next], countdownSeconds: 2, tickInterval: .milliseconds(5))
        let played = expectation(description: "autoplay")
        controller.perform = { action in
            if action == .play(next) { played.fulfill() }
        }
        controller.mediaEnded()
        XCTAssertEqual(controller.phase, .upNext(remaining: 2))
        await fulfillment(of: [played], timeout: 2)
        XCTAssertEqual(controller.phase, .playing)
    }

    func testPausedTimerResumesFromSameSecond() async throws {
        let next = PlaybackQueueEntry(mediaFileID: UUID(), title: "Next")
        let controller = EndOfPlaybackController(queue: [next], countdownSeconds: 5, tickInterval: .milliseconds(5))
        controller.mediaEnded()
        controller.stopTimer()
        let paused = controller.phase
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertEqual(controller.phase, paused)
        controller.resumeTimer()
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertNotEqual(controller.phase, paused)
        controller.cancelCountdown()
    }

    func testImmediateAdvanceAutoplaysWithoutCard() async throws {
        let next = PlaybackQueueEntry(mediaFileID: UUID(), title: "Next")
        let controller = EndOfPlaybackController()
        controller.setQueue([next], advance: .immediate)
        var played: PlaybackQueueEntry?
        controller.perform = { if case .play(let entry) = $0 { played = entry } }
        controller.mediaEnded()
        XCTAssertEqual(played, next)
        XCTAssertEqual(controller.phase, .playing)
    }

    func testCancelStopsTimer() async throws {
        let next = PlaybackQueueEntry(mediaFileID: UUID(), title: "Next")
        let controller = EndOfPlaybackController(queue: [next], countdownSeconds: 2, tickInterval: .milliseconds(5))
        controller.perform = { _ in XCTFail("must not autoplay after cancel") }
        controller.mediaEnded()
        controller.cancelCountdown()
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertEqual(controller.phase, .endCard)
    }
}
