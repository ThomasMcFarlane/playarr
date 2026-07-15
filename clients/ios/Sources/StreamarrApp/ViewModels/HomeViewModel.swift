import Foundation
import Observation
import StreamarrKit

/// View model for `HomeView`. Follows the app's standard pattern: a
/// `@MainActor @Observable final class` that owns its own loaded state and
/// talks to `StreamarrAPIClient` (never `APIClient` concretely, and never
/// touches `URLSession` directly) so it's trivially testable against a
/// fake conformance.
///
/// Shows "Recently Added" via `GET /api/v1/catalog?sort=recent` — the real
/// spec has no continue-watching/playback-progress endpoint yet (only the
/// direct-play/transcode negotiation at `GET
/// /api/v1/playback/{media_file_id}`, which needs a `media_file_id` the
/// client already has in hand), so there's nothing real to back a
/// "Continue Watching" row with today.
@MainActor
@Observable
public final class HomeViewModel {
    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var recentlyAdded: [Work] = []

    private let apiClient: StreamarrAPIClient

    public init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    public func load() async {
        loadState = .loading
        do {
            let page = try await apiClient.browseCatalog(
                kind: nil,
                genre: nil,
                tag: nil,
                sort: "recent",
                limit: 20,
                offset: 0
            )
            recentlyAdded = page.items
            loadState = .loaded
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
