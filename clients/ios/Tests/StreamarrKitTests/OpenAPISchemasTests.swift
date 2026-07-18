import Foundation
import StreamarrKit
import XCTest

final class OpenAPISchemasTests: XCTestCase {
    func testDecodesVersionCompatibilityUsingWireKeys() throws {
        let json = Data(
            """
            {
              "server_version": "0.9.0",
              "api_version": "v1",
              "build_sha": "abc1234",
              "compatibility": [
                {
                  "platform": "ios",
                  "latest_version": "1.4.0",
                  "min_supported_version": "1.2.0",
                  "deprecated_below": null,
                  "sunset": null
                }
              ]
            }
            """.utf8
        )

        let envelope = try JSONDecoder().decode(VersionEnvelope.self, from: json)

        XCTAssertEqual(envelope.serverVersion, "0.9.0")
        XCTAssertEqual(envelope.compatibility.first?.platform, .ios)
        XCTAssertEqual(envelope.compatibility.first?.minSupportedVersion, "1.2.0")
    }

    func testMovieChildrenRoundTripInServerRepresentation() throws {
        let encoded = try JSONEncoder().encode(WorkChildren.movie)
        XCTAssertEqual(String(decoding: encoded, as: UTF8.self), "\"Movie\"")

        let decoded = try JSONDecoder().decode(WorkChildren.self, from: encoded)
        guard case .movie = decoded else {
            return XCTFail("Expected a movie child payload")
        }
    }

    func testOtherExternalProviderRoundTripsAsTaggedObject() throws {
        let original = ExternalProvider.other("anidb")
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(ExternalProvider.self, from: encoded)

        XCTAssertEqual(decoded, original)
    }
}
