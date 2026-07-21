import Foundation
import StreamarrKit
import XCTest

/// `docs/architecture/peer-groups.md` §3.7/§6.4, this bug fix's own reasoning
/// (see `sameNodeAddresses(in:peerNodeID:)`'s doc comment in
/// `KnownServerGroup.swift`): refresh tokens are never synced across peer
/// nodes, so a refresh retry only makes sense against another address of the
/// *same* node that issued it. These tests exercise that filter directly, at
/// the pure-function level, separately from `AccessTokenCoordinator`'s own
/// integration tests in `APIClientAuthenticationTests.swift`.
final class KnownServerGroupTests: XCTestCase {
    private let nodeA = UUID(uuidString: "00000000-0000-0000-0000-0000000000AA")!
    private let nodeB = UUID(uuidString: "00000000-0000-0000-0000-0000000000BB")!

    func testSameNodeAddressesFiltersOutOtherPeersAddresses() {
        let group = KnownServerGroup(servers: [
            KnownServer(url: "https://a-primary.invalid", peerNodeID: nodeA),
            KnownServer(url: "https://a-alt.invalid", peerNodeID: nodeA),
            KnownServer(url: "https://b-primary.invalid", peerNodeID: nodeB),
        ])

        XCTAssertEqual(
            sameNodeAddresses(in: group, peerNodeID: nodeA),
            ["https://a-primary.invalid", "https://a-alt.invalid"]
        )
        XCTAssertEqual(sameNodeAddresses(in: group, peerNodeID: nodeB), ["https://b-primary.invalid"])
    }

    func testSameNodeAddressesPromotesLastGoodURLFirstWhenItBelongsToTheSameNode() {
        let group = KnownServerGroup(
            servers: [
                KnownServer(url: "https://a-primary.invalid", peerNodeID: nodeA),
                KnownServer(url: "https://a-alt.invalid", peerNodeID: nodeA),
            ],
            lastGoodURL: "https://a-alt.invalid"
        )

        XCTAssertEqual(
            sameNodeAddresses(in: group, peerNodeID: nodeA),
            ["https://a-alt.invalid", "https://a-primary.invalid"]
        )
    }

    func testSameNodeAddressesIgnoresLastGoodURLBelongingToADifferentNode() {
        let group = KnownServerGroup(
            servers: [
                KnownServer(url: "https://a-primary.invalid", peerNodeID: nodeA),
                KnownServer(url: "https://b-primary.invalid", peerNodeID: nodeB),
            ],
            lastGoodURL: "https://b-primary.invalid"
        )

        // b-primary is `lastGoodURL`, but it belongs to nodeB -- must not be
        // promoted (or even included) when resolving nodeA's candidates.
        XCTAssertEqual(sameNodeAddresses(in: group, peerNodeID: nodeA), ["https://a-primary.invalid"])
    }

    /// Inertness: a group remembered before the server attributed addresses
    /// to peer nodes (or merged from a bundle that never carried
    /// attribution) has every `peerNodeID` `nil`. `nil` never matches a real
    /// peer node id, so this degrades to an empty list -- fail-closed, never
    /// "everything."
    func testSameNodeAddressesIsEmptyWhenNoAddressCarriesAttribution() {
        let group = KnownServerGroup(servers: [
            KnownServer(url: "https://a-primary.invalid"),
            KnownServer(url: "https://a-alt.invalid"),
        ])

        XCTAssertEqual(sameNodeAddresses(in: group, peerNodeID: nodeA), [])
    }

    func testMergingAttributesEachAddressToItsOwnPeerNodeFromTheBundle() {
        let bundle = PeerAddressBundle(
            groupID: UUID(),
            groupName: "Home Group",
            addresses: [
                PeerAddressEntry(peerNodeID: nodeA, url: "https://a-primary.invalid"),
                PeerAddressEntry(peerNodeID: nodeB, url: "https://b-primary.invalid"),
            ]
        )

        let merged = KnownServerGroup.merging(bundle, successfulURL: "https://a-primary.invalid", into: nil)

        XCTAssertEqual(merged.servers.first(where: { $0.url == "https://a-primary.invalid" })?.peerNodeID, nodeA)
        XCTAssertEqual(merged.servers.first(where: { $0.url == "https://b-primary.invalid" })?.peerNodeID, nodeB)
    }
}
