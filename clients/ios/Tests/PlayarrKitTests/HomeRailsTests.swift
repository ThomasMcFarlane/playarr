import Foundation
import PlayarrKit
import XCTest

final class HomeRailsTests: XCTestCase {
    private func workJSON(_ id: String) -> String {
        #"{"id":"\#(id)","kind":"movie","external_refs":[],"title":"Test Movie A","sort_title":"test movie a","images":[],"genres":[],"tags":[],"added_at":"2026-01-01T00:00:00Z","monitored":true,"availability":"available"}"#
    }

    func testDecodesRailsAndDropsEmptyOnes() async {
        let item = workJSON("00000000-0000-0000-0000-000000000001")
        let json = #"{"lang":"th","generated_at":"2026-01-01T00:00:00Z","rails":[{"id":"r1","kind":"recently_added","library":"movie","title":"Added","title_key":"recently_added","items":[\#(item)],"total":5},{"id":"r2","kind":"custom","title":"Empty","title_key":"custom","items":[],"total":0}]}"#
        let transport = StubTransport { _ in Data(json.utf8) }
        let result = await HomeRailsClient(transport: transport).fetchRails(language: "th")
        guard case .success(let rails?) = result else { return XCTFail("expected rails") }
        XCTAssertEqual(rails.map(\.id), ["r1"])
        XCTAssertEqual(rails[0].total, 5)
        XCTAssertEqual(rails[0].items.count, 1)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/home/rails")
        XCTAssertEqual(transport.calls.first?.query, ["lang=th"])
    }

    func testNotFoundFallsBackToNil() async {
        let transport = StubTransport { _ in throw APIError.notFound(nil) }
        let result = await HomeRailsClient(transport: transport).fetchRails()
        guard case .success(let rails) = result else { return XCTFail("expected success") }
        XCTAssertNil(rails)
    }

    func testOtherErrorsAreReported() async {
        let transport = StubTransport { _ in throw APIError.serviceUnavailable(nil) }
        let result = await HomeRailsClient(transport: transport).fetchRails()
        guard case .failure = result else { return XCTFail("expected failure") }
    }

    func testLanguageMapping() {
        XCTAssertEqual(HomeRailsClient.railLanguage(forLocaleIdentifier: "ja_JP"), "ja")
        XCTAssertEqual(HomeRailsClient.railLanguage(forLocaleIdentifier: "th-TH"), "th")
        XCTAssertEqual(HomeRailsClient.railLanguage(forLocaleIdentifier: "fr-FR"), "en")
    }
}
