import StreamarrKit
import SwiftUI

/// Catalog detail screen — `GET /api/v1/catalog/{id}` via
/// `WorkDetailViewModel`. Renders the kind-specific tree (seasons/episodes,
/// albums/tracks, or books) the real API returns, wires each playable
/// leaf's real, resolved `media_file_id` straight into `PlayerView` when
/// one has synced (`WorkDetail.mediaFileID` for a movie's own leaf;
/// `EpisodeDetail`/`TrackDetail`/`BookDetail.mediaFileID` for a series'
/// episodes / an artist's tracks / an author's books), and offers a real
/// "Request" action (`POST /api/v1/requests`) for a `Work` that isn't
/// `.available` yet.
struct WorkDetailView: View {
    let viewModel: WorkDetailViewModel
    let apiClient: StreamarrAPIClient

    @Environment(AppEnvironment.self) private var environment

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

                        if detail.work.kind == .movie {
                            moviePlayRow(detail: detail)
                        }

                        if detail.work.availability != .available {
                            requestSection
                        }
                    }

                    childrenSection(for: detail.children)
                }
            } else {
                ContentUnavailableView("Not found", systemImage: "questionmark.folder")
            }
        }
    }

    // MARK: - Movie leaf ("Play" / real `media_file_id`)

    @ViewBuilder
    private func moviePlayRow(detail: WorkDetail) -> some View {
        if let mediaFileID = detail.mediaFileID {
            NavigationLink {
                PlayerView(
                    viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: detail.work.title
                )
            } label: {
                Label("Play", systemImage: "play.circle")
            }
        } else {
            Label("Not yet available to play", systemImage: "play.slash")
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Request action

    @ViewBuilder
    private var requestSection: some View {
        switch viewModel.requestState {
        case .none:
            Button {
                Task { await viewModel.requestWork(requestedBy: environment.localUserID) }
            } label: {
                Label("Request", systemImage: "plus.circle")
            }
        case .submitting:
            HStack(spacing: 8) {
                ProgressView()
                Text("Requesting…")
            }
            .foregroundStyle(.secondary)
        case .submitted(let request):
            Label("Requested (\(request.status.rawValue))", systemImage: "checkmark.circle")
                .foregroundStyle(.secondary)
        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    Task { await viewModel.requestWork(requestedBy: environment.localUserID) }
                } label: {
                    Label("Request", systemImage: "plus.circle")
                }
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Children tree

    @ViewBuilder
    private func childrenSection(for children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            ForEach(seasons, id: \.season.id) { seasonDetail in
                Section("Season \(seasonDetail.season.seasonNumber)") {
                    ForEach(seasonDetail.episodes) { episodeDetail in
                        episodeRow(episodeDetail)
                    }
                }
            }
        case .artist(let albums):
            ForEach(albums, id: \.album.id) { albumDetail in
                Section(albumDetail.album.title) {
                    ForEach(albumDetail.tracks) { trackDetail in
                        trackRow(trackDetail)
                    }
                }
            }
        case .author(let books):
            Section("Books") {
                ForEach(books) { bookDetail in
                    bookRow(bookDetail)
                }
            }
        }
    }

    @ViewBuilder
    private func episodeRow(_ episodeDetail: EpisodeDetail) -> some View {
        let episode = episodeDetail.episode
        if let mediaFileID = episodeDetail.mediaFileID {
            NavigationLink {
                PlayerView(
                    viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: episode.title ?? "Episode \(episode.episodeNumber)"
                )
            } label: {
                episodeLabel(episode)
            }
        } else {
            episodeLabel(episode)
        }
    }

    private func episodeLabel(_ episode: Episode) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(episode.title ?? "Episode \(episode.episodeNumber)")
            Text(episode.availability.rawValue)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func trackRow(_ trackDetail: TrackDetail) -> some View {
        let track = trackDetail.track
        if let mediaFileID = trackDetail.mediaFileID {
            NavigationLink {
                PlayerView(
                    viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: track.title
                )
            } label: {
                Text(track.title)
            }
        } else {
            Text(track.title)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func bookRow(_ bookDetail: BookDetail) -> some View {
        let book = bookDetail.book
        if let mediaFileID = bookDetail.mediaFileID {
            NavigationLink {
                PlayerView(
                    viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: book.title
                )
            } label: {
                bookLabel(book)
            }
        } else {
            bookLabel(book)
        }
    }

    private func bookLabel(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(book.title)
            Text(book.availability.rawValue)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    let environment = AppEnvironment()
    NavigationStack {
        WorkDetailView(
            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: UUID()),
            apiClient: apiClient
        )
    }
    .environment(environment)
}
