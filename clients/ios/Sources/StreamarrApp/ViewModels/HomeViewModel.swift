import Foundation
import Observation
import StreamarrKit

/// View model for `HomeView`. Follows the app's standard pattern: a
/// `@MainActor @Observable final class` that owns its own loaded state and
/// talks to `StreamarrAPIClient` (never `APIClient` concretely, and never
/// touches `URLSession` directly) so it's trivially testable against a
/// fake conformance.
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
    public private(set) var continueWatching: [PlaybackSession] = []
    public private(set) var recentlyAdded: [Work] = []

    private let apiClient: StreamarrAPIClient

    public init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    public func load() async {
        loadState = .loading
        do {
            async let continueWatchingTask = apiClient.fetchContinueWatching(limit: 10)
            async let recentlyAddedTask = apiClient.fetchWorks(libraryID: nil, page: 1, pageSize: 20)
            continueWatching = try await continueWatchingTask
            recentlyAdded = try await recentlyAddedTask
            loadState = .loaded
        } catch {
            loadState = .failed(String(describing: error))
        }
    }
}
