import Foundation
import PlayarrKit
import XCTest

final class SSEParserTests: XCTestCase {
    private func parse(_ text: String) -> [SSEFrame] {
        var parser = SSEParser()
        var splitter = SSELineSplitter()
        var frames: [SSEFrame] = []
        for byte in Array(text.utf8) {
            if let line = splitter.push(byte), let frame = parser.feed(line: line) {
                frames.append(frame)
            }
        }
        return frames
    }

    func testParsesFramesAndIgnoresHeartbeats() {
        let frames = parse(": heartbeat\n\nevent: ready\nid: 7\ndata: {\"seq\":7}\n\nevent: change\nid: 8\ndata: {\"a\":1}\n\n")
        XCTAssertEqual(frames.count, 2)
        XCTAssertEqual(frames[0], SSEFrame(event: "ready", id: "7", data: "{\"seq\":7}"))
        XCTAssertEqual(frames[1].id, "8")
    }

    func testHandlesCarriageReturnsAndMultilineData() {
        let frames = parse("event: change\r\ndata: one\r\ndata: two\r\n\r\n")
        XCTAssertEqual(frames, [SSEFrame(event: "change", id: nil, data: "one\ntwo")])
    }

    func testIdlessEmptyFrameDispatchesNothing() {
        XCTAssertTrue(parse("\n\n: only a comment\n\n").isEmpty)
    }
}

final class LiveEventMapperTests: XCTestCase {
    func testDecodesChangeFrame() {
        let frame = SSEFrame(
            event: "change",
            id: "9",
            data: #"{"seq":9,"type":"watch","entity":"work","id":"w1","changed":["progress"],"at":1000}"#
        )
        XCTAssertEqual(
            LiveEvent(frame: frame),
            .change(LiveChange(seq: 9, type: "watch", entity: "work", id: "w1", changed: ["progress"], at: 1000))
        )
    }

    func testUnknownAndMalformedFramesAreIgnored() {
        XCTAssertNil(LiveEvent(frame: SSEFrame(event: "mystery", id: nil, data: "{}")))
        XCTAssertNil(LiveEvent(frame: SSEFrame(event: "change", id: nil, data: "nope")))
    }

    func testWatchTouchesProgressAndHome() {
        let targets = LiveEventMapper.targets(for: LiveChange(seq: 1, type: "watch", entity: "work", id: "w1", changed: ["watched"]))
        XCTAssertEqual(targets, [LiveTarget(.work, id: "w1"), LiveTarget(.progress), LiveTarget(.home)])
    }

    func testBulkLibraryInvalidatesWholeAreas() {
        let targets = LiveEventMapper.targets(for: LiveChange(seq: 1, type: "library", entity: "*", changed: ["bulk"]))
        XCTAssertTrue(targets?.contains(LiveTarget(.library)) == true)
        XCTAssertTrue(targets?.contains(LiveTarget(.work)) == true)
        XCTAssertFalse(targets?.contains(where: { $0.id != nil }) == true)
    }

    func testUnknownTypeHasNoTargetsAndResyncIsEverything() {
        XCTAssertNil(LiveEventMapper.targets(for: LiveChange(seq: 1, type: "future", entity: "x", changed: [])))
        let resync = LiveEventMapper.invalidation(for: .resync(try! JSONDecoder().decode(LiveResync.self, from: Data(#"{"reason":"old","seq":3}"#.utf8))))
        XCTAssertEqual(resync?.everything, true)
        XCTAssertEqual(resync?.affectedAreas, Set(LiveArea.allCases))
    }
}

final class LiveBackoffTests: XCTestCase {
    func testDoublesAndCapsAtThirtySeconds() {
        XCTAssertEqual(LiveBackoff.delay(attempt: 1, random: 1), 1, accuracy: 0.0001)
        XCTAssertEqual(LiveBackoff.delay(attempt: 3, random: 1), 4, accuracy: 0.0001)
        XCTAssertEqual(LiveBackoff.delay(attempt: 12, random: 1), 30, accuracy: 0.0001)
        XCTAssertEqual(LiveBackoff.delay(attempt: 12, random: 0), 22.5, accuracy: 0.0001)
    }
}

private final class StreamTransport: PlayarrRequestTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [EventStreamResponse]
    private(set) var cursors: [Int64?] = []

    init(_ responses: [EventStreamResponse]) {
        self.responses = responses
    }

    func requestData(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Data?,
        expectedStatuses: Set<Int>
    ) async throws -> Data {
        Data()
    }

    func openEventStream(lastEventID: Int64?) async throws -> EventStreamResponse {
        lock.lock()
        defer { lock.unlock() }
        cursors.append(lastEventID)
        return responses.isEmpty ? EventStreamResponse(statusCode: 404, contentType: "text/html", lines: nil) : responses.removeFirst()
    }

    static func stream(_ lines: [String]) -> EventStreamResponse {
        EventStreamResponse(
            statusCode: 200,
            contentType: "text/event-stream; charset=utf-8",
            lines: AsyncThrowingStream { continuation in
                for line in lines { continuation.yield(line) }
                continuation.finish()
            }
        )
    }
}

private final class Collector: @unchecked Sendable {
    private let lock = NSLock()
    private var storedEvents: [LiveEvent] = []
    private var storedStates: [LiveConnectionState] = []

    func add(_ event: LiveEvent) {
        lock.lock()
        storedEvents.append(event)
        lock.unlock()
    }

    func add(_ state: LiveConnectionState) {
        lock.lock()
        storedStates.append(state)
        lock.unlock()
    }

    var events: [LiveEvent] {
        lock.lock()
        defer { lock.unlock() }
        return storedEvents
    }

    var states: [LiveConnectionState] {
        lock.lock()
        defer { lock.unlock() }
        return storedStates
    }
}

final class LiveEventsConnectionTests: XCTestCase {
    private let ready = ["event: ready", "id: 10", #"data: {"seq":10,"retention_ms":600000,"heartbeat_ms":15000,"max_age_ms":300000,"server_time_ms":1}"#, ""]
    private let change = ["event: change", "id: 11", #"data: {"seq":11,"type":"watch","entity":"work","id":"w1","changed":["progress"],"at":5}"#, ""]

    func testDeliversEventsResumesWithCursorThenStopsWhenUnsupported() async {
        let transport = StreamTransport([StreamTransport.stream(ready + change)])
        let collector = Collector()
        let connection = LiveEventsConnection(transport: transport, sleep: { _ in })
        await connection.run(
            onState: { collector.add($0) },
            onEvent: { collector.add($0) }
        )

        XCTAssertEqual(collector.events.count, 2)
        XCTAssertEqual(transport.cursors, [nil, 11])
        XCTAssertEqual(collector.states.last, .unsupported)
        XCTAssertTrue(collector.states.contains(.connected))
        XCTAssertTrue(collector.states.contains(.reconnecting))
    }

    func testNonEventStreamContentIsUnsupported() async {
        let html = EventStreamResponse(statusCode: 200, contentType: "text/html", lines: AsyncThrowingStream { $0.finish() })
        let transport = StreamTransport([html])
        let collector = Collector()
        await LiveEventsConnection(transport: transport, sleep: { _ in }).run(
            onState: { collector.add($0) },
            onEvent: { collector.add($0) }
        )
        XCTAssertEqual(collector.states, [.connecting, .unsupported])
        XCTAssertEqual(transport.cursors.count, 1)
    }
}

@MainActor
final class LiveEventsHubTests: XCTestCase {
    func testChangeBumpsOnlyAffectedAreas() {
        let hub = LiveEventsHub()
        hub.handle(.change(LiveChange(seq: 1, type: "playlist", entity: "playlist", id: "p", changed: ["items"])))
        XCTAssertEqual(hub.generation(of: .playlist), 1)
        XCTAssertEqual(hub.generation(of: .home), 0)
        XCTAssertEqual(hub.signature(of: [.playlist, .home]), 1)
    }

    func testResyncBumpsEverything() {
        let hub = LiveEventsHub()
        hub.handle(.resync(try! JSONDecoder().decode(LiveResync.self, from: Data(#"{"reason":"old","seq":3}"#.utf8))))
        XCTAssertTrue(LiveArea.allCases.allSatisfy { hub.generation(of: $0) == 1 })
    }

    func testReconnectCatchUpPolls() {
        let hub = LiveEventsHub()
        hub.setState(.reconnecting)
        hub.setState(.connected)
        XCTAssertEqual(hub.generation(of: .library), 1)
    }
}
