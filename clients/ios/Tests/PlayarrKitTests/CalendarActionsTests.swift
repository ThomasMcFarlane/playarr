import Foundation
import PlayarrKit
import XCTest

final class CalendarActionsTests: XCTestCase {
    private let json = """
    {
      "id": "e1", "media_kind": "episode", "release_type": "air", "title": "Sample Series 1",
      "season_number": 3, "episode_number": 3, "date": "2026-10-10", "monitored": true, "has_file": false,
      "work_id": "00000000-0000-0000-0000-0000000000a1", "sources": [],
      "snapshot": {"kind": "series", "title": "Sample Series 1", "year": 2019,
                   "external_refs": [{"provider": "tvdb", "external_id": "42"}]},
      "actions": [
        {"action": "open", "enabled": true, "work_id": "00000000-0000-0000-0000-0000000000a1"},
        {"action": "request", "enabled": false, "reason": "Already requested", "active": true},
        {"action": "watchlist", "enabled": true}
      ]
    }
    """

    func testEntryDecodesTheServersActionsAndSnapshot() throws {
        let entry = try JSONDecoder().decode(CalendarEntry.self, from: Data(json.utf8))
        XCTAssertEqual(entry.actions.map(\.action), ["open", "request", "watchlist"])
        XCTAssertNil(entry.action(.play), "an entry without its own file has no Play action")
        let request = try XCTUnwrap(entry.action(.request))
        XCTAssertFalse(request.enabled)
        XCTAssertTrue(request.active)
        XCTAssertEqual(request.reason, "Already requested")
        XCTAssertEqual(entry.action(.open)?.workID, entry.workID)
        let snapshot = try XCTUnwrap(entry.snapshot)
        XCTAssertEqual(snapshot.kind, "series")
        XCTAssertEqual(snapshot.year, 2019)
        XCTAssertEqual(snapshot.externalRefs.count, 1)
    }

    func testEntryWithoutActionsStillDecodes() throws {
        let bare = """
        {"id": "e2", "media_kind": "movie", "release_type": "digital", "title": "Test Movie A",
         "date": "2026-10-11", "monitored": false, "has_file": true, "sources": []}
        """
        let entry = try JSONDecoder().decode(CalendarEntry.self, from: Data(bare.utf8))
        XCTAssertTrue(entry.actions.isEmpty)
        XCTAssertNil(entry.snapshot)
    }

    func testUnknownActionKindIsKeptRaw() throws {
        let action = try JSONDecoder().decode(CalendarAction.self, from: Data(#"{"action":"share","enabled":true}"#.utf8))
        XCTAssertEqual(action.action, "share")
        XCTAssertNil(action.kind)
    }
}
