import StreamarrKit
import SwiftUI

struct HomeView: View {
    let viewModel: HomeViewModel
    let apiClient: StreamarrAPIClient

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Home")
                .task { await viewModel.load() }
                .refreshable { await viewModel.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.loadState {
        case .idle, .loading:
            ProgressView("Loading your library…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView(
                "Couldn't load Home",
                systemImage: "exclamationmark.triangle",
                description: Text(message)
            )
        case .loaded:
            List {
                Section("Recently Added") {
                    if viewModel.recentlyAdded.isEmpty {
                        Text("Nothing here yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(viewModel.recentlyAdded) { work in
                            NavigationLink {
                                WorkDetailView(
                                    viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                    apiClient: apiClient
                                )
                            } label: {
                                WorkRow(work: work)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Shared list-row layout for a `Work`, used by both `HomeView` and
/// `LibraryView`.
struct WorkRow: View {
    let work: Work

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(work.title)
                .font(.body)
            Text(work.kind.rawValue.capitalized + " · " + work.availability.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    HomeView(viewModel: HomeViewModel(apiClient: apiClient), apiClient: apiClient)
}
