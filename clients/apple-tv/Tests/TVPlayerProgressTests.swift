import AVFoundation
import Combine
import Foundation
import PlayarrKit
import XCTest
@testable import PlayarrTV

@MainActor
final class TVPlayerProgressTests: XCTestCase {
    func testPlayResumesFromServerPosition() async throws {
        let (viewModel, engine, _, mediaFileID) = makePlayer()

        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")

        XCTAssertEqual(try XCTUnwrap(engine.loadedItem).startPositionSeconds, 42, accuracy: 0.001)
    }

    func testStartOverIgnoresServerPosition() async throws {
        let (viewModel, engine, _, mediaFileID) = makePlayer()
        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")

        await viewModel.replay()

        XCTAssertEqual(try XCTUnwrap(engine.loadedItem).startPositionSeconds, 0, accuracy: 0.001)
    }

    func testStopAndFlushDeliversPositionBeforeReturning() async {
        let (viewModel, engine, recorder, mediaFileID) = makePlayer()
        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")
        engine.timeSubject.send(55)
        try? await Task.sleep(for: .milliseconds(150))

        await viewModel.stopAndFlush()

        let writes = await recorder.progressWrites
        XCTAssertEqual(writes.last?.positionMS, 55_000)
        XCTAssertEqual(writes.last?.durationMS, 120_000)
        XCTAssertEqual(engine.state, .idle)
    }

    func testNeverWritesZeroWhenPlaybackNeverStarted() async {
        let (viewModel, _, recorder, mediaFileID) = makePlayer()
        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")

        await viewModel.stopAndFlush()

        let writes = await recorder.progressWrites
        XCTAssertTrue(writes.isEmpty)
    }

    func testProgressWritePolicy() {
        XCTAssertFalse(TVPlayerViewModel.shouldWriteProgress(positionMS: 0, completed: false))
        XCTAssertTrue(TVPlayerViewModel.shouldWriteProgress(positionMS: 1, completed: false))
        XCTAssertTrue(TVPlayerViewModel.shouldWriteProgress(positionMS: 0, completed: true))
    }

    private func makePlayer() -> (TVPlayerViewModel, TVEngineSpy, ProgressRecorder, UUID) {
        let mediaFileID = UUID()
        let recorder = ProgressRecorder()
        let client = ProgressAPIClient(mediaFileID: mediaFileID, recorder: recorder)
        let engine = TVEngineSpy(duration: 120)
        return (TVPlayerViewModel(apiClient: client, engine: engine), engine, recorder, mediaFileID)
    }
}

private actor ProgressRecorder {
    private(set) var progressWrites: [UpdateWatchProgressRequest] = []
    func append(_ body: UpdateWatchProgressRequest) { progressWrites.append(body) }
}

private struct ProgressAPIClient: PlayarrAPIClient {
    let mediaFileID: UUID
    let recorder: ProgressRecorder
    let baseURL = URL(string: "https://playarr.example")!

    func fetchHealth() async throws {}
    func fetchReadiness() async throws {}
    func fetchVersion() async throws -> VersionEnvelope {
        VersionEnvelope(serverVersion: "0.1.0", apiVersion: "v1")
    }
    func login(_ body: LoginRequest) async throws -> LoginResponse { throw APIError.unauthorized(nil) }
    func browseCatalog(kind: WorkKind?, genre: String?, tag: String?, sort: String?, limit: Int?, offset: Int?) async throws -> CatalogPage {
        CatalogPage(items: [])
    }
    func searchCatalog(query: String, limit: Int?) async throws -> [Work] { [] }
    func fetchWork(id: UUID) async throws -> WorkDetail { throw APIError.notFound(nil) }
    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse {
        PlaybackInfoResponse(mode: .direct, url: "/api/v1/playback/file", durationMS: 120_000, sessionID: nil)
    }
    func getWatchProgress(mediaFileID: UUID) async throws -> WatchProgress {
        WatchProgress(mediaFileID: mediaFileID, workID: UUID(), positionMS: 42_000, durationMS: 120_000, state: .partWatched)
    }
    func updateWatchProgress(mediaFileID: UUID, body: UpdateWatchProgressRequest) async throws -> WatchProgress {
        await recorder.append(body)
        return WatchProgress(mediaFileID: mediaFileID, workID: UUID(), positionMS: body.positionMS, durationMS: body.durationMS, state: .partWatched)
    }
    func sendWebhook(instanceID: UUID, payload: Data) async throws {}
    func resolvedURL(forPath path: String) -> URL? { URL(string: path, relativeTo: baseURL)?.absoluteURL }
}

@MainActor
private final class TVEngineSpy: PlayerEngine {
    var state: PlayerPlaybackState = .idle
    var currentTime: Double = 0
    var duration: Double
    var rate: Float = 1
    var isMuted = false
    var loadedItem: PlayableItem?

    let avPlayer: AVPlayer? = AVPlayer()
    let timeSubject = CurrentValueSubject<Double, Never>(0)
    var statePublisher: AnyPublisher<PlayerPlaybackState, Never> { Empty().eraseToAnyPublisher() }
    var currentTimePublisher: AnyPublisher<Double, Never> { timeSubject.eraseToAnyPublisher() }

    init(duration: Double) { self.duration = duration }
    func load(_ item: PlayableItem) async throws { loadedItem = item; state = .readyToPlay }
    func play() { state = .playing }
    func pause() { state = .paused }
    func stop() { state = .idle }
    func seek(to seconds: Double) async { currentTime = seconds }
    func availableAudioTracks() async -> [PlayerTrack] { [] }
    func availableSubtitleTracks() async -> [PlayerTrack] { [] }
    func selectAudioTrack(id: String?) {}
    func selectSubtitleTrack(id: String?) {}
    func setPictureInPictureLayer(_ layer: AVPlayerLayer?) {}
}
