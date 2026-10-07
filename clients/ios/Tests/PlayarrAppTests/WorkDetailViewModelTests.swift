import AVFoundation
import Combine
import Foundation
import PlayarrKit
@testable import PlayarrApp
import XCTest

@MainActor
final class WorkDetailViewModelTests: XCTestCase {
    func testLoadPublishesFetchedDetail() async {
        let workID = UUID()
        let detail = WorkDetail(
            work: Work(
                id: workID,
                kind: .movie,
                title: "Test Film",
                sortTitle: "Test Film",
                addedAt: Date(timeIntervalSince1970: 1_700_000_000),
                monitored: true,
                availability: .available
            ),
            children: .movie,
            mediaFileID: UUID()
        )
        let viewModel = WorkDetailViewModel(
            apiClient: WorkDetailAPIClient(result: .success(detail)),
            workID: workID
        )

        await viewModel.load()

        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.detail?.work.title, "Test Film")
        XCTAssertEqual(viewModel.detail?.mediaFileID, detail.mediaFileID)
    }

    func testLoadPublishesAPIError() async {
        let viewModel = WorkDetailViewModel(
            apiClient: WorkDetailAPIClient(result: .failure(APIError.notFound(nil))),
            workID: UUID()
        )

        await viewModel.load()

        guard case .failed(let message) = viewModel.loadState else {
            return XCTFail("Expected the view model to report a failed load")
        }
        XCTAssertFalse(message.isEmpty)
        XCTAssertNil(viewModel.detail)
    }
}

@MainActor
final class HomeParityTests: XCTestCase {
    func testHomeRailsMatchWebOrderingAndDoNotRepeatTitles() {
        let movieA = makeWork(title: "Movie A", kind: .movie, addedAt: 6)
        let movieB = makeWork(title: "Movie B", kind: .movie, addedAt: 3)
        let seriesA = makeWork(title: "Series A", kind: .series, addedAt: 5)
        let seriesB = makeWork(title: "Series B", kind: .series, addedAt: 2)
        let siteA = makeWork(title: "Site A", kind: .site, addedAt: 4)
        let siteB = makeWork(title: "Site B", kind: .site, addedAt: 1)

        let rails = HomeViewModel.makeRails(
            movies: [movieA, movieB],
            series: [seriesA, seriesB],
            sites: [siteA, siteB],
            onDeck: [seriesA]
        )

        XCTAssertEqual(rails.map(\.title), ["On deck", "New movies", "New series", "New sites"])
        XCTAssertEqual(rails.first?.works, [seriesA])
        let displayedIDs = rails.flatMap(\.works).map(\.id)
        XCTAssertEqual(Set(displayedIDs).count, displayedIDs.count)
    }

    func testPhoneHomeUsesBoundedWebCarouselAndArtworkGeometry() {
        XCTAssertEqual(HomeLayout.backdropHeight(viewportHeight: 800, phone: true), 440, accuracy: 0.001)
        XCTAssertEqual(HomeLayout.carouselHeight(cardWidth: 184, phone: true), 155.5, accuracy: 0.001)
        XCTAssertEqual(HomeLayout.railWidth(viewportWidth: 402, phone: true), 402, accuracy: 0.001)
        XCTAssertEqual(HomeLayout.cardWidth(viewportWidth: 402, phone: true), 184.92, accuracy: 0.001)
        XCTAssertEqual(HomeLayout.phoneGutter, 16, accuracy: 0.001)
        XCTAssertEqual(HomeLayout.phoneTopOffset, 78, accuracy: 0.001)
        XCTAssertLessThanOrEqual(
            HomeLayout.phoneGutter + HomeLayout.cardWidth(viewportWidth: 402, phone: true) * 2 + 12,
            402
        )
        XCTAssertEqual(HomeLayout.backdropHeight(viewportHeight: 800, phone: false), 800, accuracy: 0.001)
    }

    func testLandscapePhoneUsesMobileWebLayout() {
        XCTAssertTrue(PlayarrLayout.isPhone(CGSize(width: 852, height: 393)))
        XCTAssertTrue(PlayarrLayout.isPhone(CGSize(width: 393, height: 852)))
        XCTAssertFalse(PlayarrLayout.isPhone(CGSize(width: 1_024, height: 768)))
    }

    private func makeWork(title: String, kind: WorkKind, addedAt: TimeInterval) -> Work {
        Work(
            id: UUID(),
            kind: kind,
            title: title,
            sortTitle: title,
            addedAt: Date(timeIntervalSince1970: addedAt),
            monitored: true,
            availability: .available
        )
    }
}

final class NativePlayerDefaultsTests: XCTestCase {
    func testReadsWebEquivalentPlaybackDefaults() {
        let suiteName = "NativePlayerDefaultsTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(
            NativePlayerDefaults.read(from: defaults),
            NativePlayerDefaults(
                qualityID: "original",
                subtitleMode: "off",
                subtitleLanguage: "en",
                audioLanguage: "en"
            )
        )

        defaults.set("h264-720p-4mbps", forKey: NativePlayerDefaults.qualityKey)
        defaults.set("always", forKey: NativePlayerDefaults.subtitleModeKey)
        defaults.set("ja", forKey: NativePlayerDefaults.subtitleLanguageKey)
        defaults.set("th", forKey: NativePlayerDefaults.audioLanguageKey)

        let configured = NativePlayerDefaults.read(from: defaults)
        XCTAssertEqual(configured.profile, "h264-720p-4mbps")
        XCTAssertEqual(configured.subtitleMode, "always")
        XCTAssertEqual(configured.subtitleLanguage, "ja")
        XCTAssertEqual(configured.audioLanguage, "th")
    }
}

@MainActor
final class PlayerViewModelLifecycleTests: XCTestCase {
    func testPlaybackResumesProgressAndStartsServerSession() async throws {
        let mediaFileID = UUID()
        let sessionID = UUID()
        let recorder = PlaybackEventRecorder()
        let apiClient = PlayerLifecycleAPIClient(
            mediaFileID: mediaFileID,
            sessionID: sessionID,
            recorder: recorder
        )
        let engine = PlayerEngineSpy(duration: 120)
        let downloadRepository = DownloadRepository(apiClient: apiClient)
        let viewModel = PlayerViewModel(engine: engine, apiClient: apiClient, downloadRepository: downloadRepository)

        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")

        XCTAssertEqual(viewModel.loadState, .playing)
        XCTAssertEqual(viewModel.duration, 120, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(engine.loadedItem).startPositionSeconds, 42, accuracy: 0.001)
        XCTAssertEqual(engine.loadedItem?.httpHeaders["Authorization"], "Bearer test")
        XCTAssertTrue(engine.didPlay)
        let events = await recorder.events
        XCTAssertEqual(events.map(\.kind), ["start"])
        XCTAssertEqual(events.first?.sessionID, sessionID)
    }

    private func makePlayer() -> (PlayerViewModel, PlayerEngineSpy, PlaybackEventRecorder, UUID) {
        let mediaFileID = UUID()
        let recorder = PlaybackEventRecorder()
        let apiClient = PlayerLifecycleAPIClient(mediaFileID: mediaFileID, sessionID: UUID(), recorder: recorder)
        let engine = PlayerEngineSpy(duration: 120)
        let viewModel = PlayerViewModel(engine: engine, apiClient: apiClient, downloadRepository: DownloadRepository(apiClient: apiClient))
        return (viewModel, engine, recorder, mediaFileID)
    }

    func testStopAndFlushDeliversProgressBeforeReturning() async {
        let (viewModel, engine, recorder, mediaFileID) = makePlayer()
        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")
        engine.timeSubject.send(55)
        try? await Task.sleep(for: .milliseconds(100))

        await viewModel.stopAndFlush()

        let writes = await recorder.progressWrites
        XCTAssertEqual(writes.last?.positionMS, 55_000)
        XCTAssertEqual(writes.last?.durationMS, 120_000)
        XCTAssertEqual(engine.state, .idle)
        let kinds = await recorder.events.map(\.kind)
        XCTAssertEqual(kinds.last, "stop")
    }

    func testStopNeverWritesZeroPositionWhenPlaybackNeverStarted() async {
        let (viewModel, _, recorder, mediaFileID) = makePlayer()
        await viewModel.play(mediaFileID: mediaFileID, title: "Test Film")

        await viewModel.stopAndFlush()

        let writes = await recorder.progressWrites
        XCTAssertTrue(writes.isEmpty)
    }

    func testProgressWritePolicy() {
        XCTAssertFalse(PlayerViewModel.shouldWriteProgress(positionMS: 0, completed: false))
        XCTAssertTrue(PlayerViewModel.shouldWriteProgress(positionMS: 1, completed: false))
        XCTAssertTrue(PlayerViewModel.shouldWriteProgress(positionMS: 0, completed: true))
    }
}

private struct WorkDetailAPIClient: PlayarrAPIClient {
    let result: Result<WorkDetail, Error>
    let baseURL = URL(string: "https://playarr.example")!

    func fetchHealth() async throws {}
    func fetchReadiness() async throws {}
    func fetchVersion() async throws -> VersionEnvelope {
        VersionEnvelope(serverVersion: "0.1.0", apiVersion: "v1")
    }
    func login(_ body: LoginRequest) async throws -> LoginResponse {
        throw APIError.unauthorized(nil)
    }
    func browseCatalog(
        kind: WorkKind?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> CatalogPage {
        CatalogPage(items: [])
    }
    func searchCatalog(query: String, limit: Int?) async throws -> [Work] { [] }
    func fetchWork(id: UUID) async throws -> WorkDetail { try result.get() }
    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse {
        throw APIError.notFound(nil)
    }
    func sendWebhook(instanceID: UUID, payload: Data) async throws {}
    func resolvedURL(forPath path: String) -> URL? {
        URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}

private actor PlaybackEventRecorder {
    struct Event: Sendable {
        let sessionID: UUID
        let kind: String
    }

    private(set) var events: [Event] = []
    private(set) var progressWrites: [UpdateWatchProgressRequest] = []

    func appendProgress(_ body: UpdateWatchProgressRequest) { progressWrites.append(body) }

    func append(sessionID: UUID, kind: String) {
        events.append(Event(sessionID: sessionID, kind: kind))
    }
}

private struct PlayerLifecycleAPIClient: PlayarrAPIClient {
    let mediaFileID: UUID
    let sessionID: UUID
    let recorder: PlaybackEventRecorder
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
        XCTAssertEqual(mediaFileID, self.mediaFileID)
        return PlaybackInfoResponse(
            mode: .direct,
            url: "/api/v1/playback/file",
            durationMS: 120_000,
            sessionID: sessionID
        )
    }
    func playbackRequestHeaders() async throws -> [String: String] { ["Authorization": "Bearer test"] }
    func getWatchProgress(mediaFileID: UUID) async throws -> WatchProgress {
        WatchProgress(
            mediaFileID: mediaFileID,
            workID: UUID(),
            positionMS: 42_000,
            durationMS: 120_000,
            state: .partWatched
        )
    }
    func updateWatchProgress(mediaFileID: UUID, body: UpdateWatchProgressRequest) async throws -> WatchProgress {
        await recorder.appendProgress(body)
        return WatchProgress(mediaFileID: mediaFileID, workID: UUID(), positionMS: body.positionMS, durationMS: body.durationMS, state: .partWatched)
    }
    func recordPlaybackEvent(sessionID: UUID, event: PlaybackEventRequest) async throws {
        await recorder.append(sessionID: sessionID, kind: event.kind)
    }
    func sendWebhook(instanceID: UUID, payload: Data) async throws {}
    func resolvedURL(forPath path: String) -> URL? { URL(string: path, relativeTo: baseURL)?.absoluteURL }
}

@MainActor
private final class PlayerEngineSpy: PlayerEngine {
    var state: PlayerPlaybackState = .idle
    var currentTime: Double = 0
    var duration: Double
    var rate: Float = 1
    var isMuted = false
    var loadedItem: PlayableItem?
    var didPlay = false

    let avPlayer: AVPlayer? = AVPlayer()
    var statePublisher: AnyPublisher<PlayerPlaybackState, Never> { Empty().eraseToAnyPublisher() }
    let timeSubject = CurrentValueSubject<Double, Never>(0)
    var currentTimePublisher: AnyPublisher<Double, Never> { timeSubject.eraseToAnyPublisher() }

    init(duration: Double) { self.duration = duration }
    func load(_ item: PlayableItem) async throws { loadedItem = item; state = .readyToPlay }
    func play() { didPlay = true; state = .playing }
    func pause() { state = .paused }
    func stop() { state = .idle }
    func seek(to seconds: Double) async { currentTime = seconds }
    func availableAudioTracks() async -> [PlayerTrack] { [] }
    func availableSubtitleTracks() async -> [PlayerTrack] { [] }
    func selectAudioTrack(id: String?) {}
    func selectSubtitleTrack(id: String?) {}
    func setPictureInPictureLayer(_ layer: AVPlayerLayer?) {}
}
