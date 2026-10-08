import Foundation
import PlayarrKit
import XCTest

final class HouseholdTests: XCTestCase {
    func testStatusDecodesWithDefaults() throws {
        let json = #"{"restricted":true,"state":"allowed","remaining_seconds":900,"server_time":"2026-01-01T10:00:00Z","offline_valid_until":"2026-01-02T10:00:00Z","guardian_for":["a"]}"#
        let status = try JSONDecoder().decode(HouseholdStatusSnapshot.self, from: Data(json.utf8))
        XCTAssertTrue(status.restricted)
        XCTAssertEqual(status.remainingSeconds, 900)
        XCTAssertEqual(status.guardianFor, ["a"])
        let empty = try JSONDecoder().decode(HouseholdStatusSnapshot.self, from: Data("{}".utf8))
        XCTAssertEqual(empty.state, "unrestricted")
    }

    func testBlockParsing() {
        let schedule = Data(#"{"error":"household_blocked","message":"x","details":{"reason":"outside_schedule","next_start_at":"2026-01-01T16:00:00Z"}}"#.utf8)
        XCTAssertEqual(HouseholdBlock.parse(status: 403, body: schedule), .outsideSchedule(nextStartAt: "2026-01-01T16:00:00Z"))
        let budget = Data(#"{"error":"household_blocked","message":"x","details":{"reason":"budget_exhausted","resets_at":"2026-01-02T00:00:00Z"}}"#.utf8)
        XCTAssertEqual(HouseholdBlock.parse(status: 403, body: budget), .budgetExhausted(resetsAt: "2026-01-02T00:00:00Z"))
        let rating = Data(#"{"error":"household_blocked","message":"x","details":{"reason":"rating_too_high"}}"#.utf8)
        XCTAssertEqual(HouseholdBlock.parse(status: 403, body: rating), .content(reason: "rating_too_high"))
        XCTAssertNil(HouseholdBlock.parse(status: 404, body: schedule))
        XCTAssertNil(HouseholdBlock.parse(status: 403, body: Data(#"{"error":"forbidden","message":"x"}"#.utf8)))
        XCTAssertNil(HouseholdBlock.parse(status: 403, body: nil))
    }

    func testPinLockSeconds() {
        let body = Data(#"{"error":"pin_locked","message":"x","details":{"retry_after_seconds":120}}"#.utf8)
        let error = APIError.http(status: 429, body: nil, rawBody: body)
        XCTAssertEqual(HouseholdBlock.pinLockSeconds(error: error), 120)
        let bare = APIError.http(status: 429, body: nil, rawBody: Data(#"{"error":"pin_locked","message":"x"}"#.utf8))
        XCTAssertEqual(HouseholdBlock.pinLockSeconds(error: bare), 60)
        XCTAssertNil(HouseholdBlock.pinLockSeconds(error: APIError.http(status: 500, body: nil, rawBody: nil)))
    }

    func testBlockStateFromStatus() {
        XCTAssertEqual(
            HouseholdBlockState(status: HouseholdStatusSnapshot(state: "outside_schedule", nextStartAt: "n")),
            .outsideSchedule(until: "n")
        )
        XCTAssertEqual(HouseholdBlockState(status: HouseholdStatusSnapshot(state: "budget_exhausted", resetsAt: "r"))?.approvalSubject, "budget")
        XCTAssertNil(HouseholdBlockState(status: HouseholdStatusSnapshot(state: "allowed")))
        XCTAssertNil(HouseholdBlockState(status: nil))
    }

    func testRemainingMinutesUsesNearestLimitInLastHour() {
        let now = HouseholdFormat.date(fromISO: "2026-01-01T10:00:00Z")!
        XCTAssertEqual(HouseholdFormat.remainingMinutes(status: HouseholdStatusSnapshot(state: "allowed", remainingSeconds: 601), now: now), 11)
        XCTAssertNil(HouseholdFormat.remainingMinutes(status: HouseholdStatusSnapshot(state: "allowed", remainingSeconds: 7200), now: now))
        let windowed = HouseholdStatusSnapshot(state: "allowed", remainingSeconds: 3000, windowEndsAt: "2026-01-01T10:10:00Z")
        XCTAssertEqual(HouseholdFormat.remainingMinutes(status: windowed, now: now), 10)
        XCTAssertNil(HouseholdFormat.remainingMinutes(status: HouseholdStatusSnapshot(state: "outside_schedule"), now: now))
    }

    func testClientPaths() async throws {
        let transport = StubTransport { call in
            if call.path.hasSuffix("/approvals") && call.method == "GET" { return Data("[]".utf8) }
            if call.path.hasSuffix("/status") { return Data("{}".utf8) }
            return Data(#"{"id":"1","profile_user_id":"p","kind":"time","subject":"budget","status":"pending"}"#.utf8)
        }
        let client = HouseholdClient(transport: transport)
        _ = try await client.status()
        _ = try await client.approvals()
        let created = try await client.requestApproval(subject: "budget")
        XCTAssertEqual(created.status, "pending")
        _ = try await client.decide(approvalID: "1", approve: true, pin: "1234")
        XCTAssertEqual(transport.calls.map(\.path), [
            "/api/v1/household/status",
            "/api/v1/household/approvals",
            "/api/v1/household/approvals",
            "/api/v1/household/approvals/1/decision"
        ])
        let body = transport.calls[2].body ?? ""
        XCTAssertTrue(body.contains(#""kind":"time""#))
        XCTAssertTrue(body.contains(#""subject":"budget""#))
    }
}
