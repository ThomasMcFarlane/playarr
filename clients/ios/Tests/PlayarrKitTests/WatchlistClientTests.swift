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

final class WatchlistPresentationTests: XCTestCase {
    private let libraryWork = UUID()

    private static func entryJSON(actions: String, sources: String) -> Data {
        Data("""
        {"items":[{"title":{"title_key":"movie:sample","kind":"movie","title":"Sample","year":2020,"external_refs":[],"editions":[],"sources":\(sources)},"in_watchlist":true,"actions":\(actions),"added_at":"2026-01-01T00:00:00.250+00:00"}]}
        """.utf8)
    }

    func testListDecodesActionsAndSources() async throws {
        let work = libraryWork
        let transport = StubTransport { _ in
            WatchlistPresentationTests.entryJSON(
                actions: #"[{"action":"play","enabled":true,"media_file_id":"\#(UUID())"},{"action":"request","enabled":false,"reason":"Already requested"}]"#,
                sources: #"[{"source":"library","label":"Main","availability":"available","work_id":"\#(work)"},{"source":"library","label":"Other","availability":"available"},{"source":"request","label":"Provider","availability":"requestable"}]"#
            )
        }
        let entry = try await WatchlistClient(transport: transport).list().first
        let item = try XCTUnwrap(entry)

        XCTAssertEqual(WatchlistPresentation.primaryAction(item.actions ?? [])?.label, "Play")
        XCTAssertEqual(WatchlistPresentation.explainedDisabledActions(item.actions ?? []).first?.reason, "Already requested")
        XCTAssertEqual(WatchlistPresentation.uniqueSourceKinds(item.title.sources ?? []), ["library", "request"])
        XCTAssertEqual(WatchlistPresentation.libraryWorkID(item.title), libraryWork)
    }

    func testPrimaryActionPrefersResumeThenPlayThenRequest() {
        let actions = [
            TitleAction(action: "request", enabled: true),
            TitleAction(action: "play", enabled: true),
            TitleAction(action: "resume", enabled: false),
        ]
        XCTAssertEqual(WatchlistPresentation.primaryAction(actions)?.action, "play")
        XCTAssertEqual(WatchlistPresentation.primaryAction([TitleAction(action: "play", enabled: false)])?.action, nil)
        XCTAssertEqual(WatchlistPresentation.primaryAction(Array(actions.prefix(1)))?.label, "Request")
    }

    func testRowsWithoutActionsOrSourcesStillDecode() async throws {
        let transport = StubTransport { _ in
            Data(#"{"items":[{"title":{"title_key":"k","kind":"series","title":"S"},"in_watchlist":true,"added_at":"2026-01-01T00:00:00Z"}]}"#.utf8)
        }
        let item = try await WatchlistClient(transport: transport).list().first
        XCTAssertNil(item?.actions)
        XCTAssertNil(item.flatMap { WatchlistPresentation.libraryWorkID($0.title) })
    }
}
