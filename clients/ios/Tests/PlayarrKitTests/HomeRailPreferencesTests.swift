import Foundation
import PlayarrKit
import XCTest

final class HomeRailPreferencesTests: XCTestCase {
    private let entries = [
        RailPreferenceEntry(id: "a", kind: "recently_added", title: "A", hidden: false),
        RailPreferenceEntry(id: "b", kind: "seasonal", title: "B", hidden: true),
        RailPreferenceEntry(id: "c", kind: "custom", title: "C", hidden: false),
    ]

    func testMoveStopsAtTheEnds() {
        XCTAssertEqual(HomeRailEdits.move(entries, id: "a", by: -1).map(\.id), ["a", "b", "c"])
        XCTAssertEqual(HomeRailEdits.move(entries, id: "a", by: 1).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(HomeRailEdits.move(entries, id: "c", by: 1).map(\.id), ["a", "b", "c"])
    }

    func testToggleFlipsOnlyThatRail() {
        let toggled = HomeRailEdits.toggle(entries, id: "a")
        XCTAssertEqual(toggled.map(\.hidden), [true, true, false])
    }

    func testSaveSendsOrderAndHiddenSet() async throws {
        let transport = StubTransport { _ in Data(#"{"rails":[]}"#.utf8) }
        try await HomeRailPreferencesClient(transport: transport).save(entries)
        let call = try XCTUnwrap(transport.calls.first)
        XCTAssertEqual(call.method, "PUT")
        XCTAssertEqual(call.path, "/api/v1/home/rails/preferences")
        XCTAssertTrue(call.body?.contains(#""order":["a","b","c"]"#) == true)
        XCTAssertTrue(call.body?.contains(#""hidden":["b"]"#) == true)
    }

    func testLoadReadsTheRails() async throws {
        let transport = StubTransport { _ in
            Data(#"{"rails":[{"id":"a","kind":"recently_added","title":"A","hidden":false}]}"#.utf8)
        }
        let rails = try await HomeRailPreferencesClient(transport: transport).load(language: "en")
        XCTAssertEqual(rails.map(\.title), ["A"])
        XCTAssertEqual(transport.calls.first?.query, ["lang=en"])
    }
}
