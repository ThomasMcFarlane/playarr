import Foundation
import PlayarrKit
import XCTest

final class HttpLatencyClientTests: XCTestCase {
    private let body = Data(#"""
    [
      {"method":"GET","route":"/api/v1/example/{id}","sample_count":812,"avg_ms":4.2,"p50_ms":3.1,"p95_ms":11.4,"p99_ms":22.0,"max_ms":58.7},
      {"method":"POST","route":"/api/v1/other","sample_count":3,"avg_ms":1,"p50_ms":1,"p95_ms":2,"p99_ms":2,"max_ms":2}
    ]
    """#.utf8)

    func testMetricsDecodesRowsInServerOrder() async throws {
        let transport = StubTransport { _ in self.body }
        let rows = try await HttpLatencyClient(transport: transport).metrics()
        XCTAssertEqual(rows.map(\.route), ["/api/v1/example/{id}", "/api/v1/other"])
        XCTAssertEqual(rows[0].sampleCount, 812)
        XCTAssertEqual(rows[0].p95Ms, 11.4)
        XCTAssertEqual(rows[0].id, "GET /api/v1/example/{id}")
        XCTAssertEqual(transport.calls, [.init(method: "GET", path: "/api/v1/admin/metrics/http-latency", query: [], body: nil)])
    }

    func testLoadReturnsReadyWithRows() async {
        let transport = StubTransport { _ in self.body }
        let state = await HttpLatencyClient(transport: transport).load()
        guard case .ready(let rows) = state else { return XCTFail("expected ready, got \(state)") }
        XCTAssertEqual(rows.count, 2)
    }

    func testLoadReturnsReadyWithEmptyList() async {
        let transport = StubTransport { _ in Data("[]".utf8) }
        let state = await HttpLatencyClient(transport: transport).load()
        XCTAssertEqual(state, .ready([]))
    }

    func testForbiddenMapsToForbiddenState() async {
        let transport = StubTransport { _ in throw APIError.http(status: 403, body: nil, rawBody: nil) }
        let state = await HttpLatencyClient(transport: transport).load()
        XCTAssertEqual(state, .forbidden)
    }

    func testOtherFailuresMapToErrorState() async {
        let transport = StubTransport { _ in throw APIError.serviceUnavailable(nil) }
        let state = await HttpLatencyClient(transport: transport).load()
        XCTAssertEqual(state, .error("The server can't handle that right now."))
    }

    func testFormatMsUsesOneDecimalPlace() {
        XCTAssertEqual(HttpRouteLatency.formatMs(4.24), "4.2ms")
        XCTAssertEqual(HttpRouteLatency.formatMs(2), "2.0ms")
    }
}
