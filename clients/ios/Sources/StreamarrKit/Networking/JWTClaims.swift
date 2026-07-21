import Foundation

/// Decodes the `sub` claim out of a JWT access token's payload segment,
/// without verifying the signature -- this app already trusts the token
/// because it just received it over HTTPS from the server it's talking to
/// (via `POST /api/v1/auth/login` or the RFC 8628 device flow), so this is
/// purely reading back an id the client itself was just handed, not an
/// authorization decision. Never use this to *trust* a token from anywhere
/// else (e.g. one paste in from outside the app).
///
/// Kept in `StreamarrKit` (not `StreamarrApp`) since it's a pure,
/// UIKit-free JWT utility that a future tvOS target can reuse unchanged,
/// same rationale as everything else under `Networking/`.
public enum JWTClaims {
    private struct SubjectClaim: Decodable {
        let sub: String
    }

    private struct IssuerClaim: Decodable {
        let iss: String
    }

    /// Returns the token's `sub` claim as a `UUID`, or `nil` if the token
    /// isn't a well-formed three-segment JWT, its payload isn't valid
    /// base64url JSON, or `sub` isn't present/isn't a UUID string --
    /// callers should treat any of those as "unknown", not crash.
    public static func subject(ofAccessToken token: String) -> UUID? {
        let segments = token.split(separator: ".")
        guard segments.count == 3 else { return nil }

        guard let payloadData = base64URLDecode(String(segments[1])) else { return nil }
        guard let claims = try? JSONDecoder().decode(SubjectClaim.self, from: payloadData) else {
            return nil
        }
        return UUID(uuidString: claims.sub)
    }

    /// Returns the token's `iss` claim as a `UUID` -- the peer node that
    /// minted this access token, per `streamarr_auth::jwt`'s doc comment
    /// (`docs/architecture/peer-groups.md` §5.4): once a node is grouped,
    /// it signs tokens with `iss` set to its own `peer_id`; a standalone
    /// node's tokens carry its configured HS256 issuer string instead
    /// (e.g. `"streamarr"`), which doesn't parse as a `UUID` and so
    /// correctly returns `nil` here. `nil` also covers a malformed token
    /// (not three segments, payload not valid base64url JSON, `iss`
    /// missing) -- callers should treat any of those as "don't know which
    /// node issued this," not crash. No signature verification, same
    /// caveat as `subject(ofAccessToken:)`: a routing hint for "which
    /// remembered address belongs to this session's own node"
    /// (`sameNodeAddresses(in:peerNodeID:)` in `KnownServerGroup.swift`),
    /// never an authorization decision.
    public static func issuerPeerID(ofAccessToken token: String) -> UUID? {
        let segments = token.split(separator: ".")
        guard segments.count == 3 else { return nil }

        guard let payloadData = base64URLDecode(String(segments[1])) else { return nil }
        guard let claims = try? JSONDecoder().decode(IssuerClaim.self, from: payloadData) else {
            return nil
        }
        return UUID(uuidString: claims.iss)
    }

    private static func base64URLDecode(_ value: String) -> Data? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: base64)
    }
}
