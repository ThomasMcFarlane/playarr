import StreamarrKit
import SwiftUI

/// Request-management screen — `GET /api/v1/requests` via
/// `RequestsViewModel`, with real `POST .../{id}/approve` /
/// `.../{id}/reject` actions for admins. Shows either "My Requests"
/// (regular users) or the admin "Pending Approval" queue, depending on
/// `AppEnvironment.isAdminMode` — see `RequestsViewModel`'s doc comment for
/// how that's decided today, absent a real role model server-side.
struct RequestsView: View {
    let viewModel: RequestsViewModel

    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(viewModel.isAdmin ? "Pending Requests" : "My Requests")
                .task {
                    if case .idle = viewModel.loadState {
                        await viewModel.load(currentUserID: environment.localUserID, isAdmin: environment.isAdminMode)
                    }
                }
                .refreshable {
                    await viewModel.load(currentUserID: environment.localUserID, isAdmin: environment.isAdminMode)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.loadState {
        case .idle, .loading:
            ProgressView("Loading requests…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView(
                "Couldn't load requests",
                systemImage: "exclamationmark.triangle",
                description: Text(message)
            )
        case .empty:
            ContentUnavailableView(
                viewModel.isAdmin ? "No pending requests" : "You haven't requested anything",
                systemImage: "tray"
            )
        case .loaded:
            List {
                if let actionErrorMessage = viewModel.actionErrorMessage {
                    Section {
                        Text(actionErrorMessage).foregroundStyle(.red)
                    }
                }
                ForEach(viewModel.requests) { request in
                    RequestRow(
                        request: request,
                        isAdmin: viewModel.isAdmin,
                        isDeciding: viewModel.decidingRequestIDs.contains(request.id),
                        onApprove: { Task { await viewModel.approve(request) } },
                        onReject: { Task { await viewModel.reject(request) } }
                    )
                }
            }
        }
    }
}

private struct RequestRow: View {
    let request: MediaRequest
    let isAdmin: Bool
    let isDeciding: Bool
    let onApprove: () -> Void
    let onReject: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.body)
            Text("\(request.kind.rawValue.capitalized) · \(request.status.rawValue.capitalized)")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let note = request.note, !note.isEmpty {
                Text(note)
                    .font(.caption)
            }

            if isAdmin, request.status == .pending {
                if isDeciding {
                    ProgressView()
                } else {
                    HStack {
                        Button("Approve", action: onApprove)
                            .buttonStyle(.borderedProminent)
                        Button("Reject", role: .destructive, action: onReject)
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    /// The real `MediaRequestSchema` doesn't embed a resolved catalog
    /// title for `existing_work` targets (only `work_id`) — a real
    /// limitation of the current spec, not a client-side placeholder; a
    /// future pass could resolve it via `GET /api/v1/catalog/{id}` if this
    /// screen needs the actual title.
    private var title: String {
        switch request.target {
        case .existingWork(let workID):
            return "Catalog item \(workID.uuidString.prefix(8))…"
        case .external(let ref):
            return "\(Self.providerDisplayName(ref.provider)) · \(ref.externalID)"
        }
    }

    private static func providerDisplayName(_ provider: ExternalProvider) -> String {
        switch provider {
        case .tmdb: return "TMDB"
        case .tvdb: return "TheTVDB"
        case .imdb: return "IMDb"
        case .musicBrainzArtist: return "MusicBrainz Artist"
        case .musicBrainzReleaseGroup: return "MusicBrainz Release Group"
        case .goodreads: return "Goodreads"
        case .isbn: return "ISBN"
        case .asin: return "ASIN"
        case .other(let value): return value
        }
    }
}

#Preview {
    let environment = AppEnvironment()
    RequestsView(viewModel: RequestsViewModel(apiClient: environment.apiClient))
        .environment(environment)
}
