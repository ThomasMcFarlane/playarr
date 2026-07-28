import PlayarrKit
import SwiftUI

struct TVWorkDetailView: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    @State private var viewModel: TVWorkDetailViewModel

    init(work: Work, apiClient: PlayarrAPIClient) {
        self.work = work
        self.apiClient = apiClient
        _viewModel = State(initialValue: TVWorkDetailViewModel(workID: work.id, apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            TVStageBackground()
            Group {
                switch viewModel.state {
                case .idle, .loading:
                    ProgressView("Loading \(work.title)…")
                        .tint(DesignTokens.Color.brandPrimary)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
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
        }
        .navigationTitle(work.title)
        .task {
            if viewModel.state == .idle { await viewModel.load() }
        }
    }

    /// Full-bleed backdrop + synopsis + Play/Back actions matching ui-tv `DetailScreen`.
    private func detailContent(_ detail: WorkDetail) -> some View {
        let backdropURL = backdropURL(for: detail.work)

        return ScrollView {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: backdropURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(minWidth: TVTheme.canvasWidth, minHeight: 600)
                            .clipped()
                    default:
                        DesignTokens.Color.backgroundBase
                            .frame(minHeight: 600)
                    }
                }
                .overlay {
                    LinearGradient(
                        colors: [
                            .clear,
                            DesignTokens.Color.backgroundOverlay,
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }

                VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                    Text(detail.work.title)
                        .font(TVTheme.displayFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .frame(maxWidth: 800, alignment: .leading)

                    Text(detail.work.overview ?? "No synopsis available.")
                        .font(TVTheme.bodyFont())
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .lineSpacing(6)
                        .frame(maxWidth: 800, alignment: .leading)

                    HStack(spacing: DesignTokens.Spacing.md) {
                        if detail.work.kind == .movie, let mediaFileID = detail.mediaFileID {
                            NavigationLink {
                                TVPlayerView(
                                    mediaFileID: mediaFileID,
                                    title: detail.work.title,
                                    apiClient: apiClient
                                )
                            } label: {
                                Text("Play")
                                    .font(TVTheme.bodyFont(emphasis: true))
                                    .foregroundStyle(DesignTokens.Color.textPrimary)
                                    .padding(.horizontal, DesignTokens.Spacing.xl)
                                    .padding(.vertical, DesignTokens.Spacing.sm)
                                    .background(
                                        RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                                            .fill(DesignTokens.Color.brandPrimary)
                                    )
                            }
                            .buttonStyle(.card)
                        }
                    }
                    .padding(.top, DesignTokens.Spacing.lg)

                    children(detail.children)
                        .padding(.top, DesignTokens.Spacing.xl)
                }
                .padding(DesignTokens.Spacing.xxxl)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func children(_ children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            ForEach(seasons, id: \.season.id) { season in
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                    Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                        .font(TVTheme.titleFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    ForEach(season.episodes) { episode in
                        playbackRow(
                            mediaFileID: episode.mediaFileID,
                            title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                            label: "\(episode.episode.episodeNumber). \(episode.episode.title ?? "Episode")"
                        )
                    }
                }
            }
        case .artist(let albums):
            ForEach(albums, id: \.album.id) { album in
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                    Text(album.album.title)
                        .font(TVTheme.titleFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    ForEach(album.tracks) { track in
                        playbackRow(
                            mediaFileID: track.mediaFileID,
                            title: track.track.title,
                            label: "\(track.track.trackNumber). \(track.track.title)"
                        )
                    }
                }
            }
        case .author(let books):
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                Text("Books")
                    .font(TVTheme.titleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                ForEach(books) { book in
                    playbackRow(
                        mediaFileID: book.mediaFileID,
                        title: book.book.title,
                        label: book.book.title
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func playbackRow(mediaFileID: UUID?, title: String, label: String) -> some View {
        if let mediaFileID {
            NavigationLink {
                TVPlayerView(
                    mediaFileID: mediaFileID,
                    title: title,
                    apiClient: apiClient
                )
            } label: {
                Label(label, systemImage: "play.fill")
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .frame(maxWidth: 900, alignment: .leading)
                    .padding(.horizontal, DesignTokens.Spacing.lg)
                    .padding(.vertical, DesignTokens.Spacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.button, style: .continuous)
                            .fill(DesignTokens.Color.brandPrimary)
                    )
            }
            .buttonStyle(.card)
        } else {
            Label("\(label) — unavailable", systemImage: "play.slash")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .padding(.vertical, DesignTokens.Spacing.sm)
        }
    }

    private func backdropURL(for work: Work) -> URL? {
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}
