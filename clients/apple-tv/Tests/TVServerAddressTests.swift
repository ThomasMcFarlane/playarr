import XCTest
@testable import PlayarrTV

final class TVServerAddressTests: XCTestCase {
    func testAddsHTTPToHostAndPort() {
        XCTAssertEqual(
            TVServerAddress.normalisedURL(from: "playarr.local:8484")?.absoluteString,
            "http://playarr.local:8484"
        )
    }

    func testPreservesHTTPSAndPath() {
        XCTAssertEqual(
            TVServerAddress.normalisedURL(from: "https://media.example.test/playarr")?.absoluteString,
            "https://media.example.test/playarr"
        )
    }

    func testTrimsWhitespace() {
        XCTAssertEqual(
            TVServerAddress.normalisedURL(from: "  http://playarr.local  ")?.absoluteString,
            "http://playarr.local"
        )
    }

    func testRejectsUnsupportedSchemes() {
        XCTAssertNil(TVServerAddress.normalisedURL(from: "ftp://playarr.local"))
    }

    func testRejectsEmptyAddress() {
        XCTAssertNil(TVServerAddress.normalisedURL(from: "   "))
    }

    func testFirstLaunchUsesHostedDeviceLink() {
        XCTAssertTrue(TVAppEnvironment.shouldUseHostedDeviceLink(hasConfiguredServer: false))
    }

    func testRememberedServerStillUsesHostedGateForAppLinkQR() {
        // A stored relay/server URL must not take over the pairing chrome —
        // QR + "visit" always come from playarr.app/link.
        XCTAssertTrue(TVAppEnvironment.shouldUseHostedDeviceLink(hasConfiguredServer: true))
    }

    func testDisplayVerificationURIIsAlwaysPlayarrAppLink() {
        XCTAssertEqual(
            TVPairingGateView.displayVerificationURI(
                "https://v4-1-2-3-4.relay.playarr.app:8484/link"
            ),
            "https://playarr.app/link"
        )
        XCTAssertEqual(
            TVPairingGateView.displayVerificationURI("https://playarr.app/link?user_code=X"),
            "https://playarr.app/link"
        )
    }
}

