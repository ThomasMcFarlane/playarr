import Foundation
import Observation
import StreamarrKit

/// View model for the request-management screen — `GET /api/v1/requests`,
/// plus `POST /api/v1/requests/{id}/approve` and `.../reject` for admins.
///
/// Per the real spec (`list_requests_handler`'s doc comment in
/// `backend/openapi/streamarr.yaml`), the *same* endpoint serves two
/// different views depending on whether `user_id` is supplied:
///   - `user_id` set → that user's own requests, any status ("My Requests")
///   - `user_id` absent → every request still `Pending` an admin decision
///     ("Pending Approval" queue)
/// `isAdmin` (set on every `load(currentUserID:isAdmin:)` call, not fixed
/// at `init`, so a `SettingsView` toggle takes effect on next
/// load/pull-to-refresh) picks which of those this view model asks for,
/// and whether `approve(_:)`/`reject(_:)` are allowed to do anything.
///
/// NOTE on `isAdmin`/`currentUserID` (updated for Round E): approve/reject
/// are now real, authenticated calls — the server derives `decided_by` from
/// the caller's verified access token and independently enforces admin
/// access (403 if the token isn't an admin's), so `DecideRequestBody` no
/// longer carries a client-supplied id at all. `isAdmin`/`currentUserID`
/// here are still both supplied by the caller from `AppEnvironment`'s
/// local, `UserDefaults`-backed placeholders (`localUserID`, `isAdminMode`)
/// rather than a real signed-in identity/role claim, but their remaining
/// job is narrower than before: `currentUserID` only picks which slice of
/// `GET /api/v1/requests` to ask for (that endpoint stays
/// unauthenticated/query-driven per the current spec), and `isAdmin` only
/// gates whether this view model even attempts approve/reject client-side
/// — the server's own 403 is what actually enforces it now. See
/// `AppEnvironment.localUserID`/`.isAdminMode`'s doc comments.
@MainActor
@Observable
public final class RequestsViewModel {
    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case empty
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var requests: [MediaRequest] = []
    /// Request ids currently mid-approve/reject, so the row can show a
    /// spinner and `approve`/`reject` can no-op on a duplicate tap.
    public private(set) var decidingRequestIDs: Set<UUID> = []
    public private(set) var actionErrorMessage: String?
    public private(set) var isAdmin = false
    public private(set) var currentUserID: UUID?

    private let apiClient: StreamarrAPIClient

    public init(apiClient: StreamarrAPIClient) {
        self.apiClient = apiClient
    }

    /// Loads (or reloads) the list for `currentUserID`/`isAdmin` — see this
    /// type's doc comment for how those two values pick which of the two
    /// real `GET /api/v1/requests` views comes back.
    public func load(currentUserID: UUID, isAdmin: Bool) async {
        self.currentUserID = currentUserID
        self.isAdmin = isAdmin
        loadState = .loading
        do {
            requests = try await apiClient.listRequests(userID: isAdmin ? nil : currentUserID)
            loadState = requests.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    /// `POST /api/v1/requests/{id}/approve`. No-ops (rather than throwing)
    /// when `isAdmin` is `false` — the UI shouldn't be offering this action
    /// to a non-admin in the first place. This is a client-side courtesy,
    /// not the real enforcement: the server independently checks the
    /// caller's verified access token and returns `403` if it isn't an
    /// admin's, regardless of what this local guard does.
    public func approve(_ request: MediaRequest) async {
        await decide(request) { [apiClient] id, body in
            try await apiClient.approveRequest(id: id, body: body)
        }
    }

    /// `POST /api/v1/requests/{id}/reject`.
    public func reject(_ request: MediaRequest) async {
        await decide(request) { [apiClient] id, body in
            try await apiClient.rejectRequest(id: id, body: body)
        }
    }

    // MARK: - Private

    private func decide(
        _ request: MediaRequest,
        _ action: (UUID, DecideRequestBody) async throws -> MediaRequest
    ) async {
        guard isAdmin, !decidingRequestIDs.contains(request.id) else { return }
        decidingRequestIDs.insert(request.id)
        actionErrorMessage = nil
        defer { decidingRequestIDs.remove(request.id) }
        do {
            let updated = try await action(request.id, DecideRequestBody())
            apply(updated)
        } catch let error as APIError {
            actionErrorMessage = error.displayMessage
        } catch {
            actionErrorMessage = error.localizedDescription
        }
    }

    /// Folds a decided request back into `requests`. In the admin "Pending"
    /// view (`isAdmin == true`, `user_id`-less query) a decided request is
    /// no longer `Pending`, so it's removed rather than updated in place —
    /// matching what a reload of that same query would return — rather
    /// than left showing a now-stale `Pending` row until the next
    /// pull-to-refresh.
    private func apply(_ updated: MediaRequest) {
        guard let index = requests.firstIndex(where: { $0.id == updated.id }) else { return }
        if isAdmin {
            requests.remove(at: index)
            if requests.isEmpty { loadState = .empty }
        } else {
            requests[index] = updated
        }
    }
}
