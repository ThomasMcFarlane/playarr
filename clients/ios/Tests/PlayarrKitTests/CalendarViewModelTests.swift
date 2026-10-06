import Foundation
import PlayarrKit

import XCTest

private final class CalendarStubTransport: PlayarrRequestTransport, @unchecked Sendable {
    let lock = NSLock()
    var paths: [String] = []
    var queries: [[String]] = []
    var response: Data

    init(response: Data) { self.response = response }

    func requestData(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Data?,
        expectedStatuses: Set<Int>
    ) async throws -> Data {
        lock.lock()
        paths.append(path)
        queries.append(query.map { "\($0.name)=\($0.value ?? "")" })
        lock.unlock()
        return response
    }
}

@MainActor
final class CalendarViewModelTests: XCTestCase {
    private let json = """
    {"start":"2026-10-05","end":"2026-11-04","entries":[
    {"id":"a","media_kind":"movie","release_type":"digital","title":"Test Movie A","date":"2026-10-07","monitored":true,"has_file":false,"sources":[]},
    {"id":"b","media_kind":"episode","release_type":"air","title":"Test Series A","season_number":1,"episode_number":1,"date":"2026-10-08","monitored":false,"has_file":true,"sources":[]}
    ],"sources":[]}
    """

    private func makeModel(transport: CalendarStubTransport) -> CalendarViewModel {
        let now = ISO8601DateFormatter().date(from: "2026-10-05T10:00:00Z") ?? Date()
        return CalendarViewModel(
            transport: transport,
            zone: TimeZone(identifier: "UTC") ?? .current,
            firstWeekday: 2,
            now: { now }
        )
    }

    func testLoadRequestsAgendaWindowAndFilters() async {
        let transport = CalendarStubTransport(response: Data(json.utf8))
        let model = makeModel(transport: transport)
        await model.load()
        XCTAssertEqual(model.loadState, .loaded)
        XCTAssertEqual(transport.queries.first, ["start=2026-10-05", "end=2026-11-04"])
        XCTAssertEqual(model.filteredEntries.count, 2)
        model.filters.types = [.movie]
        XCTAssertEqual(model.filteredEntries.map(\.id), ["a"])
        XCTAssertEqual(model.dayGroups.map(\.day), ["2026-10-07"])
    }

    func testSwitchingToMonthRefetchesTheGridWindow() async {
        let transport = CalendarStubTransport(response: Data(json.utf8))
        let model = makeModel(transport: transport)
        await model.load()
        await model.setMode(.month)
        XCTAssertEqual(transport.queries.last, ["start=2026-09-28", "end=2026-11-01"])
        XCTAssertEqual(model.anchor, "2026-10-01")
        await model.step(1)
        XCTAssertEqual(model.anchor, "2026-11-01")
    }

    func testFailureSurfacesAFriendlyMessage() async {
        let transport = CalendarStubTransport(response: Data("nope".utf8))
        let model = makeModel(transport: transport)
        await model.load()
        guard case .failed(let message) = model.loadState else { return XCTFail("expected failure") }
        XCTAssertFalse(message.isEmpty)
    }
}
