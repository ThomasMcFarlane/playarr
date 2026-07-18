import XCTest
@testable import PlayarrTV

final class TVServerAddressTests: XCTestCase {
    func testAddsHTTPToHostAndPort() {
        XCTAssertEqual(
            TVServerAddress.normalisedURL(from: "streamarr.local:8484")?.absoluteString,
            "http://streamarr.local:8484"
        )
    }

    func testPreservesHTTPSAndPath() {
        XCTAssertEqual(
            TVServerAddress.normalisedURL(from: "https://media.example.test/streamarr")?.absoluteString,
            "https://media.example.test/streamarr"
        )
    }

    func testTrimsWhitespace() {
        XCTAssertEqual(
            TVServerAddress.normalisedURL(from: "  http://streamarr.local  ")?.absoluteString,
            "http://streamarr.local"
        )
    }

    func testRejectsUnsupportedSchemes() {
        XCTAssertNil(TVServerAddress.normalisedURL(from: "ftp://streamarr.local"))
    }

    func testRejectsEmptyAddress() {
        XCTAssertNil(TVServerAddress.normalisedURL(from: "   "))
    }
}
