import StreamarrKit
import SwiftUI

struct LibraryView: View {
    let viewModel: LibraryViewModel
    let apiClient: StreamarrAPIClient

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Library")
                .searchable(text: Binding(get: { viewModel.searchText }, set: { viewModel.searchText = $0 }))
                .onSubmit(of: .search) { Task { await viewModel.load() } }
                .onChange(of: viewModel.searchText) { _, newValue in
                    if newValue.isEmpty {
                        Task { await viewModel.load() }
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Menu {
                            Button("All Kinds") { viewModel.selectedKind = nil; Task { await viewModel.load() } }
                            ForEach(WorkKind.allCases, id: \.self) { kind in
                                Button(kind.rawValue.capitalized) {
                                    viewModel.selectedKind = kind
                                    Task { await viewModel.load() }
                                }
                            }
                        } label: {
                            Label("Filter", systemImage: "line.3.horizontal.decrease.circle")
                        }
                    }
                }
                .task {
                    if case .idle = viewModel.loadState {
                        await viewModel.load()
                    }
                }
                .refreshable {
                    await viewModel.load()
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.loadState {
        case .idle, .loading:
            ProgressView("Loading catalog…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView(
                "Couldn't load the catalog",
                systemImage: "exclamationmark.triangle",
                description: Text(message)
            )
        case .empty:
            ContentUnavailableView.search
        case .loaded:
            List(viewModel.works) { work in
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

#Preview {
    let apiClient = PreviewAPIClient()
    LibraryView(viewModel: LibraryViewModel(apiClient: apiClient), apiClient: apiClient)
}
