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
