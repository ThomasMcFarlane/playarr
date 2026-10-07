import XCTest
@testable import PlayarrKit

final class WatchlistRequestsDecodingTests: XCTestCase {
    private let decoder = PlayarrJSONCoding.makeDecoder()

    func testWatchlistItemReadsTheNestedTitle() throws {
        let json = #"{"items":[{"title":{"title":"Sample Movie","year":2020},"in_watchlist":true,"actions":[],"added_at":"2026-07-29T05:59:00Z"}]}"#
        let response = try decoder.decode(WatchlistItemsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.items.first?.title, "Sample Movie")
        XCTAssertEqual(response.items.first?.year, 2020)
    }

    func testRequestSummaryDecodesStatus() throws {
        let json = #"[{"id":"r1","title":"Sample Series","year":2019,"status":"pending","status_note":null,"kind":"series","mine":true}]"#
        let list = try decoder.decode([RequestSummary].self, from: Data(json.utf8))
        XCTAssertEqual(list.first?.status, "pending")
    }
}
