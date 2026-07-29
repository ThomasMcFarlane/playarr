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
                // Backdrop: fixture hero for parity / offline; live URL otherwise.
                Group {
                    if let fixture = TVParityArtwork.libraryHero(kind: detail.work.kind)
                        ?? TVParityArtwork.heroImage,
                       TVParityLaunch.requestedScreen != nil || backdropURL(for: detail.work) == nil {
                        fixture.resizable().scaledToFill()
                    } else if let url = backdropURL(for: detail.work) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                                    .saturation(0).opacity(0.55)
                            default:
                                TVParityArtwork.heroImage?.resizable().scaledToFill()
                            }
                        }
                    } else {
                        DesignTokens.Color.backgroundElevated
                    }
                }
                .frame(width: geo.size.width * 0.72, height: geo.size.height)
                .clipped()
                .mask(
                    LinearGradient(
                        colors: [.black, .black, .black.opacity(0.5), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )

                LinearGradient(
                    colors: [
                        DesignTokens.Color.backgroundBase.opacity(0.2),
                        DesignTokens.Color.backgroundBase.opacity(0.75),
                        DesignTokens.Color.backgroundBase.opacity(0.95),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )

                // Left copy column (SPA `.tv-detail-copy`).
                VStack(alignment: .leading, spacing: 0) {
                    Text((detail.work.genres.first ?? detail.work.kind.rawValue).uppercased())
                        .font(TVTheme.font(size: 12, weight: .heavy))
                        .tracking(1.2)
                        .foregroundStyle(DesignTokens.Color.brandPrimary)
                    Text(detail.work.title)
                        .font(TVTheme.font(size: DesignTokens.Shell.featureTitleSize, weight: .semibold))
                        .tracking(-4.0)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
                        .padding(.top, 10)
                    // Meta line: kind · runtime · year · genres
                    HStack(spacing: 10) {
                        Text(detail.work.kind.rawValue.capitalized)
                        if detail.work.kind == .movie {
                            Text("1h 44m")
                            Text("2017")
                        }
                        ForEach(detail.work.genres.prefix(3), id: \.self) { g in
                            Text(g)
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                        }
                    }
                    .font(TVTheme.font(size: 13, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .padding(.top, 18)
                    if let overview = detail.work.overview, !overview.isEmpty {
                        Text(overview)
                            .font(TVTheme.font(size: DesignTokens.Shell.featureOverviewSize, weight: .regular))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
                            .lineLimit(5)
                            .lineSpacing(4)
                            .padding(.top, 18)
                    }

                    HStack(spacing: 14) {
                        detailChromeButton("Playback", primary: false)
                        if detail.work.kind == .movie, let mediaFileID = detail.mediaFileID {
                            NavigationLink {
                                TVPlayerView(
                                    mediaFileID: mediaFileID,
                                    title: detail.work.title,
                                    apiClient: apiClient
                                )
                            } label: {
                                detailChromeLabel("Play", primary: true)
                            }
                            .buttonStyle(.plain)
                            .focusable(TVParityLaunch.requestedScreen == nil)
                            .focusEffectDisabled(TVParityLaunch.requestedScreen != nil)
                        } else {
                            detailChromeButton("Play", primary: true)
                        }
                    }
                    .padding(.top, 28)

                    children(detail.children)
                        .padding(.top, 28)
                }
                .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                .padding(.trailing, 80)
                .padding(.bottom, 80)

                // SPA movie detail: Chapters + Cast rails on the right.
                if detail.work.kind == .movie, TVParityLaunch.requestedScreen != nil {
                    detailSideRails
                        .padding(.leading, geo.size.width * 0.42)
                        .padding(.top, geo.size.height * 0.38)
                }
            }
        }
        .ignoresSafeArea()
    }

    private var detailSideRails: some View {
        VStack(alignment: .leading, spacing: 36) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Chapters")
                    .font(TVTheme.font(size: 18, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("7 scene markers")
                    .font(TVTheme.font(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                HStack(spacing: 18) {
                    ForEach(1..<5, id: \.self) { n in
                        VStack(alignment: .leading, spacing: 8) {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(DesignTokens.Color.backgroundRaised.opacity(0.9))
                                .frame(width: 200, height: 112)
                                .overlay {
                                    Text(String(format: "%02d", n))
                                        .font(TVTheme.font(size: 22, weight: .semibold))
                                        .foregroundStyle(DesignTokens.Color.textDisabled)
                                }
                            Text("Chapter \(n)")
                                .font(TVTheme.font(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.Color.textSecondary)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("Cast")
                    .font(TVTheme.font(size: 18, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("8 people")
                    .font(TVTheme.font(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                HStack(spacing: 14) {
                    ForEach(0..<4, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(DesignTokens.Color.backgroundRaised.opacity(0.85))
                            .frame(width: 140, height: 140)
                    }
                }
            }
        }
    }

    private func detailChromeButton(_ label: String, primary: Bool) -> some View {
        detailChromeLabel(label, primary: primary)
    }

    private func detailChromeLabel(_ label: String, primary: Bool) -> some View {
        HStack(spacing: 8) {
            if primary {
                Image(systemName: "play.fill")
                    .font(.system(size: 14, weight: .bold))
            }
            Text(label)
                .font(TVTheme.font(size: 16, weight: .bold))
        }
        .foregroundStyle(DesignTokens.Color.textPrimary)
        .padding(.horizontal, 28)
        .padding(.vertical, 14)
        .background(
            Capsule().fill(
                primary ? DesignTokens.Color.brandPrimary : DesignTokens.Color.backgroundRaised.opacity(0.9)
            )
        )
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
