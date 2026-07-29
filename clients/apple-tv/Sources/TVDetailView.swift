import PlayarrKit
import SwiftUI

struct TVWorkDetailView: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    @State private var viewModel: TVWorkDetailViewModel

    init(work: Work, apiClient: PlayarrAPIClient) {
        self.work = work
        self.apiClient = apiClient
        _viewModel = State(
            initialValue: TVWorkDetailViewModel(
                workID: work.id,
                apiClient: apiClient,
                // Always seed the opened work so parity fixtures (and any
                // offline open) can render without a live fetch.
                seedWork: work
            )
        )
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
        .task {
            if viewModel.state == .idle { await viewModel.load() }
        }
    }

    private func detailContent(_ detail: WorkDetail) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                DesignTokens.Color.backgroundElevated
                // Backdrop + fixture fallback (parity offline detail).
                Group {
                    if let url = backdropURL(for: detail.work) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            default:
                                TVParityArtwork.heroImage?.resizable().scaledToFill()
                            }
                        }
                    } else {
                        TVParityArtwork.heroImage?.resizable().scaledToFill()
                    }
                }
                .frame(width: geo.size.width * 0.62, height: geo.size.height)
                .clipped()
                .saturation(0)
                .opacity(0.55)
                .mask(
                    LinearGradient(
                        colors: [.black, .black, .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )

                LinearGradient(
                    colors: [
                        DesignTokens.Color.backgroundBase.opacity(0.15),
                        DesignTokens.Color.backgroundBase.opacity(0.92),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 18) {
                    Text(detail.work.kind.rawValue.uppercased())
                        .font(TVTheme.font(size: 12, weight: .heavy))
                        .tracking(1.2)
                        .foregroundStyle(DesignTokens.Color.brandPrimary)
                    Text(detail.work.title)
                        .font(TVTheme.heroTitleFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .frame(maxWidth: 640, alignment: .leading)
                    if let overview = detail.work.overview, !overview.isEmpty {
                        Text(overview)
                            .font(TVTheme.font(size: 17, weight: .regular))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                            .frame(maxWidth: 640, alignment: .leading)
                            .lineLimit(6)
                    }

                    HStack(spacing: 16) {
                        if detail.work.kind == .movie, let mediaFileID = detail.mediaFileID {
                            NavigationLink {
                                TVPlayerView(
                                    mediaFileID: mediaFileID,
                                    title: detail.work.title,
                                    apiClient: apiClient
                                )
                            } label: {
                                Text("Play")
                                    .font(TVTheme.font(size: 18, weight: .bold))
                                    .foregroundStyle(DesignTokens.Color.textPrimary)
                                    .padding(.horizontal, 36)
                                    .padding(.vertical, 14)
                                    .background(Capsule().fill(DesignTokens.Color.brandPrimary))
                            }
                            .buttonStyle(.plain)
                            .focusable(TVParityLaunch.requestedScreen == nil)
                            .focusEffectDisabled(TVParityLaunch.requestedScreen != nil)
                        } else {
                            Text("Play")
                                .font(TVTheme.font(size: 18, weight: .bold))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .padding(.horizontal, 36)
                                .padding(.vertical, 14)
                                .background(Capsule().fill(DesignTokens.Color.brandPrimary))
                        }
                    }
                    .padding(.top, 8)

                    children(detail.children)
                        .padding(.top, 28)
                }
                .padding(.leading, 200)
                .padding(.top, geo.size.height * 0.28)
                .padding(.trailing, 80)
                .padding(.bottom, 80)
            }
        }
        .ignoresSafeArea()
    }

    @ViewBuilder
    private func children(_ children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            ForEach(seasons, id: \.season.id) { season in
                VStack(alignment: .leading, spacing: 12) {
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
                VStack(alignment: .leading, spacing: 12) {
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
            VStack(alignment: .leading, spacing: 12) {
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
                TVPlayerView(mediaFileID: mediaFileID, title: title, apiClient: apiClient)
            } label: {
                Label(label, systemImage: "play.fill")
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(DesignTokens.Color.backgroundRaised.opacity(0.9))
                    )
            }
            .buttonStyle(.card)
        } else {
            Label("\(label) — unavailable", systemImage: "play.slash")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        }
    }

    private func backdropURL(for work: Work) -> URL? {
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}
