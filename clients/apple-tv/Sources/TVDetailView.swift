import PlayarrKit
import SwiftUI

/// Title detail (film or series), laid out on the web TV grid: header, copy column on the left,
/// chapters and similar titles (film) or season tracks (series) on the right.
struct TVWorkDetailView: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    @Environment(\.requestNavFocus) private var requestNavFocus
    @State private var viewModel: TVWorkDetailViewModel
    @State private var showDownloadNote = false
    @FocusState private var focusedEpisodeID: UUID?
    /// Web: the primary action (Play, Start, Resume) holds focus when the page opens.
    @FocusState private var playFocused: Bool

    private var frozen: Bool { TVParityLaunch.frozen }

    init(work: Work, apiClient: PlayarrAPIClient) {
        self.work = work
        self.apiClient = apiClient
        _viewModel = State(
            initialValue: TVWorkDetailViewModel(
                workID: work.id,
                apiClient: apiClient,
                // Parity fixtures (and any offline open) render the opened work without a fetch.
                seedWork: work
            )
        )
    }

    var body: some View {
        content
            .alert("Downloads", isPresented: $showDownloadNote) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Apple TV keeps no offline copies. Download this title from the web or a phone or tablet app.")
            }
    }

    private var content: some View {
        ZStack {
            TVStageBackground()
            Group {
                switch viewModel.state {
                case .idle, .loading:
                    // Skeleton loading (owner rule): the page frame with its header, never a spinner screen.
                    TVPageHeader(title: work.kind == .series ? "Series" : "Movies", detail: work.title)
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
        .ignoresSafeArea()
        .task {
            if viewModel.state == .idle { await viewModel.load() }
            try? await Task.sleep(for: .milliseconds(200))
            // Films focus Play; series focus the next-up episode tile instead (owner rule).
            if !frozen, work.kind != .series { playFocused = true }
        }
    }

    // MARK: Layout

    private func detailContent(_ detail: WorkDetail) -> some View {
        GeometryReader { _ in
        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundElevated
            keyArt(detail.work)
            TVStageWash()

            TVPageHeader(
                title: detail.work.kind == .series ? "Series" : "Movies",
                detail: detail.work.title
            )

            switch detail.children {
            case .series(let seasons):
                seriesCopy(detail, seasons: seasons)
                seriesRail(detail, seasons: seasons)
            default:
                movieCopy(detail)
                movieRail(detail)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .ignoresSafeArea()
        .navigationBarBackButtonHidden(true)
    }

    // MARK: Key art

    private func keyArt(_ work: Work) -> some View {
        TVKeyArt(url: backdropURL(for: work))
    }

    // MARK: Copy column

    private func titleLines(_ title: String) -> [String] {
        TVTextWrap.lines(title, weight: 560, size: 69.12, kern: -4.98, width: 379.5)
    }

    private func kicker(_ text: String) -> some View {
        Text(text.uppercased())
            .font(TVTheme.font(size: 12.29, css: 820))
            .tracking(0.98)
            .foregroundStyle(DesignTokens.Stage.brandInk)
            .placed(x: 153.6, y: 259.2, w: 455, h: 18.4)
    }

    /// Title lines at 62.2 each from y 303.5; returns the title bottom through the block height.
    private func titleBlock(_ lines: [String]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(TVTheme.font(size: 69.12, weight: .semibold))
                    .tracking(-4.98)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(width: 379.5, height: 62.2, alignment: .leading)
            }
        }
        .placed(x: 153.6, y: 303.5, w: 379.5, h: 62.2 * CGFloat(lines.count))
    }

    private func metaRow(_ parts: [(String, Bool)]) -> some View {
        HStack(spacing: 6.3) {
            ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
                if index > 0 {
                    Rectangle()
                        .fill(DesignTokens.Color.borderDefault.opacity(0.5))
                        .frame(width: 1, height: 9)
                        .padding(.horizontal, 0.3)
                }
                Text(part.0)
                    .font(TVTheme.font(size: 10.56, weight: part.1 ? .bold : .regular))
                    .foregroundStyle(part.1 ? DesignTokens.Color.textSecondary : DesignTokens.Color.textDisabled)
                    .lineLimit(1)
            }
        }
    }

    private func movieCopy(_ detail: WorkDetail) -> some View {
        let work = detail.work
        let lines = titleLines(work.title)
        let bottom = 303.5 + 62.2 * CGFloat(lines.count)
        let metaY = bottom + 27
        let synopsisY = metaY + 37.5
        var parts: [(String, Bool)] = [(work.kind.rawValue.capitalized, true)]
        if let runtime = TVWebFormat.runtime(ms: detail.runtimeMs) { parts.append((runtime, false)) }
        if let year = TVWebFormat.year(work.releaseDate) { parts.append((year, false)) }
        if let date = TVWebFormat.date(work.releaseDate) { parts.append(("Released  \(date)", false)) }
        if let genre = work.genres.first { parts.append((genre, false)) }
        let synopsis = work.overview ?? ""
        let synopsisLines = synopsis.isEmpty ? 0 : max(1, TVTextWrap.lines(synopsis, weight: 400, size: 12.864, kern: 0, width: 313.3).count)
        let buttonsY = synopsisY + 20.3 * CGFloat(synopsisLines) + 37.8
        return ZStack(alignment: .topLeading) {
            kicker(work.genres.first ?? work.kind.rawValue)
            titleBlock(lines)
            metaRow(parts).placed(x: 153.6, y: metaY, h: 15.8)
            if !synopsis.isEmpty {
                Text(synopsis)
                    .font(TVTheme.font(size: 12.86, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .lineLimit(4)
                    .frame(width: 313.3, alignment: .leading)
                    .placed(x: 153.6, y: synopsisY, w: 313.3, h: 20.3 * CGFloat(synopsisLines), alignment: .topLeading)
            }
            actionPill("Download", glyph: "\u{21E9}", x: 153.6, y: buttonsY, width: 142) { showDownloadNote = true }
            actionPill("Playback", symbol: "square.grid.2x2.fill", x: 311.6, y: buttonsY, width: 142)
            moviePlay(detail, x: 469.6, y: buttonsY)
            actionPill("Add to watchlist", glyph: "+", x: 153.6, y: buttonsY + 76, width: 142)
            actionPill("Add to Playlist", glyph: "+", x: 311.6, y: buttonsY + 76, width: 142)
        }
    }

    private func seriesCopy(_ detail: WorkDetail, seasons: [SeasonDetail]) -> some View {
        let work = detail.work
        let ordered = seasons.sorted { $0.season.seasonNumber < $1.season.seasonNumber }
        let season = ordered.first
        let episode = season?.episodes.first
        let seasonNumber = season?.season.seasonNumber ?? 1
        let code = episode.map { "S \(String(format: "%02d", seasonNumber)) \u{00B7} E \(String(format: "%02d", $0.episode.episodeNumber))" }
        let lines = titleLines(work.title)
        let bottom = 303.5 + 62.2 * CGFloat(lines.count)
        let episodeTitle = episode.map { $0.episode.title ?? "Episode \($0.episode.episodeNumber)" }
        let episodeY = bottom + 19.5
        let metaY = episodeY + 24.3 + 26.9
        let lagY = metaY + 22.3
        // Web renders no lag line at all without samples (AvailabilityLagNote): the synopsis moves up.
        let synopsisY = lagText == nil ? metaY + 15.8 + 21.6 : lagY + 28.8 + 21.6
        var parts: [(String, Bool)] = [(season.map { $0.season.title ?? "Season \($0.season.seasonNumber)" } ?? "Series", true)]
        if let code { parts.append((code, false)) }
        let runtimeMs = episode?.runtimeMs ?? episode?.episode.runtimeMinutes.map { Int64($0) * 60_000 }
        if let runtime = TVWebFormat.runtime(ms: runtimeMs) { parts.append((runtime, false)) }
        let airDate = episode?.episode.airDate ?? work.releaseDate
        if let year = TVWebFormat.year(airDate) { parts.append((year, false)) }
        if let date = TVWebFormat.date(airDate) {
            parts.append(("\(episode?.episode.airDate != nil ? "Aired" : "Premiered")  \(date)", false))
        }
        if let genre = work.genres.first { parts.append((genre, false)) }
        let synopsis = episode?.episode.overview ?? work.overview ?? ""
        let synopsisLines = synopsis.isEmpty ? 0 : min(5, max(1, TVTextWrap.lines(synopsis, weight: 400, size: 12.864, kern: 0, width: 336).count))
        let buttonsY = synopsisY + 20.3 * CGFloat(synopsisLines) + 12
        return ZStack(alignment: .topLeading) {
            kicker(code ?? work.kind.rawValue)
            titleBlock(lines)
            if let episodeTitle {
                Text(episodeTitle)
                    .font(TVTheme.font(size: 21.12, weight: .medium))
                    .tracking(-0.74)
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .lineLimit(1)
                    .placed(x: 153.6, y: episodeY, w: 309.2, h: 24.3)
            }
            metaRow(parts).placed(x: 153.6, y: metaY, h: 15.8)
            if let lagText {
                Text(lagText)
                    .font(TVTheme.font(size: 19.2, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .placed(x: 153.6, y: lagY, w: 455, h: 28.8)
            }
            if !synopsis.isEmpty {
                Text(synopsis)
                    .font(TVTheme.font(size: 12.86, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .lineLimit(5)
                    .frame(width: 336, alignment: .leading)
                    .placed(x: 153.6, y: synopsisY, w: 336, h: 20.3 * CGFloat(synopsisLines), alignment: .topLeading)
            }
            seriesStart(detail, ordered: ordered, x: 153.6, y: buttonsY)
            actionPill("Add to watchlist", glyph: "+", x: 325.6, y: buttonsY, width: 142)
            actionPill("Add to Playlist", glyph: "+", x: 483.6, y: buttonsY, width: 142)
        }
    }

    private var lagText: String? {
        guard let lag = viewModel.availabilityLag, let seconds = lag.averageSeconds else { return nil }
        let days = Double(seconds) / 86_400
        if days >= 1 {
            let value = (days * 10).rounded() / 10
            return "Usually available about \(value == value.rounded() ? String(Int(value)) : String(value)) days after release"
        }
        let hours = (Double(seconds) / 3_600 * 10).rounded() / 10
        return "Usually available about \(hours) hours after release"
    }

    // MARK: Buttons

    private func pillBackground(_ primary: Bool, light: Bool = false) -> some View {
        Capsule().fill(
            light
                ? DesignTokens.Color.textPrimary
                : primary ? DesignTokens.Color.brandPrimary : DesignTokens.Color.backgroundInputDisabled.opacity(0.72)
        )
    }

    private func actionPill(
        _ label: String,
        glyph: String? = nil,
        symbol: String? = nil,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        action: (() -> Void)? = nil
    ) -> some View {
        Button { action?() } label: { pillBody(label, glyph: glyph, symbol: symbol, width: width) }
            .buttonStyle(TVFocusableCardButtonStyle())
            .placed(x: x, y: y, w: width, h: 64)
    }

    private func pillBody(_ label: String, glyph: String?, symbol: String?, width: CGFloat) -> some View {
        HStack(spacing: 8.8) {
            if let glyph {
                Text(glyph)
                    .font(TVTheme.font(size: 12.8, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.brandPrimary)
            }
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.brandPrimary)
            }
            Text(label)
                .font(TVTheme.font(size: 11.14, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
        }
        .frame(width: width, height: 64)
        .background(pillBackground(false))
    }

    private func playLabel(_ text: String, light: Bool) -> some View {
        HStack(spacing: 8.8) {
            Image(systemName: "play.fill")
                .font(.system(size: 10.1, weight: .regular))
            Text(text)
                .font(TVTheme.font(size: 11.9, weight: .bold))
        }
        .foregroundStyle(light ? DesignTokens.Color.backgroundBase : Color.white)
        .frame(width: 156, height: 64)
        .background(pillBackground(true, light: light))
    }

    @ViewBuilder
    private func moviePlay(_ detail: WorkDetail, x: CGFloat, y: CGFloat) -> some View {
        // Web: Play is the focused control on load (scale 1.06).
        let label = playLabel("Play", light: false).scaleEffect(1.06)
        if let mediaFileID = detail.mediaFileID, !frozen {
            NavigationLink {
                TVPlayerView(
                    mediaFileID: mediaFileID,
                    title: detail.work.title,
                    apiClient: apiClient,
                    suggestionsWorkID: detail.work.id
                )
            } label: {
                label
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .focused($playFocused)
            .placed(x: x, y: y, w: 156, h: 64)
        } else {
            label.placed(x: x, y: y, w: 156, h: 64)
        }
    }

    @ViewBuilder
    private func seriesStart(_ detail: WorkDetail, ordered: [SeasonDetail], x: CGFloat, y: CGFloat) -> some View {
        let label = playLabel("Start", light: true)
        let first = ordered.first?.episodes.first(where: { $0.mediaFileID != nil })
        if let first, let mediaFileID = first.mediaFileID, !frozen {
            NavigationLink {
                TVPlayerView(
                    mediaFileID: mediaFileID,
                    title: first.episode.title ?? "Episode \(first.episode.episodeNumber)",
                    apiClient: apiClient,
                    suggestionsWorkID: detail.work.id,
                    queue: PlaybackQueueBuilder.episodes(after: first.id, seriesTitle: detail.work.title, seasons: ordered),
                    subtitle: PlaybackQueueBuilder.episodeSubtitle(
                        series: detail.work.title,
                        season: ordered.first?.season.seasonNumber ?? 1,
                        episode: first.episode.episodeNumber
                    )
                )
            } label: {
                label
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .focused($playFocused)
            .placed(x: x, y: y, w: 156, h: 64)
        } else {
            label.placed(x: x, y: y, w: 156, h: 64)
        }
    }

    // MARK: Right rail: film

    private struct Chapter: Identifiable {
        let index: Int
        let startMs: Int64
        var id: Int { index }
    }

    /// Web `generatedMovieChapters`: about ten chapters, at a 5/10/15/20/30 minute interval.
    private func chapters(runtimeMs: Int64?) -> [Chapter] {
        guard let runtimeMs, runtimeMs > 0 else { return [] }
        let target = Double(runtimeMs) / 10
        let options: [Int64] = [5, 10, 15, 20, 30].map { $0 * 60_000 }
        let interval = options.first { Double($0) >= target } ?? options[options.count - 1]
        let count = max(1, Int((Double(runtimeMs) / Double(interval)).rounded(.up)))
        return (0..<count).map { Chapter(index: $0, startMs: Int64($0) * interval) }
    }

    private func railHeading(_ title: String, count: String, y: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            Text(title)
                .font(TVTheme.font(size: 17.66, weight: .semibold))
                .tracking(-0.53)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .placed(x: 881.6, y: y, w: 992.4, h: 26.5)
            Text(count)
                .font(TVTheme.font(size: 9.98, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 881.6, y: y + 30.5, w: 992.4, h: 15)
        }
    }

    private func movieRail(_ detail: WorkDetail) -> some View {
        let list = chapters(runtimeMs: detail.runtimeMs)
        return ZStack(alignment: .topLeading) {
            TVRailPanelGradient(width: 1190.4)
            if !list.isEmpty {
                railHeading("Chapters", count: "\(list.count) scene markers", y: 540)
                ForEach(list) { chapter in
                    let x = 881.6 + CGFloat(chapter.index) * 293
                    ZStack(alignment: .topLeading) {
                        episodeArt(width: 268, height: 150.8) {
                            if let mediaFileID = detail.mediaFileID {
                                TVAuthedImage(load: {
                                    try await apiClient.fetchMediaThumbnail(mediaFileID: mediaFileID, positionMs: Int(chapter.startMs))
                                }) { Color.clear }
                            }
                        }
                        .overlay(alignment: .bottomTrailing) {
                            Text(String(format: "%02d", chapter.index + 1))
                                .font(TVTheme.font(size: 19.2, weight: .semibold))
                                .foregroundStyle(Color.white)
                                .padding(.trailing, 11.6)
                                .padding(.bottom, 8.8)
                        }
                        Text(TVWebFormat.clock(ms: chapter.startMs))
                            .font(TVTheme.font(size: 8.83, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .placed(x: 0, y: 165.3, w: 28, h: 13.2)
                        Text("Chapter \(chapter.index + 1)")
                            .font(TVTheme.font(size: 11.52, weight: .semibold))
                            .tracking(-0.17)
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .placed(x: 28.9, y: 162.3, w: 239.2, h: 17.3)
                    }
                    .frame(width: 268, height: 190, alignment: .topLeading)
                    .placed(x: x, y: 620.7, w: 268, h: 190, alignment: .topLeading)
                }
            }
            if !viewModel.cast.isEmpty {
                castRail(viewModel.cast)
            } else if !viewModel.similar.isEmpty {
                railHeading("Similar Titles", count: "\(viewModel.similar.count) titles", y: 854.3)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 25) {
                        ForEach(viewModel.similar) { other in
                            NavigationLink {
                                TVWorkDetailView(work: other, apiClient: apiClient)
                            } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    episodeArt(width: 268, height: 150.8) {
                                        TVWorkArt(work: other, apiClient: apiClient)
                                    }
                                    Text(other.title)
                                        .font(TVTheme.font(size: 11.52, weight: .semibold))
                                        .foregroundStyle(DesignTokens.Color.textPrimary)
                                        .lineLimit(1)
                                        .frame(width: 268, alignment: .leading)
                                }
                            }
                            .buttonStyle(TVFocusableCardButtonStyle())
                            .disabled(frozen) // not .focusable: on a Button it adds a second, inert focus target
                        }
                    }
                    .padding(.trailing, 80)
                }
                .frame(width: 1038.4, height: 190, alignment: .topLeading)
                .placed(x: 881.6, y: 935, w: 1038.4, h: 190, alignment: .topLeading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Web detail "Cast" rail: heading at y 891, 103.7 circles from x 905.8 at a 176.95 pitch, the person's photo or
    /// initials (34.4 / 640) on the raised surface.
    private func castRail(_ cast: [Credit]) -> some View {
        ZStack(alignment: .topLeading) {
            Text("Cast")
                .font(TVTheme.font(size: 17.664, css: 610))
                .tracking(-0.53)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .placed(x: 881.6, y: 891, w: 400, h: 26.5)
            Text(cast.count == 1 ? "1 person" : "\(cast.count) people")
                .font(TVTheme.font(size: 9.984, css: 400))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 881.6, y: 921.5, w: 400, h: 15)
            ForEach(Array(cast.prefix(12).enumerated()), id: \.element.id) { index, credit in
                let initials = credit.person.name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
                ZStack {
                    Circle().fill(DesignTokens.Stage.surfaceSoft)
                    Text(initials)
                        .font(TVTheme.font(size: 34.4, css: 640))
                        .tracking(-1.72)
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    if let url = credit.person.headshotURL.flatMap({ apiClient.resolvedURL(forPath: $0) }),
                       url.scheme?.hasPrefix("http") == true {
                        AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Color.clear }
                    }
                }
                .frame(width: 103.7, height: 103.7)
                .clipShape(Circle())
                .placed(x: 905.8 + 176.95 * CGFloat(index), y: 971.7, w: 103.7, h: 103.7)
            }
        }
    }

    /// Web `.tv-episode-art`: a raised tile, radius 13.44, with the picture filling it.
    private func episodeArt<Content: View>(
        width: CGFloat,
        height: CGFloat,
        heavy: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        ZStack {
            DesignTokens.Color.backgroundRaised
            content().frame(width: width, height: height).clipped().saturation(0.75)
            // Web `.tv-episode-art::after`: a diagonal darkening wash over the picture.
            LinearGradient(
                colors: [Color.black.opacity(0.05), Color.black.opacity(0.48)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 13.44, style: .continuous))
        .shadow(color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(heavy ? 0.3 : 0.14), radius: heavy ? 24 : 10, y: heavy ? 24 : 10)
        .shadow(color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(heavy ? 0.2 : 0.1), radius: heavy ? 10 : 4, y: heavy ? 10 : 3)
    }

    // MARK: Right rail: series

    /// The episode the series page opens on: the one the server's resume plan points at (the same plan as the
    /// Start/Resume button), else the first playable episode, else the first episode (web `nextUpSelection`).
    private func nextUpEpisodeID(_ ordered: [SeasonDetail]) -> UUID? {
        let playable = ordered.flatMap { $0.episodes.filter { $0.mediaFileID != nil } }
        if let target = viewModel.resumeTarget {
            let match = playable.first { $0.episode.id == target.episodeID }
                ?? playable.first { target.mediaFileID != nil && $0.mediaFileID == target.mediaFileID }
            if let match { return match.episode.id }
        }
        return (playable.first ?? ordered.first?.episodes.first)?.episode.id
    }

    private func seriesRail(_ detail: WorkDetail, seasons: [SeasonDetail]) -> some View {
        let ordered = seasons.sorted { $0.season.seasonNumber < $1.season.seasonNumber }
        let nextUp = nextUpEpisodeID(ordered)
        // The focused episode (the next-up one until focus moves) decides which season is scrolled into view.
        let activeID = frozen ? nextUp : (focusedEpisodeID ?? nextUp)
        let activeSeason = ordered.firstIndex { season in season.episodes.contains { $0.episode.id == activeID } } ?? 0
        let shift = max(0, 358 + CGFloat(activeSeason) * 314.3 + 270 - 1020)
        return ZStack(alignment: .topLeading) {
            TVRailPanelGradient(width: 1190.4)
            Group {
                ForEach(Array(ordered.enumerated()), id: \.element.season.id) { seasonIndex, season in
                    let top = 358 + CGFloat(seasonIndex) * 314.3
                    railHeading(
                        season.season.title ?? "Season \(season.season.seasonNumber)",
                        count: "\(season.episodes.count) episodes",
                        y: top
                    )
                    Button { showDownloadNote = true } label: {
                        Image(systemName: "arrow.down.to.line")
                            .font(.system(size: 18, weight: .regular))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .frame(width: 18.7, height: 24.2)
                    }
                    .buttonStyle(TVFocusableCardButtonStyle())
                    .accessibilityLabel("Download \(season.season.title ?? "Season \(season.season.seasonNumber)")")
                    .placed(x: 1841.7, y: top + 10.9, w: 18.7, h: 24.2, alignment: .center)
                    ForEach(Array(season.episodes.enumerated()), id: \.element.id) { index, episode in
                        let selected = episode.episode.id == activeID
                        episodeCard(detail, season: season, episode: episode, ordered: ordered, selected: selected)
                            .placed(x: 881.6 + CGFloat(index) * 293, y: top + 80.7, w: 268, h: 190, alignment: .topLeading)
                    }
                }
            }
            .offset(y: -shift)
            .animation(.easeOut(duration: 0.25), value: shift)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: nextUp) {
            // Opening the page puts focus on the next item to play; going back keeps the last focus.
            if !frozen, focusedEpisodeID == nil { focusedEpisodeID = nextUp }
        }
    }

    @ViewBuilder
    private func episodeCard(
        _ detail: WorkDetail,
        season: SeasonDetail,
        episode: EpisodeDetail,
        ordered: [SeasonDetail],
        selected: Bool
    ) -> some View {
        let ep = episode.episode
        let title = ep.title ?? "Episode \(ep.episodeNumber)"
        let code = "S \(String(format: "%02d", season.season.seasonNumber)) \u{00B7} E \(String(format: "%02d", ep.episodeNumber))"
        let card = ZStack(alignment: .topLeading) {
            episodeArt(width: 268, height: 150.8, heavy: selected) {
                // Web `MediaThumbnailArtwork`: the episode's still when it has one, else its own frame at 30 s; the
                // series art until it loads.
                if ep.images?.contains(where: { $0.kind == .thumb }) == true {
                    TVAuthedImage(load: {
                        try await apiClient.fetchEpisodeArtwork(seriesWorkID: detail.work.id, episodeID: ep.id)
                    }) { TVWorkArt(work: detail.work, apiClient: apiClient) }
                } else if let mediaFileID = episode.mediaFileID {
                    TVAuthedImage(load: {
                        try await apiClient.fetchMediaThumbnail(mediaFileID: mediaFileID, positionMs: 30_000)
                    }) { TVWorkArt(work: detail.work, apiClient: apiClient) }
                } else {
                    TVWorkArt(work: detail.work, apiClient: apiClient)
                }
            }
            // The art grows to 1.025 over 240 ms (ease) when focused.
            .scaleEffect(selected ? 1.025 : 1)
            .animation(.easeInOut(duration: 0.24), value: selected)
            .overlay(alignment: .bottomTrailing) {
                Text(String(format: "%02d", ep.episodeNumber))
                    .font(TVTheme.font(size: 19.2, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .padding(.trailing, 11.6)
                    .padding(.bottom, 8.8)
            }
            .overlay(alignment: .topTrailing) {
                Circle()
                    .fill(DesignTokens.Color.brandPrimary)
                    .frame(width: 13, height: 13)
                    .overlay(Circle().stroke(Color.white, lineWidth: 1.6))
                    .padding(10.6)
            }
            Text(code)
                .font(TVTheme.font(size: 8.83, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(1)
                .fixedSize()
                .placed(x: 0, y: 158, w: 48, h: 13.2)
            Text(title)
                .font(TVTheme.font(size: 11.52, weight: .semibold))
                .tracking(-0.17)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .placed(x: 49.3, y: 155, w: 218.7, h: 17.3)
        }
        .frame(width: 268, height: 190, alignment: .topLeading)
        // Media cards show focus as a soft shadow plus a lift, never a ring or fill (owner ruling). Pinned web values
        // (page-layout spec, section 5 item 1a): the card rises 7 px over 260 ms, cubic-bezier(0.2, 0.8, 0.2, 1).
        .offset(y: selected ? -7 : 0)
        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.26), value: selected)
        if let mediaFileID = episode.mediaFileID, !frozen {
            NavigationLink {
                TVPlayerView(
                    mediaFileID: mediaFileID,
                    title: title,
                    apiClient: apiClient,
                    suggestionsWorkID: detail.work.id,
                    queue: PlaybackQueueBuilder.episodes(after: episode.id, seriesTitle: detail.work.title, seasons: ordered),
                    subtitle: PlaybackQueueBuilder.episodeSubtitle(
                        series: detail.work.title,
                        season: season.season.seasonNumber,
                        episode: ep.episodeNumber
                    )
                )
            } label: {
                card
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .focused($focusedEpisodeID, equals: ep.id)
        } else {
            card
        }
    }

    private func backdropURL(for work: Work) -> URL? {
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}
