import StreamarrKit
import SwiftUI

struct TVHomeView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVHomeViewModel?

    var body: some View {
        Group {
            if let viewModel {
                homeContent(viewModel)
            } else {
                ProgressView("Connecting to Streamarr…")
            }
        }
        .navigationTitle("Playarr")
        .task(id: environment.serverURL) {
            let model = TVHomeViewModel(apiClient: environment.apiClient)
            viewModel = model
            await model.load()
        }
    }

    @ViewBuilder
    private func homeContent(_ viewModel: TVHomeViewModel) -> some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading your library…")
        case .failed(let message):
            TVErrorView(title: "Couldn’t load your library", message: message) {
                Task { await viewModel.load() }
            }
        case .loaded where viewModel.works.isEmpty:
            ContentUnavailableView(
                "Your library is empty",
                systemImage: "rectangle.stack",
                description: Text("Add media sources in Streamarr, then return here.")
            )
        case .loaded:
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 32) {
                    Text("Recently added")
                        .font(.title2.bold())

                    ScrollView(.horizontal) {
                        LazyHStack(spacing: 34) {
                            ForEach(viewModel.works) { work in
                                NavigationLink {
                                    TVWorkDetailView(work: work, apiClient: environment.apiClient)
                                } label: {
                                    TVWorkCard(work: work, apiClient: environment.apiClient)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.horizontal, 50)
                        .padding(.vertical, 38)
                    }
                    .scrollClipDisabled()
                }
                .padding(.horizontal, 70)
                .padding(.vertical, 42)
            }
        }
    }
}

struct TVSearchView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVSearchViewModel?

    var body: some View {
        VStack(spacing: 30) {
            if let viewModel {
                @Bindable var model = viewModel
                TextField("Search movies, series, music, or books", text: $model.query)
                    .onSubmit { Task { await model.search() } }

                searchResults(model)
            }
        }
        .padding(70)
        .navigationTitle("Search")
        .task(id: environment.serverURL) {
            viewModel = TVSearchViewModel(apiClient: environment.apiClient)
        }
    }

    @ViewBuilder
    private func searchResults(_ viewModel: TVSearchViewModel) -> some View {
        switch viewModel.state {
        case .idle:
            ContentUnavailableView("Search your library", systemImage: "magnifyingglass")
        case .loading:
            ProgressView("Searching…")
        case .failed(let message):
            TVErrorView(title: "Search failed", message: message) {
                Task { await viewModel.search() }
            }
        case .loaded where viewModel.results.isEmpty:
            ContentUnavailableView.search(text: viewModel.query)
        case .loaded:
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 35)], spacing: 44) {
                    ForEach(viewModel.results) { work in
                        NavigationLink {
                            TVWorkDetailView(work: work, apiClient: environment.apiClient)
                        } label: {
                            TVWorkCard(work: work, apiClient: environment.apiClient)
                        }
                        .buttonStyle(.card)
                    }
                }
                .padding(38)
            }
            .scrollClipDisabled()
        }
    }
}

struct TVWorkCard: View {
    let work: Work
    let apiClient: StreamarrAPIClient

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            AsyncImage(url: posterURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ZStack {
                        Color.white.opacity(0.08)
                        Image(systemName: "play.tv")
                            .font(.system(size: 54))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 250, height: 360)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

            Text(work.title)
                .font(.headline)
                .lineLimit(1)
            Text(work.kind.rawValue.capitalized)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(width: 250, alignment: .leading)
    }

    private var posterURL: URL? {
        guard let path = work.images.first(where: { $0.kind == .poster })?.url else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}

struct TVErrorView: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try again", action: retry)
        }
    }
}
