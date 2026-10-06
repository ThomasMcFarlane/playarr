import Foundation
import PlayarrKit
import XCTest

final class WatchlistClientTests: XCTestCase {
    private let resolved = #"""
    {"title":{"title_key":"movie:sample","kind":"movie","title":"Sample","external_refs":[],"editions":[],"sources":[]},"in_watchlist":true,"actions":[]}
    """#

    func testListReadsTheItemsEnvelope() async throws {
        let transport = StubTransport { _ in
            Data(#"""
            {"items":[{"title":{"title_key":"movie:sample","kind":"movie","title":"Sample","year":2020,"external_refs":[],"editions":[],"sources":[]},"in_watchlist":true,"actions":[],"added_at":"2026-01-01T00:00:00Z"}]}
            """#.utf8)
        }
        let items = try await WatchlistClient(transport: transport).list()
        XCTAssertEqual(items.map(\.title.title), ["Sample"])
        XCTAssertEqual(items.first?.title.year, 2020)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/watchlist")
    }

    func testResolveAndAddSendTheSnapshot() async throws {
        let transport = StubTransport { [resolved] _ in Data(resolved.utf8) }
        let client = WatchlistClient(transport: transport)
        let snapshot = TitleSnapshot(kind: "movie", title: "Sample", workID: UUID(), year: 2020)

        let result = try await client.resolve(snapshot)
        _ = try await client.add(snapshot)

        XCTAssertTrue(result.inWatchlist)
        XCTAssertEqual(result.title.titleKey, "movie:sample")
        XCTAssertEqual(transport.calls.map(\.path), ["/api/v1/discover/resolve", "/api/v1/watchlist"])
        XCTAssertEqual(transport.calls.map(\.method), ["POST", "POST"])
        XCTAssertTrue(transport.calls[0].body?.contains(#""work_id""#) == true)
        XCTAssertTrue(transport.calls[0].body?.contains(#""kind":"movie""#) == true)
    }

    func testRemoveEscapesTheTitleKey() async throws {
        let transport = StubTransport { _ in Data() }
        try await WatchlistClient(transport: transport).remove(titleKey: "series:a/b c")
        XCTAssertEqual(transport.calls.first?.method, "DELETE")
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/watchlist/series:a%2Fb%20c")
    }
}
