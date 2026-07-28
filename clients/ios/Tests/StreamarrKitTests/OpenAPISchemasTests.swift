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

    func testDecodesACompatibilityRowForEveryClientPlatformWireName() throws {
        // Every ClientPlatform case this mirror knows about (it has no
        // streamarr-admin case at all -- that identifies the admin UI, not
        // a Playarr client, and never appears in a compatibility row). A
        // future case added to the server's enum but not this one would
        // make this decode throw DecodingError.dataCorrupted instead of
        // silently dropping the row.
        let platforms = ClientPlatform.allCases
        let compatibility = platforms
            .map { #"{"platform": "\#($0.rawValue)", "latest_version": "1.0.0", "min_supported_version": "1.0.0"}"# }
            .joined(separator: ",")
        let json = Data(
            """
            {
              "server_version": "0.9.0",
              "api_version": "v1",
              "compatibility": [\#(compatibility)]
            }
            """.utf8
        )

        let envelope = try JSONDecoder().decode(VersionEnvelope.self, from: json)

        XCTAssertEqual(Set(envelope.compatibility.map(\.platform)), Set(platforms))
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
