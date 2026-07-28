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
}
