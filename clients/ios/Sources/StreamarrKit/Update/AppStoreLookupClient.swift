import Foundation

/// Secondary, **display-only** "what's the latest published version" source
/// — Apple's public iTunes Lookup API
/// (`https://itunes.apple.com/lookup?bundleId=...`). Per the architecture
/// plan (`docs/architecture/clients/ios.md`), this is explicitly *not* the
/// enforcement source of truth: `GET /api/system/version`
/// (`AppUpdateEvaluator`, backed by `StreamarrAPIClient.fetchVersion()`) is.
/// This exists only so the app can optionally surface "such-and-such
/// version is on the App Store" without that depending on the
/// operator-run server's config being kept perfectly in sync with what
/// Apple actually shipped.
///
/// This hits a public, unauthenticated, third-party endpoint outside
/// Streamarr's own infrastructure — callers are expected to throttle calls
/// to roughly once a day (see `StreamarrApp`'s `UpdateViewModel`, which
/// does exactly that) rather than calling this on every foreground.
public struct AppStoreLookupClient: Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public enum LookupError: Error, Sendable {
        case invalidBundleID
        case invalidResponse
        /// The lookup returned zero results — e.g. the app isn't published
        /// under this bundle id yet.
        case notFound
        case transport(Error)
        case decoding(Error)
    }

    /// Returns the `version` string of the first (and normally only)
    /// lookup result for `bundleID`.
    public func lookupLatestVersion(bundleID: String) async throws -> String {
        guard !bundleID.isEmpty else { throw LookupError.invalidBundleID }

        var components = URLComponents(string: "https://itunes.apple.com/lookup")
        components?.queryItems = [URLQueryItem(name: "bundleId", value: bundleID)]
        guard let url = components?.url else { throw LookupError.invalidBundleID }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            throw LookupError.transport(error)
        }

        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw LookupError.invalidResponse
        }

        do {
            let decoded = try JSONDecoder().decode(LookupResponse.self, from: data)
            guard let version = decoded.results.first?.version else {
                throw LookupError.notFound
            }
            return version
        } catch let error as LookupError {
            throw error
        } catch {
            throw LookupError.decoding(error)
        }
    }

    struct LookupResponse: Decodable {
        var results: [LookupResult]
    }

    struct LookupResult: Decodable {
        var version: String
    }
}
