import Foundation
import Observation
import PlayarrKit

/// View model for the catalog detail screen — `GET /api/v1/catalog/{id}`,
/// which returns the `Work` plus its full kind-specific tree
/// (seasons/episodes for a series, albums/tracks for an artist, books for
/// an author; nothing extra for a movie), plus the real, resolved
/// `media_file_id` for each playable leaf (`WorkDetail.mediaFileID` for a
/// movie's own leaf; `EpisodeDetail`/`TrackDetail`/`BookDetail.mediaFileID`
/// for series/artist/author children) — see `OpenAPISchemas.swift`'s
/// "Round D update" note for how that's wired now that the backend
/// actually resolves it (`MediaFileRepo::find_by_leaf`), which replaces
/// this screen's earlier `PlayerView`-manual-entry-only path (some sibling
/// Playarr clients' Round B passes worked around the missing cross-link by
/// reusing a movie `Work`'s own `id` as a stand-in `media_file_id`; this
/// client's Round B never did that — it left `PlayerView`'s ID field fully
/// manual instead — so there's no such substitution to remove here, only
/// the manual-only limitation itself, which `WorkDetailView` now replaces
/// with the real per-leaf id whenever one has synced).
@MainActor
@Observable
public final class WorkDetailViewModel {
    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var detail: WorkDetail?
    public private(set) var credits = WorkCredits(cast: [], crew: [])
    public private(set) var similarWorks: [Work] = []

    private let apiClient: PlayarrAPIClient
    public let workID: UUID

    public init(apiClient: PlayarrAPIClient, workID: UUID) {
        self.apiClient = apiClient
        self.workID = workID
    }

    public func load() async {
        loadState = .loading
        do {
            async let fetchedDetail = apiClient.fetchWork(id: workID)
            async let fetchedCredits = apiClient.fetchWorkCredits(id: workID)
            async let fetchedSimilar = apiClient.fetchSimilarWorks(id: workID, limit: 20)
            detail = try await fetchedDetail
            loadState = .loaded
            credits = (try? await fetchedCredits) ?? WorkCredits(cast: [], crew: [])
            similarWorks = (try? await fetchedSimilar) ?? []
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
