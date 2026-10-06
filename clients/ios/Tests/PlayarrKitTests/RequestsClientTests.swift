import Foundation
import PlayarrKit
import XCTest

final class RequestsClientTests: XCTestCase {
    private func row(status: String, mine: Bool, by: String?, note: String? = nil) -> String {
        let by = by.map { #""requested_by":"\#($0)","# } ?? ""
        let note = note.map { #""status_note":"\#($0)","# } ?? ""
        return """
        {"id":"\(UUID())","title":"Sample","kind":"movie","year":2021,"seasons":[],"status":"\(status)",\(note)\(by)"origin":"playarr","mine":\(mine),"systems":["radarr"],"created_at":"2026-01-01T00:00:00.500+00:00","updated_at":"2026-01-02T00:00:00Z"}
        """
    }

    func testListDecodesEveryStatusAndSendsNoQueryByDefault() async throws {
        let body = "[" + ["pending", "approved", "declined", "available", "failed"]
            .map { row(status: $0, mine: true, by: "Sam") }.joined(separator: ",") + "]"
        let transport = StubTransport { _ in Data(body.utf8) }

        let items = try await RequestsClient(transport: transport).list()

        XCTAssertEqual(items.map(\.status), RequestStatus.allCases)
        XCTAssertEqual(items.map(\.status.label), [
            "Waiting for approval", "Approved", "Declined", "Available", "Failed",
        ])
        XCTAssertEqual(transport.calls.first?.method, "GET")
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/requests")
        XCTAssertEqual(transport.calls.first?.query, [])
    }

    func testAdministratorListCanAskForEveryoneOrOnlyTheirOwn() async throws {
        let transport = StubTransport { _ in Data("[]".utf8) }
        let client = RequestsClient(transport: transport)
        _ = try await client.list(mine: false)
        _ = try await client.list(mine: true)
        XCTAssertEqual(transport.calls.map(\.query), [["mine=false"], ["mine=true"]])
    }

    func testRequesterLabelFollowsTheHouseholdRule() async throws {
        let body = "[" + [
            row(status: "pending", mine: true, by: "Sam"),
            row(status: "approved", mine: false, by: "Alex", note: "Searching"),
            row(status: "approved", mine: false, by: nil),
        ].joined(separator: ",") + "]"
        let transport = StubTransport { _ in Data(body.utf8) }

        let items = try await RequestsClient(transport: transport).list()

        XCTAssertEqual(items[0].requesterLabel, "Requested by you")
        XCTAssertEqual(items[1].requesterLabel, "Requested by Alex")
        XCTAssertEqual(items[1].statusNote, "Searching")
        XCTAssertNil(items[2].requesterLabel)
    }

    func testRequestPostsTheSnapshotAndReadsTheResult() async throws {
        let provider = UUID()
        let transport = StubTransport { _ in
            Data(#"{"status":"requested","provider_instance_id":"\#(provider)","request_status":"pending"}"#.utf8)
        }
        let snapshot = TitleSnapshot(kind: "movie", title: "Sample", year: 2021)

        let result = try await RequestsClient(transport: transport).request(snapshot)

        XCTAssertEqual(result.providerInstanceID, provider)
        XCTAssertEqual(result.requestStatus, .pending)
        XCTAssertNil(result.requestID)
        XCTAssertEqual(transport.calls.first?.method, "POST")
        XCTAssertEqual(transport.calls.first?.path, "/api/v1/discover/request")
        XCTAssertTrue(transport.calls.first?.body?.contains(#""title":"Sample""#) == true)
    }
}
