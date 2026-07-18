import Foundation
import StreamarrKit
@testable import StreamarrApp
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
        XCTAssertEqual(HomeLayout.backdropHeight(viewportHeight: 800, phone: false), 800, accuracy: 0.001)
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

private struct WorkDetailAPIClient: StreamarrAPIClient {
    let result: Result<WorkDetail, Error>
    let baseURL = URL(string: "https://streamarr.example")!

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
