import XCTest
@testable import PlayarrKit

final class HostedDeviceLinkClientTests: XCTestCase {
    func testDecodesHostedLinkClaim() throws {
        let json = """
        {
          "user_code": "ABCD-2345",
          "server_url": "https://media.example.test:8484",
          "server_device_code": "server-device-code-at-least-16",
          "server_urls": ["https://media.example.test:8484", "http://192.168.1.10:8484"]
        }
        """.data(using: .utf8)!

        let claim = try PlayarrJSONCoding.makeDecoder().decode(HostedLinkClaim.self, from: json)
        XCTAssertEqual(claim.userCode, "ABCD-2345")
        XCTAssertEqual(claim.serverURL, "https://media.example.test:8484")
        XCTAssertEqual(claim.serverDeviceCode, "server-device-code-at-least-16")
        XCTAssertEqual(claim.serverURLs.count, 2)
    }

    func testQRImageURLEncodesVerificationTarget() throws {
        let url = try XCTUnwrap(
            HostedDeviceLinkClient.qrImageURL(
                for: "https://playarr.app/link?user_code=ABCD-2345"
            )
        )
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "playarr.app")
        XCTAssertEqual(url.path, "/api/link/qr")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(
            items?.first(where: { $0.name == "value" })?.value,
            "https://playarr.app/link?user_code=ABCD-2345"
        )
    }

    func testHostedCodeResponseMatchesDeviceCodeWireShape() throws {
        let json = """
        {
          "device_code": "ABCD2345.secret",
          "user_code": "ABCD-2345",
          "verification_uri": "https://playarr.app/link",
          "verification_uri_complete": "https://playarr.app/link?user_code=ABCD-2345",
          "expires_in": 600,
          "interval": 2
        }
        """.data(using: .utf8)!

        let code = try PlayarrJSONCoding.makeDecoder().decode(DeviceCodeResponse.self, from: json)
        XCTAssertEqual(code.userCode, "ABCD-2345")
        XCTAssertEqual(code.verificationUri, "https://playarr.app/link")
        XCTAssertEqual(code.interval, 2)
    }
}
