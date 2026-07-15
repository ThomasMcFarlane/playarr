import StreamarrKit
import SwiftUI

/// Catalog detail screen — `GET /api/v1/catalog/{id}` via
/// `WorkDetailViewModel`. Renders the kind-specific tree (seasons/episodes,
/// albums/tracks, or books) the real API returns, and offers a "Play"
/// entry point into `PlayerView` for anything that could plausibly be
/// played.
///
/// See `WorkDetailViewModel`'s doc comment for why "Play" can't jump
/// straight to a real `media_file_id` yet — the spec doesn't cross-link
/// catalog entities to media files today, so `PlayerView` asks for one
/// directly.
struct WorkDetailView: View {
    let viewModel: WorkDetailViewModel
    let apiClient: StreamarrAPIClient

    var body: some View {
        content
            .navigationTitle(viewModel.detail?.work.title ?? "Detail")
            .task {
                if case .idle = viewModel.loadState {
                    await viewModel.load()
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.loadState {
        case .idle, .loading:
            ProgressView("Loading…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView(
                "Couldn't load this title",
                systemImage: "exclamationmark.triangle",
                description: Text(message)
            )
        case .loaded:
            if let detail = viewModel.detail {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(detail.work.title).font(.title2.bold())
                            if let overview = detail.work.overview, !overview.isEmpty {
                                Text(overview).font(.body)
                            }
                            Text("Availability: \(detail.work.availability.rawValue)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        NavigationLink {
                            PlayerView(
                                viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                                initialTitle: detail.work.title
                            )
                        } label: {
                            Label("Play…", systemImage: "play.circle")
                        }
                    }

                    childrenSection(for: detail.children)
                }
            } else {
                ContentUnavailableView("Not found", systemImage: "questionmark.folder")
            }
        }
    }

    @ViewBuilder
    private func childrenSection(for children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            ForEach(seasons, id: \.season.id) { seasonDetail in
                Section("Season \(seasonDetail.season.seasonNumber)") {
                    ForEach(seasonDetail.episodes) { episode in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(episode.title ?? "Episode \(episode.episodeNumber)")
                            Text(episode.availability.rawValue)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        case .artist(let albums):
            ForEach(albums, id: \.album.id) { albumDetail in
                Section(albumDetail.album.title) {
                    ForEach(albumDetail.tracks) { track in
                        Text(track.title)
                    }
                }
            }
        case .author(let books):
            Section("Books") {
                ForEach(books) { book in
                    Text(book.title)
                }
            }
        }
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        WorkDetailView(
            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: UUID()),
            apiClient: apiClient
        )
    }
}
