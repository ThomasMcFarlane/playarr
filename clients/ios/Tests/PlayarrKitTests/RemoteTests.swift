import Foundation
import PlayarrKit
import XCTest

final class RemoteTests: XCTestCase {
    func testTargetAndPairingDecode() throws {
        let target = try JSONDecoder().decode(
            RemoteTarget.self,
            from: Data(#"{"device_id":"d1","name":"Living room","platform":"tvos","capabilities":["playback"],"online":true,"is_self":false,"state":{"paused":true}}"#.utf8)
        )
        XCTAssertEqual(target.deviceID, "d1")
        XCTAssertEqual(target.state?["paused"], .bool(true))
        let pairing = try JSONDecoder().decode(
            RemotePairing.self,
            from: Data(#"{"id":"p","status":"pending","controller_device_id":"c","controller_name":"Phone","target_device_id":"d1","scopes":["playback"],"verification_code":"123456","created_ms":1,"expires_ms":2,"is_controller":true,"is_target":false}"#.utf8)
        )
        XCTAssertEqual(pairing.verificationCode, "123456")
        XCTAssertTrue(pairing.isController)
    }

    func testCommandBodiesMatchServerContract() async throws {
        let transport = StubTransport { _ in Data(#"{"command_id":"c1","seq":4}"#.utf8) }
        let client = RemoteClient(transport: transport)
        let accepted = try await client.send(RemoteCommand.navigate("down"), pairingID: "p1")
        XCTAssertEqual(accepted.seq, 4)
        _ = try await client.send(RemoteCommand.seekBy(milliseconds: -10_000), pairingID: "p1")
        XCTAssertEqual(transport.calls[0].path, "/api/v1/remote/pairings/p1/commands")
        let first = transport.calls[0].body ?? ""
        XCTAssertTrue(first.contains(#""kind":"navigate""#))
        XCTAssertTrue(first.contains(#""key":"down""#))
        let second = transport.calls[1].body ?? ""
        XCTAssertTrue(second.contains(#""delta_ms":-10000"#))
        XCTAssertTrue(second.contains(#""action":"seek_by""#))
    }

    func testVolumeIsClampedAndTextTruncated() {
        guard case .object(let volume) = RemoteCommand.volume(250).payload else { return XCTFail() }
        XCTAssertEqual(volume["level"], .int(100))
        let long = String(repeating: "a", count: 600)
        guard case .object(let text) = RemoteCommand.text(long).payload,
              case .string(let value)? = text["value"] else { return XCTFail() }
        XCTAssertEqual(value.count, 512)
    }

    func testIncomingCommandDecoding() throws {
        let nav = try JSONDecoder().decode(
            RemoteInboxEvent.self,
            from: Data(#"{"id":"e","seq":1,"kind":"command","pairing_id":"p","payload":{"kind":"navigate","args":{"key":"left"}}}"#.utf8)
        )
        XCTAssertEqual(RemoteIncomingCommand(event: nav), .navigate(key: "left"))
        let seek = try JSONDecoder().decode(
            RemoteInboxEvent.self,
            from: Data(#"{"id":"e","seq":2,"kind":"command","payload":{"kind":"playback","args":{"action":"seek","position_ms":5000}}}"#.utf8)
        )
        XCTAssertEqual(
            RemoteIncomingCommand(event: seek),
            .playback(action: "seek", positionMs: 5000, deltaMs: nil, level: nil, language: nil)
        )
        let odd = try JSONDecoder().decode(
            RemoteInboxEvent.self,
            from: Data(#"{"id":"e","seq":3,"kind":"command","payload":{"kind":"input","args":{}}}"#.utf8)
        )
        XCTAssertEqual(RemoteIncomingCommand(event: odd), .unsupported(kind: "input"))
    }

    func testInboxAndAckPaths() async throws {
        let transport = StubTransport { call in
            call.path.hasSuffix("/inbox") ? Data(#"{"events":[],"next":9}"#.utf8) : Data()
        }
        let client = RemoteClient(transport: transport)
        let inbox = try await client.inbox(after: 8, wait: 25)
        XCTAssertEqual(inbox.next, 9)
        try await client.ack(eventID: "e1", status: "ok")
        XCTAssertEqual(transport.calls[0].query, ["after=8", "wait=25"])
        XCTAssertEqual(transport.calls[1].path, "/api/v1/remote/events/e1/ack")
    }

    func testAdvertiserOnlyListsHonouredCapabilities() {
        XCTAssertEqual(
            RemoteCapabilityAdvertiser.advertised(canNavigate: false, canText: false, canControlPlayback: true, canHandOff: false),
            ["playback"]
        )
        XCTAssertEqual(
            RemoteCapabilityAdvertiser.advertised(canNavigate: false, canText: false, canControlPlayback: false, canHandOff: false),
            []
        )
    }

    func testRenamePairingUsesPatchWithName() async throws {
        let transport = StubTransport { _ in
            Data(#"{"id":"p1","status":"active","controller_device_id":"c","controller_name":"Kitchen","target_device_id":"d","scopes":["navigate"],"created_ms":1,"expires_ms":2,"is_controller":true,"is_target":false}"#.utf8)
        }
        let renamed = try await RemoteClient(transport: transport).renamePairing(id: "p1", name: "Kitchen")
        XCTAssertEqual(renamed.controllerName, "Kitchen")
        XCTAssertEqual(transport.calls[0].method, "PATCH")
        XCTAssertEqual(transport.calls[0].path, "/api/v1/remote/pairings/p1")
        XCTAssertEqual(transport.calls[0].body, #"{"name":"Kitchen"}"#)
    }

    func testCreatePairingOmitsScopesWhenNil() async throws {
        let transport = StubTransport { _ in
            Data(#"{"id":"p1","status":"pending","controller_device_id":"c","controller_name":"Phone","target_device_id":"d","scopes":[],"created_ms":1,"expires_ms":2}"#.utf8)
        }
        _ = try await RemoteClient(transport: transport).createPairing(targetDeviceID: "d", scopes: nil, controllerName: "Phone")
        let body = transport.calls[0].body ?? ""
        XCTAssertFalse(body.contains("scopes"))
        XCTAssertTrue(body.contains(#""target_device_id":"d""#))
        XCTAssertEqual(transport.calls[0].method, "POST")
    }

    func testStopAndReplaceTextPayloads() {
        XCTAssertEqual(RemoteCommand.stop().payload["action"], .string("stop"))
        XCTAssertEqual(RemoteCommand.text("ab", mode: "replace").payload["mode"], .string("replace"))
    }

    func testCommandStatusPath() async throws {
        let transport = StubTransport { _ in Data(#"{"command_id":"c1","status":"failed","detail":"nothing focused"}"#.utf8) }
        let status = try await RemoteClient(transport: transport).commandStatus(id: "c1")
        XCTAssertEqual(status.status, "failed")
        XCTAssertEqual(transport.calls[0].path, "/api/v1/remote/commands/c1")
    }
}
