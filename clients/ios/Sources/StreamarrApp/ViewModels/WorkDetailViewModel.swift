import Foundation
import Observation
import StreamarrKit

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

    /// State for the "Request" action (`POST /api/v1/requests`) offered by
    /// `WorkDetailView` for a `Work` that isn't `.available` yet.
    public enum RequestState: Equatable, Sendable {
        case none
        case submitting
        case submitted(MediaRequest)
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var detail: WorkDetail?
    public private(set) var requestState: RequestState = .none

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

    /// Submits a real `POST /api/v1/requests` for this screen's own `Work`
    /// — an `existing_work` target, since the work is already cataloged,
    /// just not (fully) `.available`. `requestedBy` is supplied by the
    /// caller (see `SubmitRequestBody.requestedBy`'s `TODO(auth)` note in
    /// the spec: there's no auth-extraction middleware yet, so the client
    /// has to supply the requesting user id directly — `WorkDetailView`
    /// sources it from `AppEnvironment.localUserID`).
    public func requestWork(requestedBy: UUID, note: String? = nil) async {
        guard let work = detail?.work else { return }
        requestState = .submitting
        do {
            let body = SubmitRequestBody(
                requestedBy: requestedBy,
                kind: work.kind,
                target: .existingWork(workID: work.id),
                note: note
            )
            let created = try await apiClient.submitRequest(body)
            requestState = .submitted(created)
        } catch let error as APIError {
            requestState = .failed(error.displayMessage)
        } catch {
            requestState = .failed(error.localizedDescription)
        }
    }
}
