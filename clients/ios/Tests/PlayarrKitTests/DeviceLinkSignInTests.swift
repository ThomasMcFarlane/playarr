import Foundation
import XCTest
@testable import PlayarrKit

private final class FakeBroker: HostedLinkBroker, @unchecked Sendable {
    private let lock = NSLock()
    private var codes = 0
    var claimResults: [Result<HostedLinkClaim, Error>]
    var codeError: Error?

    init(claimResults: [Result<HostedLinkClaim, Error>], codeError: Error? = nil) {
        self.claimResults = claimResults
        self.codeError = codeError
    }

    var codesRequested: Int {
        lock.lock(); defer { lock.unlock() }
        return codes
    }

    func requestCode() async throws -> DeviceCodeResponse {
        lock.lock()
        codes += 1
        let n = codes
        lock.unlock()
        if let codeError { throw codeError }
        return DeviceCodeResponse(
            deviceCode: "device-\(n)",
            userCode: "ABCD-234\(n)",
            verificationUri: "https://playarr.app/link",
            verificationUriComplete: "https://playarr.app/link?user_code=ABCD-234\(n)",
            expiresIn: 600,
            interval: 2
        )
    }

    func pollUntilClaim(_ code: DeviceCodeResponse, extraGrace: TimeInterval) async throws -> HostedLinkClaim {
        lock.lock()
        let next = claimResults.isEmpty ? nil : claimResults.removeFirst()
        lock.unlock()
        guard let next else { throw CancellationError() }
        return try next.get()
    }
}

private struct FakeAuthorizer: DeviceTokenPolling {
    var result: Result<TokenResponse, Error>
    func pollForToken(deviceCode: String, interval: TimeInterval, expiresIn: TimeInterval) async throws -> TokenResponse {
        try result.get()
    }
}

private final class StateLog: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [DeviceLinkSignInState] = []
    func add(_ state: DeviceLinkSignInState) {
        lock.lock(); items.append(state); lock.unlock()
    }
    var states: [DeviceLinkSignInState] {
        lock.lock(); defer { lock.unlock() }
        return items
    }
}

final class DeviceLinkSignInTests: XCTestCase {
    private let claim = HostedLinkClaim(
        userCode: "ABCD-2341",
        serverURL: "https://media.example.test:8484",
        serverDeviceCode: "server-device-code-at-least-16",
        serverURLs: ["https://media.example.test:8484", "http://192.0.2.10:8484"]
    )
    private let token = TokenResponse(accessToken: "a", tokenType: "Bearer", expiresIn: 900, refreshToken: "r")

    private func normalise(_ raw: String) -> URL? { URL(string: raw) }

    func testSuccessReturnsServerAndTokenWithDistinctAddresses() async throws {
        let log = StateLog()
        let broker = FakeBroker(claimResults: [.success(claim)])
        let result = try await DeviceLinkSignIn.run(
            broker: broker,
            makeAuthorizer: { _ in FakeAuthorizer(result: .success(self.token)) },
            normaliseServerURL: { self.normalise($0) },
            onState: { log.add($0) }
        )
        XCTAssertEqual(result.serverURL.absoluteString, "https://media.example.test:8484")
        XCTAssertEqual(result.serverURLs.count, 2)
        XCTAssertEqual(result.token.refreshToken, "r")
        XCTAssertEqual(log.states.first, .requestingCode)
        XCTAssertEqual(log.states.last, .finishing)
        XCTAssertTrue(log.states.contains { if case .awaitingApproval = $0 { return true } else { return false } })
    }

    func testExpiredCodeRenewsSilently() async throws {
        let broker = FakeBroker(claimResults: [.failure(HostedDeviceLinkError.expired), .success(claim)])
        _ = try await DeviceLinkSignIn.run(
            broker: broker,
            makeAuthorizer: { _ in FakeAuthorizer(result: .success(self.token)) },
            normaliseServerURL: { self.normalise($0) },
            onState: { _ in }
        )
        XCTAssertEqual(broker.codesRequested, 2)
    }

    func testRenewalBudgetSpentFailsAsExpired() async {
        let broker = FakeBroker(claimResults: [
            .failure(HostedDeviceLinkError.expired), .failure(HostedDeviceLinkError.expired), .failure(HostedDeviceLinkError.expired)
        ])
        let log = StateLog()
        do {
            _ = try await DeviceLinkSignIn.run(
                broker: broker,
                makeAuthorizer: { _ in FakeAuthorizer(result: .success(self.token)) },
                normaliseServerURL: { self.normalise($0) },
                maxRenewals: 1,
                onState: { log.add($0) }
            )
            XCTFail("expected failure")
        } catch {
            XCTAssertEqual(error as? DeviceLinkFailure, .expired)
        }
        XCTAssertEqual(log.states.last, .failed(.expired))
    }

    func testDenialFailsWithoutRenewing() async {
        let broker = FakeBroker(claimResults: [.success(claim)])
        do {
            _ = try await DeviceLinkSignIn.run(
                broker: broker,
                makeAuthorizer: { _ in FakeAuthorizer(result: .failure(DeviceFlowError.accessDenied)) },
                normaliseServerURL: { self.normalise($0) },
                onState: { _ in }
            )
            XCTFail("expected failure")
        } catch {
            XCTAssertEqual(error as? DeviceLinkFailure, .denied)
        }
        XCTAssertEqual(broker.codesRequested, 1)
    }

    func testNetworkFailureIsReported() async {
        let broker = FakeBroker(claimResults: [], codeError: HostedDeviceLinkError.transportMessage("offline"))
        do {
            _ = try await DeviceLinkSignIn.run(
                broker: broker,
                makeAuthorizer: { _ in FakeAuthorizer(result: .success(self.token)) },
                normaliseServerURL: { self.normalise($0) },
                onState: { _ in }
            )
            XCTFail("expected failure")
        } catch {
            XCTAssertEqual(error as? DeviceLinkFailure, .network("offline"))
        }
    }

    func testInvalidServerInClaimIsUnavailable() async {
        let broker = FakeBroker(claimResults: [.success(claim)])
        do {
            _ = try await DeviceLinkSignIn.run(
                broker: broker,
                makeAuthorizer: { _ in FakeAuthorizer(result: .success(self.token)) },
                normaliseServerURL: { _ in nil },
                onState: { _ in }
            )
            XCTFail("expected failure")
        } catch {
            guard case .unavailable? = error as? DeviceLinkFailure else {
                return XCTFail("unexpected \(error)")
            }
        }
    }

    func testCancellationPropagatesWithoutFailureState() async {
        let broker = FakeBroker(claimResults: [.failure(CancellationError())])
        let log = StateLog()
        do {
            _ = try await DeviceLinkSignIn.run(
                broker: broker,
                makeAuthorizer: { _ in FakeAuthorizer(result: .success(self.token)) },
                normaliseServerURL: { self.normalise($0) },
                onState: { log.add($0) }
            )
            XCTFail("expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertFalse(log.states.contains { if case .failed = $0 { return true } else { return false } })
    }
}
