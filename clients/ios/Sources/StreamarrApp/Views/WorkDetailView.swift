import StreamarrKit
import SwiftUI

struct WorkDetailView: View {
    let viewModel: WorkDetailViewModel
    let apiClient: StreamarrAPIClient

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: "Loading title…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load this title", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                if let detail = viewModel.detail { detailContent(detail) }
            }
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func detailContent(_ detail: WorkDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .bottomLeading) {
                    PlayarrArtwork(work: detail.work, kind: .backdrop, apiClient: apiClient)
                        .frame(height: 390)
                        .overlay {
                            LinearGradient(
                                colors: [.clear, PlayarrStyle.background.opacity(0.3), PlayarrStyle.background],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }

                    VStack(alignment: .leading, spacing: 10) {
                        Text(detail.work.kind.displayName.uppercased())
                            .font(.caption2.weight(.black))
                            .tracking(1.3)
                            .foregroundStyle(PlayarrStyle.pink)
                        Text(detail.work.title)
                            .font(.system(size: 42, weight: .medium, design: .rounded))
                            .tracking(-1.8)
                            .foregroundStyle(PlayarrStyle.ink)
                            .lineLimit(3)
                        if !detail.work.genres.isEmpty {
                            Text(detail.work.genres.prefix(3).joined(separator: "  •  "))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(PlayarrStyle.inkSoft)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 10)
                }

                VStack(alignment: .leading, spacing: 20) {
                    if let overview = detail.work.overview, !overview.isEmpty {
                        Text(overview)
                            .font(.subheadline)
                            .foregroundStyle(PlayarrStyle.inkSoft)
                            .lineSpacing(4)
                    }

                    if let mediaFileID = detail.mediaFileID {
                        NavigationLink {
                            PlayerView(
                                viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                                initialMediaFileID: mediaFileID.uuidString,
                                initialTitle: detail.work.title
                            )
                        } label: {
                            Label("Play", systemImage: "play.fill")
                                .frame(minWidth: 110)
                        }
                        .buttonStyle(PlayarrPrimaryButtonStyle())
                    }

                    children(for: detail.children)
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
                .padding(.bottom, 118)
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(PlayarrStyle.background)
    }

    @ViewBuilder
    private func children(for children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            VStack(alignment: .leading, spacing: 28) {
                ForEach(seasons, id: \.season.id) { season in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(PlayarrStyle.ink)
                        ForEach(season.episodes) { episode in
                            playableRow(
                                title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                                subtitle: "Episode \(episode.episode.episodeNumber)",
                                mediaFileID: episode.mediaFileID
                            )
                        }
                    }
                }
            }
        case .artist(let albums):
            VStack(alignment: .leading, spacing: 28) {
                ForEach(albums, id: \.album.id) { album in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(album.album.title)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(PlayarrStyle.ink)
                        ForEach(album.tracks) { track in
                            playableRow(
                                title: track.track.title,
                                subtitle: "Track \(track.track.trackNumber)",
                                mediaFileID: track.mediaFileID
                            )
                        }
                    }
                }
            }
        case .author(let books):
            VStack(alignment: .leading, spacing: 12) {
                Text("Books")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(PlayarrStyle.ink)
                ForEach(books) { book in
                    playableRow(title: book.book.title, subtitle: "Book", mediaFileID: book.mediaFileID)
                }
            }
        }
    }

    @ViewBuilder
    private func playableRow(title: String, subtitle: String, mediaFileID: UUID?) -> some View {
        if let mediaFileID {
            NavigationLink {
                PlayerView(
                    viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: title
                )
            } label: {
                rowLabel(title: title, subtitle: subtitle, playable: true)
            }
            .buttonStyle(.plain)
        } else {
            rowLabel(title: title, subtitle: subtitle, playable: false)
        }
    }

    private func rowLabel(title: String, subtitle: String, playable: Bool) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(playable ? PlayarrStyle.ink : PlayarrStyle.ink.opacity(0.22))
                Image(systemName: playable ? "play.fill" : "clock")
                    .foregroundStyle(.white)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(playable ? subtitle : "Not available yet")
                    .font(.caption)
                    .foregroundStyle(PlayarrStyle.muted)
            }
            Spacer()
            if playable {
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(PlayarrStyle.muted)
            }
        }
        .foregroundStyle(PlayarrStyle.ink)
        .padding(12)
        .background(PlayarrStyle.surface.opacity(0.78), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
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
