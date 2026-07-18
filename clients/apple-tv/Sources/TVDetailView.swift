import StreamarrKit
import SwiftUI

struct TVWorkDetailView: View {
    let work: Work
    let apiClient: StreamarrAPIClient
    @State private var viewModel: TVWorkDetailViewModel

    init(work: Work, apiClient: StreamarrAPIClient) {
        self.work = work
        self.apiClient = apiClient
        _viewModel = State(initialValue: TVWorkDetailViewModel(workID: work.id, apiClient: apiClient))
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading:
                ProgressView("Loading \(work.title)…")
            case .failed(let message):
                TVErrorView(title: "Couldn’t load this title", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                if let detail = viewModel.detail {
                    detailContent(detail)
                }
            }
        }
        .navigationTitle(work.title)
        .task {
            if viewModel.state == .idle { await viewModel.load() }
        }
    }

    private func detailContent(_ detail: WorkDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 36) {
                Text(detail.work.title)
                    .font(.largeTitle.bold())

                if let overview = detail.work.overview, !overview.isEmpty {
                    Text(overview)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 1100, alignment: .leading)
                }

                if detail.work.kind == .movie {
                    playbackButton(
                        mediaFileID: detail.mediaFileID,
                        title: detail.work.title,
                        label: "Play"
                    )
                }

                children(detail.children)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(70)
        }
    }

    @ViewBuilder
    private func children(_ children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            ForEach(seasons, id: \.season.id) { season in
                VStack(alignment: .leading, spacing: 20) {
                    Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                        .font(.title2.bold())
                    ForEach(season.episodes) { episode in
                        playbackButton(
                            mediaFileID: episode.mediaFileID,
                            title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                            label: "\(episode.episode.episodeNumber). \(episode.episode.title ?? "Episode")"
                        )
                    }
                }
            }
        case .artist(let albums):
            ForEach(albums, id: \.album.id) { album in
                VStack(alignment: .leading, spacing: 20) {
                    Text(album.album.title).font(.title2.bold())
                    ForEach(album.tracks) { track in
                        playbackButton(
                            mediaFileID: track.mediaFileID,
                            title: track.track.title,
                            label: "\(track.track.trackNumber). \(track.track.title)"
                        )
                    }
                }
            }
        case .author(let books):
            VStack(alignment: .leading, spacing: 20) {
                Text("Books").font(.title2.bold())
                ForEach(books) { book in
                    playbackButton(
                        mediaFileID: book.mediaFileID,
                        title: book.book.title,
                        label: book.book.title
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func playbackButton(mediaFileID: UUID?, title: String, label: String) -> some View {
        if let mediaFileID {
            NavigationLink {
                TVPlayerView(
                    mediaFileID: mediaFileID,
                    title: title,
                    apiClient: apiClient
                )
            } label: {
                Label(label, systemImage: "play.fill")
                    .frame(maxWidth: 900, alignment: .leading)
            }
            .buttonStyle(.borderedProminent)
        } else {
            Label("\(label) — unavailable", systemImage: "play.slash")
                .foregroundStyle(.secondary)
                .padding(.vertical, 10)
        }
    }
}
