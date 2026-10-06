import Foundation
import PlayarrKit
import XCTest

final class CalendarLogicTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!
    private let work1 = UUID(uuidString: "00000000-0000-0000-0000-0000000000a1")!
    private let work2 = UUID(uuidString: "00000000-0000-0000-0000-0000000000a2")!
    private let sourceA = UUID(uuidString: "00000000-0000-0000-0000-0000000000b1")!

    private func at(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    private func episode(
        _ n: Int,
        season: Int = 2,
        id: String? = nil,
        title: String = "Test Series A",
        work: UUID? = nil,
        releaseAt: String? = "2026-10-10T12:00:00Z",
        numbered: Bool = true,
        kind: String = "episode"
    ) -> CalendarEntry {
        CalendarEntry(
            id: id ?? "ep\(n)",
            mediaKind: kind,
            title: title,
            seasonNumber: numbered ? season : nil,
            episodeNumber: numbered ? n : nil,
            date: "2026-10-10",
            releaseAt: releaseAt.map(at),
            workID: work ?? work1
        )
    }

    func testEpisodeCodesCollapseRunsAndListGaps() {
        XCTAssertEqual(formatEpisodeCodes([episode(4), episode(5), episode(6)]), "S02E04\u{2013}E06")
        XCTAssertEqual(formatEpisodeCodes([episode(1), episode(3), episode(5)]), "S02E01, E03, E05")
        XCTAssertEqual(formatEpisodeCodes([episode(1), episode(2), episode(4)]), "S02E01\u{2013}E02, E04")
        XCTAssertEqual(formatEpisodeCodes([episode(10, season: 1), episode(1)]), "S01E10, S02E01")
    }

    func testSameSeriesSameDaySameSlotGroupsOthersStayIndividual() {
        let items = groupSeriesEpisodes(
            [
                episode(6), episode(4), episode(5),
                episode(1, id: "other", title: "Test Series B", work: work2),
                episode(1, id: "movie", numbered: false, kind: "movie"),
                episode(7, id: "late", releaseAt: "2026-10-10T20:00:00Z"),
                episode(8, id: "unnumbered", numbered: false)
            ],
            zone: utc
        )
        XCTAssertEqual(items.count, 5)
        guard case .series(_, _, let entries, let codes) = items[0] else { return XCTFail("expected a series group") }
        XCTAssertEqual(codes, "S02E04\u{2013}E06")
        XCTAssertEqual(entries.map(\.id), ["ep4", "ep5", "ep6"])
        for item in items.dropFirst() {
            if case .series = item { XCTFail("only the first item should group") }
        }
    }

    func testAllDayEpisodesGroup() {
        let items = groupSeriesEpisodes([episode(1, releaseAt: nil), episode(2, releaseAt: nil)], zone: utc)
        XCTAssertEqual(items.count, 1)
    }

    func testFiltersAndOrOrSemantics() {
        let aired = episode(1, id: "aired")
        let upcoming = CalendarEntry(
            id: "up", mediaKind: "movie", title: "Test Movie A", date: "2026-11-01", monitored: true,
            sources: [CalendarEntrySource(sourceInstanceID: sourceA, sourceName: "A", sourceKind: "radarr", arrID: 1)]
        )
        let all = [aired, upcoming]
        let today = "2026-10-20"
        XCTAssertEqual(applyCalendarFilters(all, filters: CalendarFilters(), today: today, zone: utc).count, 2)
        XCTAssertEqual(
            applyCalendarFilters(all, filters: CalendarFilters(types: [.movie]), today: today, zone: utc).map(\.id), ["up"]
        )
        XCTAssertEqual(
            applyCalendarFilters(all, filters: CalendarFilters(statuses: [.aired, .upcoming]), today: today, zone: utc).count, 2
        )
        XCTAssertEqual(
            applyCalendarFilters(all, filters: CalendarFilters(statuses: [.missing]), today: today, zone: utc).map(\.id), ["aired"]
        )
        XCTAssertEqual(
            applyCalendarFilters(all, filters: CalendarFilters(sources: [sourceA]), today: today, zone: utc).map(\.id), ["up"]
        )
        XCTAssertEqual(
            applyCalendarFilters(all, filters: CalendarFilters(monitoredOnly: true), today: today, zone: utc).map(\.id), ["up"]
        )
        XCTAssertEqual(
            applyCalendarFilters(all, filters: CalendarFilters(from: "2026-10-25"), today: today, zone: utc).map(\.id), ["up"]
        )
        XCTAssertEqual(CalendarFilters(types: [.tv], monitoredOnly: true).activeCount, 2)
    }

    func testWindowsAndDayArithmetic() {
        XCTAssertEqual(CalendarDays.adding(days: 1, to: "2026-02-28"), "2026-03-01")
        XCTAssertEqual(CalendarDays.lastOfMonth("2026-02-10"), "2026-02-28")
        let agenda = calendarWindow(mode: .agenda, anchor: "2026-10-05")
        XCTAssertEqual(agenda.end, "2026-11-04")
        XCTAssertEqual(agenda.days.count, 30)
        // 2026-10-05 is a Monday.
        let week = calendarWindow(mode: .week, anchor: "2026-10-08", firstWeekday: 2)
        XCTAssertEqual(week.start, "2026-10-05")
        XCTAssertEqual(week.end, "2026-10-11")
        let month = calendarWindow(mode: .month, anchor: "2026-10-15", firstWeekday: 2)
        XCTAssertEqual(month.start, "2026-09-28")
        XCTAssertEqual(month.end, "2026-11-01")
        XCTAssertEqual(month.days.count % 7, 0)
        XCTAssertEqual(calendarShift(mode: .month, anchor: "2026-10-01", by: 1), "2026-11-01")
        XCTAssertNil(CalendarDays.parse("2026-13-40"))
    }

    func testLocalDayUsesReleaseInstantInZone() {
        let zone = TimeZone(secondsFromGMT: 3600 * 10)!
        let entry = episode(1, releaseAt: "2026-10-10T20:00:00Z")
        XCTAssertEqual(calendarLocalDay(entry, zone: zone), "2026-10-11")
        XCTAssertEqual(calendarLocalDay(entry, zone: utc), "2026-10-10")
    }

    func testDayGroupsFillWindowAndOrderByTime() {
        let early = episode(1, id: "early", title: "Test Series A", releaseAt: "2026-10-10T08:00:00Z")
        let late = episode(1, id: "late", title: "Test Series B", work: work2, releaseAt: "2026-10-10T18:00:00Z")
        let window = CalendarWindow(start: "2026-10-09", end: "2026-10-11")
        let groups = groupCalendarByDay([late, early], zone: utc, fillingWindow: window)
        XCTAssertEqual(groups.map(\.day), ["2026-10-09", "2026-10-10", "2026-10-11"])
        XCTAssertEqual(groups[1].items.map(\.id), ["early", "late"])
        XCTAssertTrue(groups[0].items.isEmpty)
    }

    func testClientBuildsQueryAndDecodes() async throws {
        let json = """
        {"start":"2026-10-05","end":"2026-11-04","entries":[{"id":"x","media_kind":"episode","release_type":"air","title":"Test Series A","season_number":1,"episode_number":2,"date":"2026-10-06","release_at":"2026-10-06T20:00:00+00:00","monitored":true,"has_file":false,"sources":[]}],"sources":[{"source_instance_id":"00000000-0000-0000-0000-0000000000b1","name":"A","kind":"sonarr","status":"ok","entry_count":1}]}
        """
        let transport = StubTransport { _ in Data(json.utf8) }
        let response = try await CalendarClient(transport: transport).calendar(
            start: "2026-10-05", end: "2026-11-04", kinds: [.movie, .episode]
        )
        XCTAssertEqual(response.entries.first?.episodeCode, "S01E02")
        XCTAssertEqual(response.entries.first?.kind, .episode)
        XCTAssertNotNil(response.entries.first?.releaseAt)
        XCTAssertTrue(response.sources.first?.isOK ?? false)
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/calendar")
        XCTAssertEqual(transport.calls.first?.query, ["start=2026-10-05", "end=2026-11-04", "kind=episode,movie"])
    }

    func testFeedEndpoints() async throws {
        let transport = StubTransport { call in
            if call.method == "POST" {
                return Data(#"{"url":"https://example.com/api/v1/calendar/feed/abc.ics","token":"abc","created_at":"2026-10-05T10:00:00Z"}"#.utf8)
            }
            return Data(#"{"active":true,"created_at":"2026-10-05T10:00:00Z","last_used_at":null}"#.utf8)
        }
        let client = CalendarClient(transport: transport)
        let status = try await client.feedStatus()
        XCTAssertTrue(status.active)
        let created = try await client.createFeed()
        XCTAssertEqual(created.token, "abc")
        try await client.revokeFeed()
        XCTAssertEqual(transport.calls.map(\.method), ["GET", "POST", "DELETE"])
    }
}
