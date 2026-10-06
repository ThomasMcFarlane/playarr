import Observation
import PlayarrKit
import SwiftUI
import UIKit

// MARK: - Remote images (episode stills and frame thumbnails)

@MainActor
private enum WMImageCache {
    static let cache = NSCache<NSString, UIImage>()
}

/// Loads the first path that answers with an image (episode still, then a frame thumbnail).
struct WMRemoteImage: View {
    struct Source: Hashable {
        let path: String
        var query: [String: String] = [:]
    }

    let apiClient: PlayarrAPIClient
    let sources: [Source]
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            }
        }
        .clipped()
        .task(id: sources) { await load() }
    }

    private func load() async {
        for source in sources {
            let key = "\(source.path)?\(source.query.sorted { $0.key < $1.key })" as NSString
            if let cached = WMImageCache.cache.object(forKey: key) {
                image = cached
                return
            }
            let query = source.query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            guard let data = try? await apiClient.requestData(
                method: "GET", path: source.path, query: query, body: nil, expectedStatuses: [200]
            ), let decoded = UIImage(data: data) else { continue }
            WMImageCache.cache.setObject(decoded, forKey: key)
            image = decoded
            return
        }
    }
}

// MARK: - Model

@MainActor
@Observable
final class WMDetailModel {
    private(set) var chapters: [MediaChapter] = []
    private(set) var chaptersFromServer = false
    private(set) var lag: AvailabilityLag?
    private(set) var listed = false
    private(set) var titleKey: String?
    private(set) var watchlistBusy = false

    private let apiClient: PlayarrAPIClient
    private let work: Work
    private var watchlist: WatchlistClient { WatchlistClient(transport: apiClient) }

    init(apiClient: PlayarrAPIClient, work: Work) {
        self.apiClient = apiClient
        self.work = work
    }

    func load(mediaFileID: UUID?, runtimeMS: Int64?) async {
        if work.kind == .series {
            lag = try? await apiClient.availabilityLag(workID: work.id)
        }
        if let mediaFileID {
            let found = (try? await apiClient.mediaChapters(mediaFileID: mediaFileID)) ?? []
            if found.isEmpty {
                chapters = Self.generatedChapters(runtimeMS: runtimeMS ?? 0)
                chaptersFromServer = false
            } else {
                chapters = found
                chaptersFromServer = true
            }
        }
        if let resolved = try? await watchlist.resolve(TitleSnapshot(work: work)) {
            listed = resolved.inWatchlist
            titleKey = resolved.title.titleKey
        }
    }

    func toggleWatchlist() async {
        guard !watchlistBusy else { return }
        watchlistBusy = true
        defer { watchlistBusy = false }
        let snapshot = TitleSnapshot(work: work)
        do {
            if listed {
                var key = titleKey
                if key == nil { key = try await watchlist.resolve(snapshot).title.titleKey }
                if let key { try await watchlist.remove(titleKey: key) }
                listed = false
            } else {
                let added = try await watchlist.add(snapshot)
                titleKey = added.title.titleKey
                listed = true
            }
        } catch {
            // The button stays usable; the next tap retries.
        }
    }

    /// Chapters spread evenly when the file has none (web: about ten, on 5 to 30 minute steps).
    static func generatedChapters(runtimeMS: Int64) -> [MediaChapter] {
        guard runtimeMS > 0 else { return [] }
        let target = Double(runtimeMS) / 10
        let steps = [5, 10, 15, 20, 30].map { Double($0) * 60_000 }
        let interval = steps.first(where: { $0 >= target }) ?? steps[steps.count - 1]
        let count = max(1, Int((Double(runtimeMS) / interval).rounded(.up)))
        return (0..<count).map { index in
            let start = Int64(Double(index) * interval)
            return MediaChapter(
                index: Int32(index),
                startMS: start,
                endMS: min(runtimeMS, start + Int64(interval)),
                title: "Chapter \(index + 1)"
            )
        }
    }
}

// MARK: - Page

private enum WMFormat {
    static func clock(_ ms: Int64) -> String {
        let total = Int(ms / 1000)
        let hours = total / 3600, minutes = (total % 3600) / 60, seconds = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%d:%02d", minutes, seconds)
    }

    static func runtime(_ ms: Int64) -> String {
        let total = max(1, Int((Double(ms) / 60_000).rounded()))
        let hours = total / 60, minutes = total % 60
        if hours <= 0 { return "\(minutes) min" }
        return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h"
    }

    static func date(_ iso: String?) -> String? {
        guard let iso, let day = Self.parser.date(from: String(iso.prefix(10))) else { return nil }
        return Self.display.string(from: day)
    }

    private static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let display: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "d MMM yyyy"
        return formatter
    }()
}

/// Web mobile title page for a film or a series (numbers from the web layout dump).
struct WMDetailPage: View {
    let detail: WorkDetail
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    let similar: [Work]
    let onBack: () -> Void

    @State private var model: WMDetailModel
    @State private var showingDownload = false
    @State private var showingPlayback = false

    init(
        detail: WorkDetail,
        apiClient: PlayarrAPIClient,
        downloadRepository: DownloadRepository,
        similar: [Work],
        onBack: @escaping () -> Void
    ) {
        self.detail = detail
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.similar = similar
        self.onBack = onBack
        _model = State(initialValue: WMDetailModel(apiClient: apiClient, work: detail.work))
    }

    // MARK: Derived

    private var work: Work { detail.work }
    private var seasons: [SeasonDetail] {
        if case .series(let seasons) = detail.children { return seasons }
        return []
    }
    private var isSeries: Bool { work.kind == .series }

    private var selectedEpisode: (season: Season, detail: EpisodeDetail)? {
        for season in seasons {
            if let playable = season.episodes.first(where: { $0.mediaFileID != nil }) {
                return (season.season, playable)
            }
        }
        if let first = seasons.first, let episode = first.episodes.first { return (first.season, episode) }
        return nil
    }

    private var playMediaFileID: UUID? {
        isSeries ? selectedEpisode?.detail.mediaFileID : detail.mediaFileID
    }

    private var runtimeMS: Int64? {
        isSeries ? selectedEpisode?.detail.runtimeMS : detail.runtimeMS
    }

    private func code(_ season: Season, _ episode: Episode) -> String {
        "S \(String(format: "%02d", season.seasonNumber)) · E \(String(format: "%02d", episode.episodeNumber))"
    }

    private var kicker: String {
        if isSeries, let selected = selectedEpisode { return code(selected.season, selected.detail.episode) }
        return (work.genres.first ?? work.kind.displayName).uppercased()
    }

    private var metaItems: [(String, Bool)] {
        var items: [(String, Bool)] = []
        if isSeries, let selected = selectedEpisode {
            items.append(("Season \(selected.season.seasonNumber)", true))
            items.append((code(selected.season, selected.detail.episode), false))
        } else {
            items.append((work.singularKind, true))
        }
        if let runtimeMS, runtimeMS > 0 { items.append((WMFormat.runtime(runtimeMS), false)) }
        if let year = work.releaseDate?.prefix(4), year.count == 4 { items.append((String(year), false)) }
        if isSeries, let aired = WMFormat.date(selectedEpisode?.detail.episode.airDate) {
            items.append(("Aired  \(aired)", false))
        } else if let released = WMFormat.date(work.releaseDate) {
            items.append(("\(isSeries ? "Premiered" : "Released")  \(released)", false))
        }
        if !work.genres.isEmpty { items.append((work.genres.joined(separator: ", "), false)) }
        return items
    }

    private var synopsis: String? {
        if isSeries { return selectedEpisode?.detail.episode.overview ?? work.overview }
        return work.overview
    }

    // MARK: Body

    var body: some View {
        ZStack(alignment: .topLeading) {
            WM.page
            ScrollView(.vertical) {
                ZStack(alignment: .topLeading) {
                    artBackdrop
                    header
                    VStack(alignment: .leading, spacing: 0) {
                        copy
                        actions
                        tracks
                    }
                    .padding(.top, 365)
                }
                .frame(width: 390, alignment: .topLeading)
                .padding(.bottom, 140)
            }
            .scrollIndicators(.hidden)
        }
        .ignoresSafeArea()
        .task { await model.load(mediaFileID: playMediaFileID, runtimeMS: runtimeMS) }
        .sheet(isPresented: $showingDownload) {
            DownloadOptionsSheet(
                candidates: downloadCandidates,
                apiClient: apiClient,
                downloadRepository: downloadRepository
            )
        }
        .sheet(isPresented: $showingPlayback) {
            if let mediaFileID = playMediaFileID {
                PlaybackSettingsSheet(apiClient: apiClient, mediaFileID: mediaFileID, title: work.title)
            }
        }
    }

    private var artBackdrop: some View {
        ZStack(alignment: .topLeading) {
            PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                .frame(width: 406, height: 280)
                .opacity(0.1)
                .offset(x: -8, y: -5)
            LinearGradient(
                stops: [
                    .init(color: WM.page.opacity(0), location: 0),
                    .init(color: WM.page, location: 0.36),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(width: 390, height: 280)
        }
        .frame(width: 390, height: 608, alignment: .topLeading)
        .clipped()
    }

    private var header: some View {
        ZStack(alignment: .topLeading) {
            WMHeaderCircleButton(width: 42, height: 38, glyph: "←", action: onBack)
                .offset(x: 16, y: WM.topInset + 2)
            WMText(work.kind.displayName, 21.6, 580, lh: 32.4, ls: -0.972)
                .offset(x: 68, y: WM.topInset + 5)
        }
    }

    // MARK: Copy

    private var copy: some View {
        VStack(alignment: .leading, spacing: 0) {
            WMText(kicker, 10.56, 820, color: WM.pink, lh: 15.84, ls: 0.8448)
            Text(work.title)
                .font(WM.font(39, 560))
                .tracking(-2.808)
                .foregroundStyle(WM.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: 358, height: 36.66, alignment: .leading)
                .padding(.top, 10.16)
            if isSeries, let episode = selectedEpisode?.detail.episode {
                WMText(
                    episode.title ?? "Episode \(episode.episodeNumber)",
                    14.4, 570, color: WM.inkSoft, lh: 16.56, ls: -0.504
                )
                .frame(width: 358, alignment: .leading)
                .padding(.top, 8.34)
            }
            HStack(spacing: 10) {
                ForEach(Array(metaItems.enumerated()), id: \.offset) { _, item in
                    WMText(item.0, 10.24, item.1 ? 680 : 400, color: item.1 ? WM.inkSoft : WM.muted, lh: 15.36)
                        .fixedSize()
                }
            }
            .frame(width: 358, height: 15.36, alignment: .leading)
            .padding(.top, isSeries ? 11.44 : 12.34)
            if isSeries, let lag = model.lag {
                WMText(lag.primaryLine, 16, 640, lh: 24)
                    .frame(width: 358, alignment: .leading)
                    .padding(.top, 6.64)
            }
            if let synopsis, !synopsis.isEmpty {
                Text(synopsis)
                    .font(WM.font(11.52))
                    .foregroundStyle(WM.muted)
                    .lineLimit(3)
                    .frame(width: 347, alignment: .topLeading)
                    .padding(.top, isSeries ? 10 : 9.64)
            }
        }
        .padding(.leading, 16)
    }

    // MARK: Actions

    private var downloadCandidates: [DownloadCandidate] {
        let poster = work.images.first(where: { $0.kind == .poster })?.url
        if isSeries {
            return seasons.flatMap { season in
                season.episodes.compactMap { episode in
                    episode.mediaFileID.map {
                        DownloadCandidate(
                            mediaFileID: $0, workID: work.id,
                            title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                            subtitle: season.season.title ?? "Season \(season.season.seasonNumber)",
                            posterURLString: poster
                        )
                    }
                }
            }
        }
        guard let mediaFileID = detail.mediaFileID else { return [] }
        return [DownloadCandidate(mediaFileID: mediaFileID, workID: work.id, title: work.title, subtitle: nil, posterURLString: poster)]
    }

    private func pill(
        width: CGFloat, height: CGFloat = 44, fill: Color,
        glyph: String, glyphSize: CGFloat, glyphColor: Color,
        label: String, labelSize: CGFloat, labelColor: Color, gap: CGFloat
    ) -> some View {
        HStack(spacing: gap) {
            Text(glyph).font(WM.font(glyphSize)).foregroundStyle(glyphColor)
            WMText(label, labelSize, 700, color: labelColor, lh: labelSize * 1.5).fixedSize()
        }
        .frame(width: width, height: height)
        .background(fill, in: Capsule())
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isSeries {
                HStack(spacing: 8) {
                    startButton
                    watchlistButton
                }
                .padding(.top, 11.3)
            } else {
                ZStack(alignment: .topLeading) {
                    Button { showingDownload = true } label: {
                        pill(
                            width: 104, fill: WM.chip.opacity(0.72), glyph: "⇩", glyphSize: 9.2,
                            glyphColor: WM.pink, label: "Download", labelSize: 8, labelColor: WM.ink, gap: 9
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(downloadCandidates.isEmpty)
                    .offset(x: 0, y: 2)
                    Button { showingPlayback = true } label: {
                        pill(
                            width: 119, fill: WM.chip.opacity(0.72), glyph: "☷", glyphSize: 12.88,
                            glyphColor: WM.pink, label: "Playback", labelSize: 11.2, labelColor: WM.ink, gap: 8
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(playMediaFileID == nil)
                    .offset(x: 112, y: 2)
                    playLink
                        .offset(x: 235, y: 0)
                }
                .frame(width: 358, height: 47, alignment: .topLeading)
                .padding(.top, 12.3)
                watchlistButton.padding(.top, 11)
            }
        }
        .padding(.leading, 16)
    }

    @ViewBuilder
    private var playLink: some View {
        if let mediaFileID = detail.mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: work.title,
                    suggestionsWorkID: work.id
                )
            } label: {
                pill(
                    width: 126, height: 47, fill: WM.pink, glyph: "▶", glyphSize: 9.52,
                    glyphColor: .white, label: "Play", labelSize: 11.2, labelColor: .white, gap: 11
                )
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var startButton: some View {
        if let selected = selectedEpisode, let mediaFileID = selected.detail.mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: selected.detail.episode.title ?? "Episode \(selected.detail.episode.episodeNumber)",
                    suggestionsWorkID: work.id,
                    queue: PlaybackQueueBuilder.episodes(after: selected.detail.id, seriesTitle: work.title, seasons: seasons),
                    subtitle: PlaybackQueueBuilder.episodeSubtitle(
                        series: work.title,
                        season: selected.season.seasonNumber,
                        episode: selected.detail.episode.episodeNumber
                    )
                )
            } label: {
                pill(
                    width: 240, fill: WM.ink, glyph: "▶", glyphSize: 9.52,
                    glyphColor: WM.shell, label: "Start", labelSize: 11.2, labelColor: WM.shell, gap: 10
                )
            }
            .buttonStyle(.plain)
        } else {
            pill(
                width: 240, fill: WM.ink.opacity(0.4), glyph: "▶", glyphSize: 9.52,
                glyphColor: WM.shell, label: "Start", labelSize: 11.2, labelColor: WM.shell, gap: 10
            )
        }
    }

    private var watchlistButton: some View {
        Button { Task { await model.toggleWatchlist() } } label: {
            pill(
                width: 110, fill: WM.chip.opacity(0.72), glyph: model.listed ? "✓" : "+", glyphSize: 9.2,
                glyphColor: WM.pink, label: model.listed ? "On watchlist" : "Add to watchlist",
                labelSize: 8, labelColor: WM.ink, gap: 9
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: Tracks

    private func heading(_ title: String, _ sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            WMText(title, 16, 610, lh: 24, ls: -0.48)
            if let sub { WMText(sub, 10.56, 400, color: WM.muted, lh: 15.84) }
        }
        .padding(.leading, 16)
    }

    private var tracks: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isSeries {
                ForEach(Array(seasons.enumerated()), id: \.element.season.id) { index, season in
                    seasonTrack(season, first: index == 0)
                }
            } else if !model.chapters.isEmpty, let mediaFileID = detail.mediaFileID {
                chapterTrack(mediaFileID: mediaFileID)
            }
            if !similar.isEmpty { similarTrack }
        }
        .padding(.top, isSeries ? 28 : 28)
    }

    private func seasonTrack(_ season: SeasonDetail, first: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            heading(
                season.season.title ?? "Season \(season.season.seasonNumber)",
                "\(season.episodes.count) episodes"
            )
            .padding(.top, 24)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(Array(season.episodes.enumerated()), id: \.element.id) { index, episode in
                        episodeCard(episode, season: season.season, focused: first && index == 0)
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollClipDisabled()
            .scrollIndicators(.hidden)
            .frame(height: 127)
            .padding(.top, 18)
        }
        .padding(.bottom, 47.16)
    }

    private func episodeCard(_ episode: EpisodeDetail, season: Season, focused: Bool) -> some View {
        let title = episode.episode.title ?? "Episode \(episode.episode.episodeNumber)"
        let card = VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomTrailing) {
                WMRemoteImage(apiClient: apiClient, sources: episodeSources(episode, season: season))
                    .frame(width: 179, height: 101)
                    .background(WM.artFill)
                WMText(String(format: "%02d", episode.episode.episodeNumber), 12.8, 560, color: .white, lh: 19.2)
                    .padding(.trailing, 10).padding(.bottom, 9)
            }
            .frame(width: 179, height: 101)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(alignment: .topTrailing) { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
            HStack(spacing: 9) {
                WMText(code(season, episode.episode), 9.92, 700, color: WM.muted, lh: 14.88).fixedSize()
                WMText(title, 12.48, 610, lh: 18.72, ls: -0.1872)
            }
            .frame(width: 179, alignment: .leading)
            .padding(.top, 7)
        }
        .frame(width: 179, height: 127, alignment: .topLeading)

        return Group {
            if let mediaFileID = episode.mediaFileID {
                NavigationLink {
                    PlayerView(
                        apiClient: apiClient,
                        downloadRepository: downloadRepository,
                        initialMediaFileID: mediaFileID.uuidString,
                        initialTitle: title,
                        suggestionsWorkID: work.id,
                        queue: PlaybackQueueBuilder.episodes(after: episode.id, seriesTitle: work.title, seasons: seasons),
                        subtitle: PlaybackQueueBuilder.episodeSubtitle(
                            series: work.title, season: season.seasonNumber, episode: episode.episode.episodeNumber
                        )
                    )
                } label: { card }
                .buttonStyle(.plain)
            } else {
                card
            }
        }
    }

    private func episodeSources(_ episode: EpisodeDetail, season: Season) -> [WMRemoteImage.Source] {
        var sources = [
            WMRemoteImage.Source(
                path: "/api/v1/artwork/episode/\(work.id.uuidString.lowercased())/\(episode.id.uuidString.lowercased())/thumb"
            ),
        ]
        if let mediaFileID = episode.mediaFileID {
            sources.append(WMRemoteImage.Source(path: "/api/v1/media/\(mediaFileID.uuidString.lowercased())/thumbnail"))
        }
        return sources
    }

    private func chapterTrack(mediaFileID: UUID) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            heading(
                "Chapters",
                model.chaptersFromServer ? "\(model.chapters.count) scene markers" : "\(model.chapters.count) chapters"
            )
            .padding(.top, 24)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(model.chapters) { chapter in
                        chapterCard(chapter, mediaFileID: mediaFileID)
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollClipDisabled()
            .scrollIndicators(.hidden)
            .frame(height: 132)
            .padding(.top, 17)
        }
        .padding(.bottom, 42)
    }

    private func chapterCard(_ chapter: MediaChapter, mediaFileID: UUID) -> some View {
        NavigationLink {
            PlayerView(
                apiClient: apiClient,
                downloadRepository: downloadRepository,
                initialMediaFileID: mediaFileID.uuidString,
                initialTitle: work.title,
                suggestionsWorkID: work.id
            )
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .bottomTrailing) {
                    WMRemoteImage(
                        apiClient: apiClient,
                        sources: [WMRemoteImage.Source(
                            path: "/api/v1/media/\(mediaFileID.uuidString.lowercased())/thumbnail",
                            query: ["position_ms": String(chapter.startMS)]
                        )]
                    )
                    .frame(width: 179, height: 101)
                    .background(WM.artFill)
                    WMText(String(format: "%02d", chapter.index + 1), 12.8, 560, color: .white, lh: 19.2)
                        .padding(.trailing, 10).padding(.bottom, 9)
                }
                .frame(width: 179, height: 101)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                HStack(spacing: 9) {
                    WMText(WMFormat.clock(chapter.startMS), 9.92, 700, color: WM.muted, lh: 14.88).fixedSize()
                    WMText(chapter.title ?? "Chapter \(chapter.index + 1)", 12.48, 610, lh: 18.72)
                }
                .frame(width: 179, alignment: .leading)
                .padding(.top, 12)
            }
            .frame(width: 179, height: 132, alignment: .topLeading)
        }
        .buttonStyle(.plain)
    }

    private var similarTrack: some View {
        VStack(alignment: .leading, spacing: 0) {
            heading("Similar Titles", nil).padding(.top, 24)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(similar) { other in
                        NavigationLink {
                            WorkDetailView(
                                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: other.id),
                                apiClient: apiClient,
                                downloadRepository: downloadRepository
                            )
                        } label: {
                            WMRailCard(work: other, apiClient: apiClient, unseen: true, focused: false)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollClipDisabled()
            .scrollIndicators(.hidden)
            .frame(height: 147)
            .padding(.top, 14)
        }
    }
}

extension Work {
    /// "Movie", "Series", ... as the web writes the kind in a title page's meta row.
    var singularKind: String {
        switch kind {
        case .movie: "Movie"
        case .series: "Series"
        case .site: "Site"
        case .artist: "Artist"
        case .author: "Author"
        }
    }
}

// MARK: - Playback settings sheet

/// Per-title quality, audio and subtitle choice (the web "Playback" button).
struct PlaybackSettingsSheet: View {
    let apiClient: PlayarrAPIClient
    let mediaFileID: UUID
    let title: String

    @Environment(\.dismiss) private var dismiss
    @State private var options: MediaPlaybackOptions?
    @State private var qualityID = "original"
    @State private var audioID = ""
    @State private var subtitleID = ""
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Group {
                if let options {
                    Form {
                        Picker("Quality", selection: $qualityID) {
                            ForEach(options.qualityOptions) { Text($0.label).tag($0.id) }
                        }
                        if !options.audioTracks.isEmpty {
                            Picker("Audio", selection: $audioID) {
                                ForEach(options.audioTracks) { Text($0.label).tag($0.id) }
                            }
                        }
                        Picker("Subtitles", selection: $subtitleID) {
                            Text("Off").tag("")
                            ForEach(options.subtitleTracks) { Text($0.label).tag($0.id) }
                        }
                        if let message { Text(message).font(.footnote).foregroundStyle(PlayarrStyle.inkSoft) }
                    }
                    .scrollContentBackground(.hidden)
                } else if let message {
                    Text(message).foregroundStyle(PlayarrStyle.inkSoft)
                } else {
                    PlayarrLoadingView(title: "Loading playback options…")
                }
            }
            .background(PlayarrStyle.background)
            .navigationTitle("Playback settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(options == nil)
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium])
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await apiClient.mediaPlaybackOptions(mediaFileID: mediaFileID)
            options = loaded
            qualityID = loaded.preferences.qualityID
            audioID = loaded.preferences.audioTrackID ?? loaded.audioTracks.first(where: \.isDefault)?.id ?? ""
            subtitleID = loaded.preferences.subtitleTrackID ?? ""
        } catch {
            message = "Playback options could not be loaded"
        }
    }

    private func save() async {
        do {
            _ = try await apiClient.updateMediaPlaybackOptions(
                mediaFileID: mediaFileID,
                body: MediaPlaybackPreference(
                    qualityID: qualityID,
                    audioTrackID: audioID.isEmpty ? nil : audioID,
                    subtitleTrackID: subtitleID.isEmpty ? nil : subtitleID
                )
            )
            dismiss()
        } catch {
            message = "Playback settings could not be saved"
        }
    }
}
