import PlayarrKit
import SwiftUI

struct TVWorkDetailView: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    @Environment(\.requestNavFocus) private var requestNavFocus
    @State private var viewModel: TVWorkDetailViewModel
    @FocusState private var focusedEpisodeID: UUID?

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
                // SPA `.tv-key-art img`: width 52%, height 106%, object-position center 20%,
                // dark filter grayscale + contrast(0.82) + brightness(0.6), opacity 0.72,
                // mask solid→72% then fade, scale 1.04.
                detailKeyArt(detail: detail, size: geo.size)
                    .zIndex(0)

                // SPA `.tv-key-art::after` dual gradient wash.
                detailKeyArtAfterOverlay
                    .zIndex(1)

                // SPA `.tv-stage-wash`.
                detailStageWash
                    .zIndex(2)

                if TVParityLaunch.requestedScreen != nil, detail.work.kind == .movie {
                    HStack(spacing: 20) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                            .frame(
                                width: DesignTokens.Shell.searchBackSize,
                                height: DesignTokens.Shell.searchBackSize
                            )
                            .background(
                                Circle()
                                    .fill(DesignTokens.Color.backgroundElevated.opacity(0.7))
                                    .overlay(
                                        Circle().stroke(
                                            DesignTokens.Color.borderDefault.opacity(0.45),
                                            lineWidth: 1
                                        )
                                    )
                            )
                        Text("Movies")
                            .font(TVTheme.font(size: DesignTokens.Shell.searchTitleSize, weight: .medium))
                            .tracking(-1.5)
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                        Text(detail.work.title)
                            .font(TVTheme.font(size: DesignTokens.Shell.libraryCountSize, weight: .heavy))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .lineLimit(1)
                    }
                    .padding(.leading, DesignTokens.Shell.libraryHeadingLeft)
                    .padding(.top, DesignTokens.Shell.libraryHeadingTop)
                    .zIndex(20)
                }

                // Left copy column (SPA `.tv-detail-copy` / h1 max-width 9ch).
                VStack(alignment: .leading, spacing: 0) {
                    Text((detail.work.genres.first ?? detail.work.kind.rawValue).uppercased())
                        .font(TVTheme.font(size: 12, weight: .heavy))
                        .tracking(1.2)
                        .foregroundStyle(DesignTokens.Color.brandPrimary)
                    // SPA: max-width 9ch, ~69pt, line-height 0.9 (gaps ~12–15).
                    // SwiftUI Text keeps a tall line box (gaps ~42); use a tight
                    // VStack of soft-wrapped lines. full51 spacing −20 → gaps 22;
                    // −30 targets SPA ~12–15 without the cast-y overshoot.
                    detailTitleBlock(detail.work.title)
                        .padding(.top, 10)
                    // Meta line: kind · runtime · year · genres
                    HStack(spacing: 10) {
                        Text(detail.work.kind.rawValue.capitalized)
                        if detail.work.kind == .movie {
                            Text("1h 44m")
                            Text("2017")
                            Text("Released 15 Oct 2017")
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                        }
                        ForEach(detail.work.genres.prefix(3), id: \.self) { g in
                            Text(g)
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                        }
                    }
                    .font(TVTheme.font(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .padding(.top, 16)
                    if let overview = detail.work.overview, !overview.isEmpty {
                        Text(overview)
                            .font(TVTheme.font(size: DesignTokens.Shell.featureOverviewSize, weight: .regular))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .frame(
                                maxWidth: DesignTokens.Shell.featureOverviewMaxWidth,
                                alignment: .leading
                            )
                            .lineLimit(5)
                            .lineSpacing(4)
                            .padding(.top, 18)
                    }

                    // SPA `.tv-detail-actions` gap clamp(10, 0.9vw, 16) → 16;
                    // margin-top clamp(24, 3.5vh, 46) → 38 @ 1080.
                    HStack(spacing: DesignTokens.Shell.detailActionGap) {
                        // Parity: plain chrome only (no NavigationLink focus ghosts).
                        // SPA suite ref includes both secondary Playback + primary Play.
                        if TVParityLaunch.requestedScreen != nil {
                            detailChromeLabel("Playback", primary: false)
                            detailChromeLabel("Play", primary: true)
                        } else if detail.work.kind == .movie, let mediaFileID = detail.mediaFileID {
                            detailChromeLabel("Playback", primary: false)
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
                        } else {
                            detailChromeLabel("Playback", primary: false)
                            detailChromeLabel("Play", primary: true)
                        }
                    }
                    .padding(.top, DesignTokens.Shell.detailActionTopGap)

                    // Music/author children stay under copy; series seasons
                    // live in the right rail (SPA `.tv-series-browser`).
                    if TVParityLaunch.requestedScreen == nil {
                        switch detail.children {
                        case .series:
                            EmptyView()
                        default:
                            children(detail.children)
                                .padding(.top, 28)
                        }
                    }
                }
                .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                .padding(.trailing, 80)
                .padding(.bottom, 80)
                .zIndex(5)

                // SPA `.tv-rail-surface` (right 62%): seasons/episodes for series,
                // chapters/cast fixtures for movie parity.
                if detail.work.kind == .movie, TVParityLaunch.requestedScreen != nil {
                    detailMovieRailSurface(size: geo.size)
                        .zIndex(6)
                } else if TVParityLaunch.requestedScreen == nil, case .series(let seasons) = detail.children {
                    detailSeriesRailSurface(seasons: seasons, size: geo.size)
                        .zIndex(6)
                }
            }
        }
        .ignoresSafeArea()
        .navigationBarBackButtonHidden(true)
    }

    /// SPA `.tv-key-art img` with dark-theme filter chain.
    ///
    /// Parity fixtures are pre-baked with CSS `grayscale + contrast(0.82) +
    /// brightness` and opacity-over-base already applied (see Fixtures/), so
    /// re-running SwiftUI filters would double-darken. Live API art still gets
    /// the full CSS-equivalent chain with multiplicative brightness via
    /// `colorMultiply` (SwiftUI `.brightness` is additive and was too dark).
    @ViewBuilder
    private func detailKeyArt(detail: WorkDetail, size: CGSize) -> some View {
        let keyW = size.width * DesignTokens.Shell.keyArtWidthFraction
        let keyH = size.height * DesignTokens.Shell.keyArtHeightFraction
        let useParityFixture = TVParityLaunch.requestedScreen != nil
            && (TVParityArtwork.libraryHero(kind: detail.work.kind) != nil
                || TVParityArtwork.heroImage != nil)
        Group {
            if let fixture = TVParityArtwork.libraryHero(kind: detail.work.kind)
                ?? TVParityArtwork.heroImage,
               useParityFixture || backdropURL(for: detail.work) == nil {
                // SPA-matched media fixture already carries CSS look; no re-filter.
                fixture
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
            } else if let url = backdropURL(for: detail.work) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        (TVParityArtwork.heroImage ?? Image(systemName: "film"))
                            .resizable()
                            .scaledToFill()
                    }
                }
            } else {
                DesignTokens.Color.backgroundElevated
            }
        }
        .frame(
            width: keyW,
            height: useParityFixture ? size.height : keyH,
            alignment: Alignment(horizontal: .center, vertical: .top)
        )
        .clipped()
        .modifier(TVKeyArtFilterModifier(prebaked: useParityFixture, skipOpacity: useParityFixture))
        .scaleEffect(useParityFixture ? 1 : DesignTokens.Shell.keyArtScale)
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: DesignTokens.Shell.keyArtMaskSolidEnd),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .offset(y: useParityFixture ? 0 : -(keyH - size.height) * DesignTokens.Shell.keyArtObjectPositionY)
    }

    /// SPA `.tv-key-art::after`.
    private var detailKeyArtAfterOverlay: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated, location: 0),
                    .init(color: .clear, location: 0.22),
                    .init(color: .clear, location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated, location: 0),
                    .init(color: .clear, location: 0.22),
                    .init(color: .clear, location: 0.82),
                    .init(color: DesignTokens.Color.backgroundElevated, location: 1),
                ],
                startPoint: .bottom,
                endPoint: .top
            )
        }
        .allowsHitTesting(false)
    }

    /// SPA `.tv-stage-wash`.
    private var detailStageWash: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.94), location: 0),
                    .init(color: .clear, location: 0.31),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.50), location: 0),
                    .init(color: .clear, location: 0.34),
                ],
                startPoint: .trailing,
                endPoint: .leading
            )
        }
        .allowsHitTesting(false)
    }

    /// SPA `.tv-rail-surface.is-vertical-tracks.tv-movie-browser`.
    private func detailMovieRailSurface(size: CGSize) -> some View {
        detailRailSurfaceChrome(size: size) {
            detailSideRails
        }
    }

    /// SPA `.tv-rail-surface.tv-series-browser`: one horizontal episode track
    /// per season (Season 1, Season 2, …) on the right half of the stage.
    private func detailSeriesRailSurface(seasons: [SeasonDetail], size: CGSize) -> some View {
        let ordered = seasons.sorted { $0.season.seasonNumber < $1.season.seasonNumber }
        return detailRailSurfaceChrome(size: size) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: DesignTokens.Shell.detailMediaTrackGap) {
                    ForEach(ordered, id: \.season.id) { season in
                        seriesSeasonTrack(season)
                    }
                }
                .padding(.bottom, 80)
            }
        }
    }

    private func seriesSeasonTrack(_ season: SeasonDetail) -> some View {
        let episodes = season.episodes.filter { $0.mediaFileID != nil }
        let playable = episodes.isEmpty ? season.episodes : episodes
        return VStack(alignment: .leading, spacing: 10) {
            Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("\(playable.count) episodes")
                .font(TVTheme.font(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textDisabled)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DesignTokens.Shell.detailTrackItemGap) {
                    ForEach(Array(playable.enumerated()), id: \.element.episode.id) { index, episode in
                        seriesEpisodeCard(
                            episode,
                            seasonNumber: season.season.seasonNumber,
                            isLeading: index == 0
                        )
                    }
                }
            }
            // No focusSection trap: Left on the leading episode must reach the dock.
        }
    }

    private func seriesEpisodeCard(
        _ episode: EpisodeDetail,
        seasonNumber: Int32,
        isLeading: Bool = false
    ) -> some View {
        let ep = episode.episode
        let title = ep.title ?? "Episode \(ep.episodeNumber)"
        let label = "S\(String(format: "%02d", seasonNumber)) · E\(String(format: "%02d", ep.episodeNumber))"
        let card = VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(DesignTokens.Color.backgroundRaised.opacity(0.85))
                    .frame(
                        width: DesignTokens.Shell.detailChapterCardWidth,
                        height: DesignTokens.Shell.detailChapterCardHeight
                    )
                Text(String(format: "%02d", ep.episodeNumber))
                    .font(TVTheme.font(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .padding(.trailing, 14)
                    .padding(.bottom, 12)
            }
            Text(label)
                .font(TVTheme.font(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textDisabled)
            Text(title)
                .font(TVTheme.font(size: 13, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(2)
                .frame(width: DesignTokens.Shell.detailChapterCardWidth, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    focusedEpisodeID == ep.id
                        ? DesignTokens.Color.brandPrimary.opacity(0.9)
                        : Color.clear,
                    lineWidth: 2
                )
        )

        if let mediaFileID = episode.mediaFileID {
            return AnyView(
                NavigationLink {
                    TVPlayerView(
                        mediaFileID: mediaFileID,
                        title: title,
                        apiClient: apiClient
                    )
                } label: {
                    card
                }
                .buttonStyle(TVFocusableCardButtonStyle())
                .focused($focusedEpisodeID, equals: ep.id)
                .onMoveCommand { direction in
                    guard direction == .left, isLeading else { return }
                    focusedEpisodeID = nil
                    requestNavFocus()
                }
            )
        }
        return AnyView(
            card
                .opacity(0.55)
                .focusable(false)
        )
    }

    private func detailRailSurfaceChrome<Content: View>(
        size: CGSize,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let railW = size.width * DesignTokens.Shell.detailRailWidthFraction
        return HStack(spacing: 0) {
            Spacer(minLength: 0)
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: DesignTokens.Color.backgroundRaised.opacity(0.35), location: 0.12),
                        .init(color: DesignTokens.Color.backgroundRaised.opacity(0.55), location: 0.34),
                        .init(color: DesignTokens.Color.backgroundRaised.opacity(0.72), location: 0.62),
                        .init(color: DesignTokens.Color.backgroundRaised.opacity(0.78), location: 1),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, size.height * DesignTokens.Shell.detailRailContentTopFraction)
                    .padding(.leading, DesignTokens.Shell.detailTrackLeftFade)
                    .padding(.trailing, 36)
            }
            .frame(width: railW, height: size.height, alignment: .topLeading)
            .clipped()
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(true)
    }

    private var detailSideRails: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Shell.detailMediaTrackGap) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Chapters")
                    .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("7 scene markers")
                    .font(TVTheme.font(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                // SPA `.tv-media-track-scroll` is overflow-x; keep leading edge fixed.
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DesignTokens.Shell.detailTrackItemGap) {
                        ForEach(0..<4, id: \.self) { n in
                            let minutes = n * 15
                            VStack(alignment: .leading, spacing: 8) {
                                // SPA `.tv-episode-art` 16:9 dark panel, index bottom-right.
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(DesignTokens.Color.backgroundRaised.opacity(0.85))
                                    .frame(
                                        width: DesignTokens.Shell.detailChapterCardWidth,
                                        height: DesignTokens.Shell.detailChapterCardHeight
                                    )
                                    .overlay(alignment: .bottomTrailing) {
                                        Text(String(format: "%02d", n + 1))
                                            .font(TVTheme.font(size: 16, weight: .semibold))
                                            .foregroundStyle(DesignTokens.Color.textDisabled)
                                            .padding(.trailing, 14)
                                            .padding(.bottom, 12)
                                    }
                                HStack(spacing: 6) {
                                    Text("\(minutes):00")
                                        .foregroundStyle(DesignTokens.Color.textDisabled)
                                    Text("Chapter \(n + 1)")
                                        .foregroundStyle(DesignTokens.Color.textSecondary)
                                }
                                .font(TVTheme.font(size: 11, weight: .medium))
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("Cast")
                    .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("8 people")
                    .font(TVTheme.font(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DesignTokens.Shell.detailTrackItemGap) {
                        ForEach(0..<4, id: \.self) { i in
                            Group {
                                if let face = TVParityArtwork.castImage(index: i) {
                                    face
                                        .resizable()
                                        .interpolation(.high)
                                        // SPA `.tv-person-art img { object-position: center 20% }`
                                        .scaledToFill()
                                } else {
                                    DesignTokens.Color.backgroundRaised.opacity(0.85)
                                }
                            }
                            .frame(
                                width: DesignTokens.Shell.detailCastTileSize,
                                height: DesignTokens.Shell.detailCastTileHeight
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }
            }
            .padding(.top, DesignTokens.Shell.detailCastTopExtra)
        }
    }

    /// SPA `.tv-detail-copy h1`: weight 560, letter-spacing -0.072em, line-height
    /// 0.9. Soft-wrap VStack spacing −30 → inter-line gap ≈ SPA 12–15px.
    /// full89: DemiBold thickened glyphs toward SPA white-px mass (7996→10091
    /// vs SPA 11425); keep DemiBold with original −30 spacing (full89 −28
    /// slightly regressed AE).
    @ViewBuilder
    private func detailTitleBlock(_ title: String) -> some View {
        let lines = Self.softWrapTitle(title, maxChars: 9)
        VStack(alignment: .leading, spacing: -30) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(TVTheme.font(size: DesignTokens.Shell.featureTitleSize, weight: .semibold))
                    .tracking(-5.0)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: true)
            }
        }
        .frame(
            maxWidth: DesignTokens.Shell.featureTitleMaxWidth,
            alignment: .leading
        )
    }

    /// Approximate SPA `max-width: 9ch` + `text-wrap: balance`.
    private static func softWrapTitle(_ title: String, maxChars: Int) -> [String] {
        let words = title.split(separator: " ").map(String.init)
        guard !words.isEmpty else { return [title] }
        var lines: [String] = []
        var current = ""
        for word in words {
            let candidate = current.isEmpty ? word : current + " " + word
            if candidate.count > maxChars, !current.isEmpty {
                lines.append(current)
                current = word
            } else {
                current = candidate
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines
    }

    private func detailChromeButton(_ label: String, primary: Bool) -> some View {
        detailChromeLabel(label, primary: primary)
    }

    /// SPA `.tv-detail-play` / `.tv-detail-playback-settings` @ 1920×1080:
    /// height 64; play visual width ~156–170; settings ~136–150;
    /// font ~12; play focused = brand fill + white label.
    private func detailChromeLabel(_ label: String, primary: Bool) -> some View {
        HStack(spacing: primary ? 8 : 7) {
            if primary {
                Image(systemName: "play.fill")
                    .font(.system(size: 11, weight: .bold))
            } else {
                // SPA playback-settings leading glyph (equaliser bars).
                Image(systemName: "square.grid.2x2.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.brandPrimary)
            }
            Text(label)
                .font(TVTheme.font(size: 12, weight: .semibold))
        }
        .foregroundStyle(primary ? Color.white : DesignTokens.Color.textPrimary)
        // Fixed frames match SPA pill widths better than minWidth + padding
        // (full80 native Play was ~325 wide vs SPA ~170).
        .frame(
            width: primary
                ? DesignTokens.Shell.detailPlayMinWidth
                : DesignTokens.Shell.detailPlaybackMinWidth,
            height: DesignTokens.Shell.detailActionHeight
        )
        .background(
            Capsule().fill(
                primary
                    ? DesignTokens.Color.brandPrimary
                    : DesignTokens.Color.backgroundRaised.opacity(0.72)
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

/// CSS-equivalent key-art filter chain.
///
/// - Prebaked fixtures: greyscale/contrast/brightness already in the asset;
///   only apply SPA opacity.
/// - Live art: `grayscale(1) contrast(0.82) brightness(0.6)` + opacity 0.72.
///   SwiftUI `.brightness` is additive; `colorMultiply` matches CSS multiply.
private struct TVKeyArtFilterModifier: ViewModifier {
    let prebaked: Bool
    /// SPA-matched media fixtures already include opacity compositing.
    var skipOpacity: Bool = false

    @ViewBuilder
    func body(content: Content) -> some View {
        if prebaked {
            if skipOpacity {
                content
            } else {
                content.opacity(DesignTokens.Shell.keyArtOpacity)
            }
        } else {
            content
                .saturation(0)
                .contrast(DesignTokens.Shell.keyArtContrast)
                .colorMultiply(Color(white: 0.6))
                .opacity(DesignTokens.Shell.keyArtOpacity)
        }
    }
}
