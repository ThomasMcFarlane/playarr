import Foundation
import PlayarrKit
import XCTest

/// In-memory `PlayarrRequestTransport` shared by every feature-client test.
final class StubTransport: PlayarrRequestTransport, @unchecked Sendable {
    struct Call: Equatable {
        var method: String
        var path: String
        var query: [String]
        var body: String?
    }

    private let lock = NSLock()
    private var recorded: [Call] = []
    var responder: @Sendable (Call) throws -> Data

    init(responder: @escaping @Sendable (Call) throws -> Data = { _ in Data("{}".utf8) }) {
        self.responder = responder
    }

    var calls: [Call] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func requestData(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Data?,
        expectedStatuses: Set<Int>
    ) async throws -> Data {
        let call = Call(
            method: method,
            path: path,
            query: query.map { "\($0.name)=\($0.value ?? "")" },
            body: body.map { String(decoding: $0, as: UTF8.self) }
        )
        lock.lock()
        recorded.append(call)
        lock.unlock()
        return try responder(call)
    }
}

final class FeatureTransportTests: XCTestCase {
    private struct Echo: Codable, Equatable {
        var name: String
    }

    func testGetJSONDecodesAndForwardsQuery() async throws {
        let transport = StubTransport { _ in Data(#"{"name":"alpha"}"#.utf8) }
        let value: Echo = try await transport.getJSON("/api/v1/example", query: [URLQueryItem(name: "lang", value: "en")])
        XCTAssertEqual(value, Echo(name: "alpha"))
        XCTAssertEqual(transport.calls, [.init(method: "GET", path: "/api/v1/example", query: ["lang=en"], body: nil)])
    }

    func testSendJSONEncodesBodyAndDecodesResponse() async throws {
        let transport = StubTransport { _ in Data(#"{"name":"beta"}"#.utf8) }
        let value: Echo = try await transport.sendJSON(method: "POST", "/api/v1/example", body: Echo(name: "in"))
        XCTAssertEqual(value.name, "beta")
        XCTAssertEqual(transport.calls.first?.method, "POST")
        XCTAssertEqual(transport.calls.first?.body, #"{"name":"in"}"#)
    }

    func testDecodingFailureMapsToAPIError() async {
        let transport = StubTransport { _ in Data("not json".utf8) }
        do {
            let _: Echo = try await transport.getJSON("/api/v1/example")
            XCTFail("expected a decoding error")
        } catch APIError.decoding {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }
}
