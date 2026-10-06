import Foundation
import PlayarrKit
import XCTest

final class ResumePlanTests: XCTestCase {
    private static let series = "00000000-0000-0000-0000-0000000000a1"

    private static func optionJSON(kind: String, episode: String, label: String) -> String {
        """
        {"kind":"\(kind)","episode_id":"\(episode)","media_file_id":"00000000-0000-0000-0000-0000000000f1",
         "season_number":1,"episode_number":5,"label":"\(label)","title":"Pilot","position_ms":1200,
         "duration_ms":60000,"progress_percent":2,"last_watched_at":"2026-10-04T10:00:00Z"}
        """
    }

    private static func planJSON(needsChoice: Bool, action: String = "resume") -> Data {
        let a = Self.optionJSON(kind: "unfinished", episode: "00000000-0000-0000-0000-0000000000e1", label: "S01E05")
        let b = Self.optionJSON(kind: "next_in_series", episode: "00000000-0000-0000-0000-0000000000e2", label: "S01E06")
        let options = needsChoice ? "[\(a),\(b)]" : "[\(a)]"
        return Data(
            """
            {"series_work_id":"\(Self.series)","action":"\(action)","reason":"choice_required",
             "needs_choice":\(needsChoice),"ask_reasons":["unfinished"],"target":\(a),"options":\(options)}
            """.utf8
        )
    }

    func testDecodesStackedPlan() async throws {
        let transport = StubTransport { _ in Self.planJSON(needsChoice: true) }
        let plan = try await ResumePlanClient(transport: transport).plan(seriesID: UUID(uuidString: Self.series)!)
        XCTAssertEqual(plan?.options.count, 2)
        XCTAssertEqual(plan?.isStacked, true)
        XCTAssertEqual(plan?.buttonLabel, "Resume")
        XCTAssertEqual(plan?.playableTarget?.label, "S01E05")
        XCTAssertEqual(plan?.options.last?.kind, .nextInSeries)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/catalog/\(Self.series)/resume-plan")
    }

    func testSingleOptionPlanIsNotStacked() async throws {
        let transport = StubTransport { _ in Self.planJSON(needsChoice: false, action: "start") }
        let plan = try await ResumePlanClient(transport: transport).plan(seriesID: UUID(uuidString: Self.series)!)
        XCTAssertEqual(plan?.isStacked, false)
        XCTAssertEqual(plan?.buttonLabel, "Start")
    }

    func testRestartLabelAndUnknownValuesDecode() throws {
        let json = Data(
            """
            {"series_work_id":"\(Self.series)","action":"rewind","reason":"x","needs_choice":false,
             "ask_reasons":[],"options":[\(Self.optionJSON(kind: "future_kind", episode: "00000000-0000-0000-0000-0000000000e1", label: "S01E01"))]}
            """.utf8
        )
        let plan = try JSONDecoder().decode(ResumePlan.self, from: json)
        XCTAssertEqual(plan.action, .unknown)
        XCTAssertEqual(plan.options.first?.kind, .unknown)
        XCTAssertEqual(plan.buttonLabel, "Resume")
        XCTAssertEqual(plan.playableTarget?.label, "S01E01")
    }

    func testRecordChoicePostsKindAndEpisode() async throws {
        let transport = StubTransport { _ in Self.planJSON(needsChoice: false) }
        let client = ResumePlanClient(transport: transport)
        let plan = try await client.plan(seriesID: UUID(uuidString: Self.series)!)
        let option = try XCTUnwrap(plan?.options.first)
        try await client.recordChoice(seriesID: UUID(uuidString: Self.series)!, option: option)
        let call = try XCTUnwrap(transport.calls.last)
        XCTAssertEqual(call.method, "POST")
        XCTAssertEqual(call.path, "/api/v1/catalog/\(Self.series)/resume-plan/choice")
        XCTAssertTrue(call.body?.contains(#""kind":"unfinished""#) == true)
        XCTAssertTrue(call.body?.contains(#""episode_id":"00000000-0000-0000-0000-0000000000E1""#) == true
            || call.body?.contains(#""episode_id":"00000000-0000-0000-0000-0000000000e1""#) == true)
    }

    func testNotFoundDegradesToNilAndEmpty() async throws {
        let transport = StubTransport { _ in throw APIError.notFound(nil) }
        let client = ResumePlanClient(transport: transport)
        let plan = try await client.plan(seriesID: UUID())
        XCTAssertNil(plan)
        let plans = try await client.plans()
        XCTAssertTrue(plans.isEmpty)
    }

    func testPlansListsAllSeries() async throws {
        let transport = StubTransport { _ in
            Data("[".utf8) + Self.planJSON(needsChoice: true) + Data("]".utf8)
        }
        let plans = try await ResumePlanClient(transport: transport).plans()
        XCTAssertEqual(plans.count, 1)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/playback/resume-plans")
    }
}
