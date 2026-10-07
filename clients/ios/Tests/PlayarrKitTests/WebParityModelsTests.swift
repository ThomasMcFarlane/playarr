import XCTest
@testable import PlayarrKit

/// Decoding of the responses the tvOS web-parity screens read (Home rails, household status, availability lag,
/// profile avatar, runtimes on details).
final class WebParityModelsTests: XCTestCase {
    private let decoder = PlayarrJSONCoding.makeDecoder()

    func testHomeRailsResponseDecodesRailsAndItems() throws {
        let json = """
        {"generated_at":"2026-07-29T05:59:00Z","lang":"en","rails":[
          {"id":"11111111-1111-4111-8111-111111111111","title":"Recently Added in Movies","title_key":"recently_added","kind":"recently_added","total":1,"items":[
            {"id":"22222222-2222-4222-8222-222222222222","kind":"movie","external_refs":[],"title":"Test Movie A","sort_title":"test movie a","images":[],"genres":["Adventure"],"tags":[],"added_at":"2026-07-29T05:00:00Z","monitored":true,"availability":"available","release_date":"2020-06-01"}
          ]}]}
        """
        let response = try decoder.decode(HomeRailsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.rails.count, 1)
        XCTAssertEqual(response.rails[0].title, "Recently Added in Movies")
        XCTAssertEqual(response.rails[0].items.first?.title, "Test Movie A")
    }

    func testHouseholdStatusBlocksOutsideScheduleAndBudget() throws {
        let blocked = try decoder.decode(HouseholdStatus.self, from: Data(#"{"state":"outside_schedule","next_start_at":"2026-07-30T06:00:00Z"}"#.utf8))
        XCTAssertTrue(blocked.isBlocked)
        XCTAssertEqual(blocked.nextStartAt, "2026-07-30T06:00:00Z")
        let spent = try decoder.decode(HouseholdStatus.self, from: Data(#"{"state":"budget_exhausted"}"#.utf8))
        XCTAssertTrue(spent.isBlocked)
        let allowed = try decoder.decode(HouseholdStatus.self, from: Data(#"{"state":"allowed"}"#.utf8))
        XCTAssertFalse(allowed.isBlocked)
    }

    func testAvailabilityLagAllowsNoData() throws {
        let json = #"{"average_seconds":null,"sample_count":0,"backfill_count":0,"backfill_threshold_days":30,"unknown_count":0,"samples":[]}"#
        let lag = try decoder.decode(AvailabilityLag.self, from: Data(json.utf8))
        XCTAssertNil(lag.averageSeconds)
        XCTAssertEqual(lag.backfillThresholdDays, 30)
    }

    func testProfileAvatarPresetResponse() throws {
        let set = try decoder.decode(ProfileAvatarSettingResponse.self, from: Data(#"{"preference":{"kind":"preset","value":"astronaut"}}"#.utf8))
        XCTAssertEqual(set.preference?.value, "astronaut")
        let none = try decoder.decode(ProfileAvatarSettingResponse.self, from: Data("{}".utf8))
        XCTAssertNil(none.preference)
    }

    func testWorkDetailCarriesRuntime() throws {
        let json = """
        {"work":{"id":"22222222-2222-4222-8222-222222222222","kind":"movie","external_refs":[],"title":"Test Movie A","sort_title":"test movie a","images":[],"genres":[],"tags":[],"added_at":"2026-07-29T05:00:00Z","monitored":true,"availability":"available"},
         "children":"Movie","media_file_id":"33333333-3333-4333-8333-333333333333","runtime_ms":6000}
        """
        let detail = try decoder.decode(WorkDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.runtimeMs, 6000)
    }
}
