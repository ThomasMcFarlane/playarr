import Foundation
import Observation
import StreamarrKit

/// View model for the catalog detail screen — `GET /api/v1/catalog/{id}`,
/// which returns the `Work` plus its full kind-specific tree
/// (seasons/episodes for a series, albums/tracks for an artist, books for
/// an author; nothing extra for a movie).
///
/// NOTE on playback: none of `Episode`/`Track`/`Book` (nor `Work` itself)
/// carry a `media_file_id` anywhere in the current OpenAPI spec — the
/// catalog and playback-negotiation (`GET
/// /api/v1/playback/{media_file_id}`) parts of the API aren't cross-linked
/// yet (there's no `MediaFileRepo` in `streamarr-db` yet either; see
/// `streamarr-api/src/playback.rs`'s doc comment). So this screen can only
/// hand `PlayerView` a `media_file_id` the caller already has some other
/// way of knowing (e.g. typed in for now) — see `PlayerView`'s manual
/// entry field. That's a real gap in the current backend surface, not a
/// client-side placeholder.
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

    private let apiClient: StreamarrAPIClient
    public let workID: UUID

    public init(apiClient: StreamarrAPIClient, workID: UUID) {
        self.apiClient = apiClient
        self.workID = workID
    }

    public func load() async {
        loadState = .loading
        do {
            detail = try await apiClient.fetchWork(id: workID)
            loadState = .loaded
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
