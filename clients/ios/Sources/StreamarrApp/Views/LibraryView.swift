import StreamarrKit
import SwiftUI

struct LibraryView: View {
    @State private var viewModel: LibraryViewModel
    let apiClient: StreamarrAPIClient
    let title: String

    init(kind: WorkKind?, apiClient: StreamarrAPIClient, title: String? = nil) {
        let viewModel = LibraryViewModel(apiClient: apiClient)
        viewModel.selectedKind = kind
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.title = title ?? kind?.displayName ?? "Search"
    }

    init(viewModel: LibraryViewModel, apiClient: StreamarrAPIClient) {
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.title = viewModel.selectedKind?.displayName ?? "Library"
    }

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: viewModel.searchText.isEmpty ? "Loading \(title.lowercased())…" : "Searching…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load \(title.lowercased())", message: message) {
                    Task { await viewModel.load() }
                }
            case .empty:
                emptyState
            case .loaded:
                libraryGrid
            }
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
        }
        .searchable(text: $viewModel.searchText, prompt: "Search your library")
        .onSubmit(of: .search) { Task { await viewModel.load() } }
        .onChange(of: viewModel.searchText) { _, newValue in
            if newValue.isEmpty { Task { await viewModel.load() } }
        }
        .navigationBarHidden(true)
    }

    private var libraryGrid: some View {
        GeometryReader { proxy in
            let minimum = proxy.size.width >= 700 ? CGFloat(170) : CGFloat(145)
            ScrollView {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: minimum), spacing: 12, alignment: .top)],
                    alignment: .leading,
                    spacing: 24
                ) {
                    ForEach(viewModel.works) { work in
                        NavigationLink {
                            WorkDetailView(
                                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                apiClient: apiClient
                            )
                        } label: {
                            PlayarrPosterCard(work: work, apiClient: apiClient)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 96)
                .padding(.bottom, 112)
            }
            .refreshable { await viewModel.load() }
            .scrollIndicators(.hidden)
            .overlay(alignment: .topLeading) {
                pageHeading
            }
        }
        .background(PlayarrStyle.background)
    }

    private var pageHeading: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 32, weight: .medium, design: .rounded))
                .tracking(-1.2)
                .foregroundStyle(PlayarrStyle.ink)
            if let total = viewModel.total {
                Text("\(total) titles")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
            }
        }
        .padding(.top, 54)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [PlayarrStyle.background, PlayarrStyle.background.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 106)
        )
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.searchText.isEmpty ? "Nothing here yet" : "No results")
                .font(.title3.weight(.bold))
            if !viewModel.searchText.isEmpty {
                Text("Try another title, artist, genre, or tag.")
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.inkSoft)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(PlayarrStyle.ink)
        .background(PlayarrStyle.background)
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack { LibraryView(kind: .movie, apiClient: apiClient) }
}
