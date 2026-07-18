@testable import StreamarrApp
import XCTest

final class LoginServerURLTests: XCTestCase {
    @MainActor
    func testInteractiveServerChangeKeepsTheLoginScreenActive() async {
        let suiteName = "LoginServerURLTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(
            "https://initial-\(UUID().uuidString.lowercased()).example.test",
            forKey: AppEnvironment.serverBaseURLDefaultsKey
        )
        let environment = AppEnvironment(userDefaults: defaults)

        await environment.restoreSessionState()
        XCTAssertEqual(environment.sessionState, .signedOut)

        let selectedServer = URL(string: "http://192.168.1.20:8484")!
        environment.prepareServerForSignIn(selectedServer)

        XCTAssertEqual(environment.sessionState, .signedOut)
        XCTAssertEqual(environment.serverBaseURL, selectedServer)
        XCTAssertEqual(environment.apiClient.baseURL, selectedServer)
    }

    func testCanonicalisesAbsoluteURLAndTrailingSlashes() throws {
        XCTAssertEqual(
            try LoginServerURL.normalise(" https://media.example.test/streamarr/// ").absoluteString,
            "https://media.example.test/streamarr"
        )
    }

    func testPublicIPv4FormsUseSecureDirectRelay() throws {
        for value in [
            "11.22.33.44",
            "11.22.33.44:8080",
            "http://11.22.33.44",
            "https://11.22.33.44:9443",
            "//11.22.33.44:8080",
            "v4-11-22-33-44.relay.playarr.app",
        ] {
            XCTAssertEqual(
                try LoginServerURL.normalise(value).absoluteString,
                "https://v4-11-22-33-44.relay.playarr.app:8484"
            )
        }
    }

    func testPrivateLANAddressRemainsDirect() throws {
        XCTAssertEqual(
            try LoginServerURL.normalise("http://192.168.1.20:8484").absoluteString,
            "http://192.168.1.20:8484"
        )
    }

    func testRejectsValuesRejectedByWebPlayarr() {
        for value in [
            "",
            "192.168.1.20:8484",
            "/streamarr",
            "file:///tmp/streamarr",
            "https://user:secret@example.test",
            "https://user:secret@11.22.33.44",
            "https://example.test?server=one",
            "https://example.test/#login",
        ] {
            XCTAssertThrowsError(try LoginServerURL.normalise(value), value)
        }
    }
}
