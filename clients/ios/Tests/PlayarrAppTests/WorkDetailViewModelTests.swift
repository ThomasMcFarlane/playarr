import AVFoundation
import Combine
import Foundation
import PlayarrKit
@testable import PlayarrApp
import XCTest

@MainActor
final class WorkDetailViewModelTests: XCTestCase {
    func testNativePlayerCapabilitiesIncludeFolderAudio() {
        XCTAssertTrue(PlayerViewModel.supportedContainers.contains("mp3"))
        XCTAssertTrue(PlayerViewModel.supportedContainers.contains("m4a"))
        XCTAssertTrue(PlayerViewModel.supportedContainers.contains("flac"))
        XCTAssertTrue(PlayerViewModel.supportedAudioCodecs.contains("mp3"))
        XCTAssertTrue(PlayerViewModel.supportedAudioCodecs.contains("flac"))
    }

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
final class FolderBrowserViewModelTests: XCTestCase {
    func testOlderSameRootBrowseCannotReplaceNewerDirectory() async {
        let root = makeFolderRoot()
        let requests = FolderBrowseRequestController()
        let viewModel = FolderBrowserViewModel(
            apiClient: FolderBrowserAPIClient(root: root, requests: requests)
        )

        let initialLoad = Task { await viewModel.loadRoots(kind: .movie) }
        guard await waitForFolderRequestCount(1, requests: requests) else { return }
        let completedInitial = await requests.complete(
            path: nil,
            offset: 0,
            with: makeFolderPage(root: root, path: "", names: ["Initial"])
        )
        XCTAssertTrue(completedInitial)
        await initialLoad.value

        let olderBrowse = Task { await viewModel.open(path: "Older") }
        guard await waitForFolderRequestCount(2, requests: requests) else { return }
        let newerBrowse = Task { await viewModel.open(path: "Newer") }
        guard await waitForFolderRequestCount(3, requests: requests) else { return }

        let completedNewer = await requests.complete(
            path: "Newer",
            offset: 0,
            with: makeFolderPage(root: root, path: "Newer", names: ["Current"])
        )
        XCTAssertTrue(completedNewer)
        await newerBrowse.value
        XCTAssertEqual(viewModel.browseResponse?.path, "Newer")
        XCTAssertEqual(viewModel.entries.map(\.name), ["Current"])

        let completedOlder = await requests.complete(
            path: "Older",
            offset: 0,
            with: makeFolderPage(root: root, path: "Older", names: ["Stale"])
        )
        XCTAssertTrue(completedOlder)
        await olderBrowse.value

        XCTAssertEqual(viewModel.browseResponse?.path, "Newer")
        XCTAssertEqual(viewModel.entries.map(\.name), ["Current"])
        XCTAssertEqual(viewModel.loadState, .loaded)
    }

    func testStalePaginationCannotAppendIntoNewDirectory() async {
        let root = makeFolderRoot()
        let requests = FolderBrowseRequestController()
        let viewModel = FolderBrowserViewModel(
            apiClient: FolderBrowserAPIClient(root: root, requests: requests)
        )

        let initialLoad = Task { await viewModel.loadRoots(kind: .movie) }
        guard await waitForFolderRequestCount(1, requests: requests) else { return }
        let completedInitial = await requests.complete(
            path: nil,
            offset: 0,
            with: makeFolderPage(
                root: root,
                path: "",
                names: ["First"],
                total: 2
            )
        )
        XCTAssertTrue(completedInitial)
        await initialLoad.value
        XCTAssertTrue(viewModel.canLoadMore)

        let stalePagination = Task { await viewModel.loadMore() }
        guard await waitForFolderRequestCount(2, requests: requests) else { return }
        let newerBrowse = Task { await viewModel.open(path: "Subfolder") }
        guard await waitForFolderRequestCount(3, requests: requests) else { return }

        let completedNewer = await requests.complete(
            path: "Subfolder",
            offset: 0,
            with: makeFolderPage(root: root, path: "Subfolder", names: ["Fresh"])
        )
        XCTAssertTrue(completedNewer)
        await newerBrowse.value

        let completedPagination = await requests.complete(
            path: nil,
            offset: 1,
            with: makeFolderPage(
                root: root,
                path: "",
                names: ["Stale"],
                total: 2,
                offset: 1
            )
        )
        XCTAssertTrue(completedPagination)
        await stalePagination.value

        XCTAssertEqual(viewModel.browseResponse?.path, "Subfolder")
        XCTAssertEqual(viewModel.entries.map(\.name), ["Fresh"])
        XCTAssertFalse(viewModel.isLoadingMore)
        XCTAssertFalse(viewModel.canLoadMore)
    }

    func testRetryKeepsFailedNestedDirectoryPath() async {
        let root = makeFolderRoot()
        let requests = FolderBrowseRequestController()
        let viewModel = FolderBrowserViewModel(
            apiClient: FolderBrowserAPIClient(root: root, requests: requests)
        )

        let initialLoad = Task { await viewModel.loadRoots(kind: .movie) }
        guard await waitForFolderRequestCount(1, requests: requests) else { return }
        await requests.completeNext(
            with: makeFolderPage(root: root, path: "", names: ["Nested"])
        )
        await initialLoad.value

        let failedBrowse = Task { await viewModel.open(path: "Nested") }
        guard await waitForFolderRequestCount(2, requests: requests) else { return }
        await requests.failNext(with: APIError.notFound(nil))
        await failedBrowse.value

        guard case .failed = viewModel.loadState else {
            return XCTFail("Expected the failed nested browse to be visible")
        }

        let retry = Task { await viewModel.refresh() }
        guard await waitForFolderRequestCount(3, requests: requests) else { return }
        let retriedRequest = await requests.request(at: 2)
        XCTAssertEqual(retriedRequest?.path, "Nested")
        XCTAssertEqual(retriedRequest?.offset, 0)
        await requests.completeNext(
            with: makeFolderPage(root: root, path: "Nested", names: ["Recovered"])
        )
        await retry.value

        XCTAssertEqual(viewModel.browseResponse?.path, "Nested")
        XCTAssertEqual(viewModel.entries.map(\.name), ["Recovered"])
        XCTAssertEqual(viewModel.loadState, .loaded)
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

private actor FolderBrowseRequestController {
    private struct PendingRequest {
        let path: String?
        let offset: Int
        let continuation: CheckedContinuation<FolderBrowseResponse, Error>
    }

    private var requestHistory: [(path: String?, offset: Int)] = []
    private var pendingRequests: [PendingRequest] = []

    func response(path: String?, offset: Int) async throws -> FolderBrowseResponse {
        try await withCheckedThrowingContinuation { continuation in
            requestHistory.append((path: path, offset: offset))
            pendingRequests.append(
                PendingRequest(path: path, offset: offset, continuation: continuation)
            )
        }
    }

    func requestCount() -> Int {
        requestHistory.count
    }

    func request(at index: Int) -> (path: String?, offset: Int)? {
        guard requestHistory.indices.contains(index) else { return nil }
        return requestHistory[index]
    }

    func complete(
        path: String?,
        offset: Int,
        with response: FolderBrowseResponse
    ) -> Bool {
        guard let index = pendingRequests.firstIndex(where: {
            $0.path == path && $0.offset == offset
        }) else {
            return false
        }
        let request = pendingRequests.remove(at: index)
        request.continuation.resume(returning: response)
        return true
    }

    func completeNext(with response: FolderBrowseResponse) {
        let request = pendingRequests.removeFirst()
        request.continuation.resume(returning: response)
    }

    func failNext(with error: Error) {
        let request = pendingRequests.removeFirst()
        request.continuation.resume(throwing: error)
    }
}

private struct FolderBrowserAPIClient: PlayarrAPIClient {
    let root: FolderRoot
    let requests: FolderBrowseRequestController
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
    func fetchWork(id: UUID) async throws -> WorkDetail { throw APIError.notFound(nil) }
    func listFolderRoots(kind: WorkKind) async throws -> FolderRootsResponse {
        FolderRootsResponse(roots: [root], errors: [])
    }
    func browseFolder(
        rootID: UUID,
        path: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> FolderBrowseResponse {
        try await requests.response(path: path, offset: offset ?? 0)
    }
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

@MainActor
private func waitForFolderRequestCount(
    _ count: Int,
    requests: FolderBrowseRequestController,
    file: StaticString = #filePath,
    line: UInt = #line
) async -> Bool {
    for _ in 0..<1_000 {
        if await requests.requestCount() >= count {
            return true
        }
        await Task.yield()
    }
    XCTFail("Timed out waiting for \(count) folder requests", file: file, line: line)
    return false
}

private func makeFolderRoot() -> FolderRoot {
    FolderRoot(
        id: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
        sourceInstanceID: UUID(uuidString: "00000000-0000-4000-8000-000000000002")!,
        sourceName: "Radarr",
        libraryKind: .movie,
        name: "Movies",
        available: true
    )
}

private func makeFolderPage(
    root: FolderRoot,
    path: String,
    names: [String],
    total: Int64? = nil,
    offset: Int = 0
) -> FolderBrowseResponse {
    let entries = names.map { name in
        FolderEntry(
            entryType: .directory,
            name: name,
            path: path.isEmpty ? name : "\(path)/\(name)"
        )
    }
    let breadcrumbs = [
        FolderBreadcrumb(name: root.name, path: ""),
        path.isEmpty ? nil : FolderBreadcrumb(name: path, path: path),
    ].compactMap { $0 }
    return FolderBrowseResponse(
        root: root,
        path: path,
        breadcrumbs: breadcrumbs,
        entries: entries,
        total: total ?? Int64(entries.count),
        offset: offset,
        limit: 200
    )
}

private actor PlaybackEventRecorder {
    struct Event: Sendable {
        let sessionID: UUID
        let kind: String
    }

    private(set) var events: [Event] = []

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

    let avPlayer = AVPlayer()
    var statePublisher: AnyPublisher<PlayerPlaybackState, Never> { Empty().eraseToAnyPublisher() }
    var currentTimePublisher: AnyPublisher<Double, Never> { Empty().eraseToAnyPublisher() }

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
