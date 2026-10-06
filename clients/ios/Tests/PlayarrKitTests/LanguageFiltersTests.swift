import Foundation
import PlayarrKit
import XCTest

final class LanguageFiltersTests: XCTestCase {
    func testQueryItemsOmitEmptyListsAndJoinWithCommas() {
        XCTAssertTrue(LanguageFilter().queryItems.isEmpty)
        let filter = LanguageFilter(audio: ["en", "ja"], subtitle: ["fr"])
        XCTAssertEqual(
            filter.queryItems.map { "\($0.name)=\($0.value ?? "")" },
            ["audio_lang=en,ja", "subtitle_lang=fr"]
        )
        XCTAssertEqual(filter.activeCount, 3)
    }

    func testToggleAddsAndRemoves() {
        XCTAssertEqual(LanguageFilter.toggled("en", in: []), ["en"])
        XCTAssertEqual(LanguageFilter.toggled("en", in: ["en", "ja"]), ["ja"])
    }

    func testFacetsDecodeAndRequestCarriesFilters() async throws {
        let transport = StubTransport { _ in
            Data(#"{"audio":[{"code":"en","name":"English","count":4}],"subtitle":[{"code":"fr"}]}"#.utf8)
        }
        let facets = try await LanguageFilterClient(transport: transport).facets(
            kind: .movie, filter: LanguageFilter(audio: ["en"])
        )
        XCTAssertEqual(facets.audio.first?.count, 4)
        XCTAssertEqual(facets.subtitle.first?.count, 0)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/catalog/languages")
        XCTAssertEqual(transport.calls.first?.query, ["kind=movie", "available_only=true", "audio_lang=en"])
    }

    func testBrowseSendsLanguageParameters() async throws {
        let transport = StubTransport { _ in Data(#"{"items":[],"total":0}"#.utf8) }
        let page = try await LanguageFilterClient(transport: transport).browse(
            kind: .series, sort: "title", order: "asc", availableOnly: true,
            limit: 50, offset: 0, filter: LanguageFilter(subtitle: ["de"])
        )
        XCTAssertEqual(page.total, 0)
        XCTAssertEqual(transport.calls.first?.query.last, "subtitle_lang=de")
    }

    func testDisplayNameFallsBackToServerNameThenCode() {
        let locale = Locale(identifier: "en_GB")
        XCTAssertEqual(LanguageFacetEntry(code: "en", name: nil, count: 1).displayName(locale: locale), "English")
        XCTAssertEqual(LanguageFacetEntry(code: "zzz", name: "Zed", count: 1).displayName(locale: locale), "Zed")
        XCTAssertEqual(LanguageFacetEntry(code: "zzz", name: nil, count: 1).displayName(locale: locale), "ZZZ")
    }
}
