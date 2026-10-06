import PlayarrKit
import SwiftUI

struct WorkDetailView: View {
    @State private var viewModel: WorkDetailViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @Environment(\.dismiss) private var dismiss
    @State private var playlists: [Playlist] = []
    @State private var playlistMessage: String?
    @State private var selectedAlbumID: UUID?
    @State private var showResumeChooser = false
    @State private var resumePlay: ResumePlayRequest?

    init(viewModel: WorkDetailViewModel, apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository) {
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
    }

    /// Builds the `DownloadCandidate` `DownloadOptionsSheet`/
    /// `DownloadRepository.enqueue` need for one playable leaf under this
    /// work — every row builder below funnels through this rather than
    /// constructing `DownloadCandidate` inline.
    private func candidate(mediaFileID: UUID, title: String, subtitle: String?) -> DownloadCandidate {
        DownloadCandidate(
            mediaFileID: mediaFileID,
            workID: viewModel.workID,
            title: title,
            subtitle: subtitle,
            posterURLString: viewModel.detail?.work.images.first(where: { $0.kind == .poster })?.url
        )
    }

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
            await viewModel.loadResumePlan()
            playlists = (try? await apiClient.listPlaylists()) ?? []
            if selectedAlbumID == nil,
               case .artist(let albums) = viewModel.detail?.children {
                selectedAlbumID = albums.first?.album.id
            }
        }
        .sheet(isPresented: $showResumeChooser) {
            if let plan = viewModel.resumePlan, let detail = viewModel.detail {
                ResumeChooserView(seriesTitle: detail.work.title, plan: plan) { option in
                    showResumeChooser = false
                    startResume(option, detail: detail, record: true)
                }
            }
        }
        .navigationDestination(item: $resumePlay) { request in
            PlayerView(
                apiClient: apiClient,
                downloadRepository: downloadRepository,
                initialMediaFileID: request.mediaFileID.uuidString,
                initialTitle: request.title,
                suggestionsWorkID: request.workID,
                queue: request.queue,
                subtitle: request.subtitle
            )
        }
        .alert("Playlists", isPresented: Binding(
            get: { playlistMessage != nil },
            set: { if !$0 { playlistMessage = nil } }
        )) { Button("OK") { playlistMessage = nil } } message: { Text(playlistMessage ?? "") }
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .playarrChromeHidden()
    }

    private func detailContent(_ detail: WorkDetail) -> some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack(alignment: .topLeading) {
                if phone {
                    phoneDetail(detail, proxy: proxy)
                } else {
                    tabletDetail(detail, proxy: proxy)
                }

                Button { dismiss() } label: {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .frame(width: phone ? 42 : 46, height: phone ? 42 : 46)
                        .background(PlayarrStyle.surfaceStrong.opacity(0.7), in: Circle())
                        .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(76, max(38, proxy.size.height * 0.062)))
            }
        }
        .background(PlayarrStyle.surface)
        .ignoresSafeArea()
    }

    private func phoneDetail(_ detail: WorkDetail, proxy: GeometryProxy) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                PlayarrArtwork(work: detail.work, kind: .backdrop, apiClient: apiClient)
                    .frame(height: min(520, proxy.size.height * 0.58))
                    .opacity(0.58)
                    .overlay {
                        LinearGradient(
                            colors: [.clear, PlayarrStyle.surface.opacity(0.25), PlayarrStyle.surface],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }

                VStack(alignment: .leading, spacing: 28) {
                    detailCopy(detail, phone: true)
                    children(for: detail.children)
                    discoveryContent
                }
                .padding(.horizontal, 16)
                .offset(y: -max(150, proxy.size.height * 0.24))
                .padding(.bottom, 112 - max(-150, -proxy.size.height * 0.24))
            }
        }
        .scrollIndicators(.hidden)
    }

    private func tabletDetail(_ detail: WorkDetail, proxy: GeometryProxy) -> some View {
        ZStack(alignment: .topLeading) {
            PlayarrArtwork(work: detail.work, kind: .backdrop, apiClient: apiClient)
                .frame(width: proxy.size.width, height: proxy.size.height)
                .opacity(0.7)
                .overlay {
                    LinearGradient(
                        colors: [PlayarrStyle.surface.opacity(0.48), .clear, PlayarrStyle.surface.opacity(0.18)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }

            detailCopy(detail, phone: false)
                .frame(width: proxy.size.width * 0.24, alignment: .leading)
                .padding(.leading, max(102, proxy.size.width * 0.08))
                .padding(.top, proxy.size.height * 0.24)

            if hasVisibleChildren(detail.children) || hasDiscoveryContent {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 30) {
                        children(for: detail.children)
                        discoveryContent
                    }
                        .padding(.horizontal, max(28, proxy.size.width * 0.024))
                        .padding(.top, proxy.size.height * 0.5)
                        .padding(.bottom, proxy.size.height * 0.5)
                }
                .frame(width: proxy.size.width * 0.62, height: proxy.size.height)
                .offset(x: proxy.size.width * 0.38)
                .scrollIndicators(.hidden)
                .background {
                    LinearGradient(
                        colors: [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
            }
        }
    }

    private var hasDiscoveryContent: Bool {
        !viewModel.credits.cast.isEmpty || !viewModel.credits.crew.isEmpty || !viewModel.similarWorks.isEmpty
    }

    @ViewBuilder
    private var discoveryContent: some View {
        if !viewModel.credits.cast.isEmpty {
            creditRail(title: "Cast", credits: Array(viewModel.credits.cast.prefix(16)))
        }
        if !viewModel.credits.crew.isEmpty {
            creditRail(title: "Crew", credits: Array(viewModel.credits.crew.prefix(12)))
        }
        if !viewModel.similarWorks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("More like this")
                    .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 12) {
                        ForEach(viewModel.similarWorks) { work in
                            NavigationLink {
                                WorkDetailView(
                                    viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                    apiClient: apiClient,
                                    downloadRepository: downloadRepository
                                )
                            } label: {
                                PlayarrMediaCard(work: work, apiClient: apiClient, width: 126)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private func creditRail(title: String, credits: [Credit]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 10) {
                    ForEach(credits) { credit in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(credit.person.name).font(.caption.weight(.semibold)).lineLimit(1)
                            Text(credit.character ?? credit.job ?? credit.department ?? "")
                                .font(.caption2).foregroundStyle(PlayarrStyle.muted).lineLimit(1)
                        }
                        .foregroundStyle(PlayarrStyle.ink)
                        .padding(.horizontal, 13)
                        .frame(width: 150, height: 58, alignment: .leading)
                        .background(PlayarrStyle.surfaceStrong.opacity(0.68), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private func hasVisibleChildren(_ children: WorkChildren) -> Bool {
        switch children {
        case .movie:
            false
        case .series(let seasons):
            !seasons.isEmpty
        case .artist(let albums):
            !albums.isEmpty
        case .author(let books):
            !books.isEmpty
        }
    }

    private func detailCopy(_ detail: WorkDetail, phone: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(detail.work.kind.displayName.uppercased())
                .font(.custom("Avenir Next", fixedSize: phone ? 10.5 : 10).weight(.heavy))
                .tracking(1.2)
                .foregroundStyle(PlayarrStyle.pink)
                .padding(.bottom, phone ? 12 : 22)

            Text(detail.work.title)
                .font(.custom("Avenir Next", fixedSize: phone ? 42 : 52).weight(.medium))
                .tracking(phone ? -3 : -3.75)
                .lineSpacing(-5)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(3)

            if !detail.work.genres.isEmpty {
                Text(detail.work.genres.prefix(3).joined(separator: "  •  "))
                    .font(.custom("Avenir Next", fixedSize: phone ? 11 : 9.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .padding(.top, phone ? 14 : 22)
            }

            if let overview = detail.work.overview, !overview.isEmpty {
                Text(overview)
                    .font(.custom("Avenir Next", fixedSize: phone ? 12 : 10.5))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineSpacing(phone ? 5 : 4)
                    .lineLimit(phone ? 5 : 6)
                    .padding(.top, phone ? 12 : 18)
            }

            if detail.work.kind == .series, let plan = viewModel.resumePlan, plan.playableTarget != nil {
                Button {
                    if plan.isStacked {
                        showResumeChooser = true
                    } else if let target = plan.playableTarget {
                        startResume(target, detail: detail, record: false)
                    }
                } label: {
                    Label(plan.buttonLabel, systemImage: "play.fill").frame(minWidth: 112)
                }
                .buttonStyle(PlayarrPrimaryButtonStyle())
                .accessibilityLabel(plan.isStacked ? "\(plan.buttonLabel), choose an episode" : plan.buttonLabel)
                .padding(.top, phone ? 24 : 30)
            }

            if let mediaFileID = detail.mediaFileID {
                HStack(spacing: 12) {
                    NavigationLink {
                        PlayerView(
                            apiClient: apiClient,
                            downloadRepository: downloadRepository,
                            initialMediaFileID: mediaFileID.uuidString,
                            initialTitle: detail.work.title,
                            suggestionsWorkID: detail.work.id
                        )
                    } label: {
                        Label("Play", systemImage: "play.fill").frame(minWidth: 112)
                    }
                    .buttonStyle(PlayarrPrimaryButtonStyle())

                    DownloadTriggerButton(
                        candidates: [candidate(mediaFileID: mediaFileID, title: detail.work.title, subtitle: nil)],
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                    .frame(width: 46, height: 46)
                    .foregroundStyle(PlayarrStyle.ink)
                    .background(PlayarrStyle.surfaceStrong.opacity(0.82), in: Circle())
                    .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }

                    if !writablePlaylists(for: detail.work).isEmpty {
                        Menu {
                            ForEach(writablePlaylists(for: detail.work)) { playlist in
                                Button(playlist.name) { add(detail.work, to: playlist) }
                            }
                        } label: {
                            Image(systemName: "plus")
                                .frame(width: 46, height: 46)
                                .foregroundStyle(PlayarrStyle.ink)
                                .background(PlayarrStyle.surfaceStrong.opacity(0.82), in: Circle())
                                .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                        }
                    }
                }
                .padding(.top, phone ? 24 : 30)
            }
        }
    }

    private func startResume(_ option: ResumeOption, detail: WorkDetail, record: Bool) {
        if record { Task { await viewModel.recordResumeChoice(option) } }
        resumePlay = ResumePlayRequest.make(
            option: option,
            detail: detail,
            workID: detail.work.id,
            seriesTitle: detail.work.title
        )
    }

    private func writablePlaylists(for work: Work) -> [Playlist] {
        let mediaType: PlaylistMediaType = work.kind == .artist ? .audio : .video
        return playlists.filter { !$0.isSystem && $0.mediaType == mediaType }
    }

    private func add(_ work: Work, to playlist: Playlist) {
        Task {
            do {
                _ = try await apiClient.addPlaylistItem(
                    playlistID: playlist.id,
                    body: AddPlaylistItemRequest(workID: work.id)
                )
                playlistMessage = "Added to \(playlist.name)."
            } catch let error as APIError {
                playlistMessage = error.displayMessage
            } catch {
                playlistMessage = error.localizedDescription
            }
        }
    }

    @ViewBuilder
    private func children(for children: WorkChildren) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            VStack(alignment: .leading, spacing: 34) {
                ForEach(seasons, id: \.season.id) { season in
                    seasonEpisodeTrack(season)
                }
            }
        case .artist(let albums):
            albumCoverFlow(albums)
        case .author(let books):
            VStack(alignment: .leading, spacing: 12) {
                Text("Books")
                    .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                ForEach(books) { book in
                    playableRow(title: book.book.title, subtitle: "Book", mediaFileID: book.mediaFileID)
                }
            }
        }
    }

    private func albumCoverFlow(_ albums: [AlbumDetail]) -> some View {
        let selected = albums.first(where: { $0.album.id == selectedAlbumID }) ?? albums.first
        return VStack(alignment: .leading, spacing: 22) {
            Text("Albums")
                .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)

            ScrollView(.horizontal) {
                LazyHStack(spacing: -20) {
                    ForEach(Array(albums.enumerated()), id: \.element.album.id) { index, album in
                        Button { selectedAlbumID = album.album.id } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                PlayarrAlbumArtwork(
                                    artistWorkID: album.album.artistWorkID,
                                    albumID: album.album.id,
                                    apiClient: apiClient
                                )
                                .frame(width: 164, height: 164)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(selectedAlbumID == album.album.id ? PlayarrStyle.pink : PlayarrStyle.lineStrong, lineWidth: selectedAlbumID == album.album.id ? 3 : 1)
                                }
                                Text(album.album.title).font(.caption.weight(.semibold)).lineLimit(1)
                                Text(album.album.releaseDate?.prefix(4) ?? Substring(album.album.albumType.rawValue.replacingOccurrences(of: "_", with: " ")))
                                    .font(.caption2).foregroundStyle(PlayarrStyle.muted)
                            }
                            .frame(width: 174, alignment: .leading)
                            .foregroundStyle(PlayarrStyle.ink)
                            .scaleEffect(selectedAlbumID == album.album.id ? 1.06 : 0.88)
                            .rotation3DEffect(
                                .degrees(selectedAlbumID == album.album.id ? 0 : (album.album.id == albums.first?.album.id ? 10 : -10)),
                                axis: (x: 0, y: 1, z: 0)
                            )
                            .zIndex(selectedAlbumID == album.album.id ? Double(albums.count + 1) : Double(albums.count - index))
                            .animation(.snappy, value: selectedAlbumID)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)

            if let selected {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(selected.album.title).font(.title3.weight(.semibold))
                        Text("\(selected.tracks.filter { $0.mediaFileID != nil }.count) playable tracks")
                            .font(.caption).foregroundStyle(PlayarrStyle.muted)
                    }
                    Spacer()
                    if let first = selected.tracks.first(where: { $0.mediaFileID != nil }), let mediaFileID = first.mediaFileID {
                        NavigationLink {
                            PlayerView(
                                apiClient: apiClient,
                                downloadRepository: downloadRepository,
                                initialMediaFileID: mediaFileID.uuidString,
                                initialTitle: first.track.title,
                                suggestionsWorkID: viewModel.detail?.work.id,
                                queue: PlaybackQueueBuilder.tracks(after: first.id, in: selected.tracks, albumTitle: selected.album.title),
                                advance: .immediate,
                                subtitle: selected.album.title
                            )
                        } label: { Label("Play", systemImage: "play.fill") }
                            .buttonStyle(PlayarrPrimaryButtonStyle())
                    }
                    DownloadTriggerButton(
                        candidates: selected.tracks.compactMap { track in
                            track.mediaFileID.map { candidate(mediaFileID: $0, title: track.track.title, subtitle: selected.album.title) }
                        },
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                    .accessibilityLabel("Download all tracks in this album")
                }
                .foregroundStyle(PlayarrStyle.ink)

                VStack(spacing: 0) {
                    let playableTracks = selected.tracks.filter { $0.mediaFileID != nil }
                    ForEach(Array(playableTracks.enumerated()), id: \.element.id) { index, track in
                        musicTrackRow(track, following: PlaybackQueueBuilder.tracks(after: track.id, in: playableTracks, albumTitle: selected.album.title), album: selected.album.title)
                        if index < playableTracks.count - 1 {
                            Divider().overlay(PlayarrStyle.line)
                        }
                    }
                }
                .background(PlayarrStyle.surfaceStrong.opacity(0.48), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PlayarrStyle.line, lineWidth: 1) }
            }
        }
    }

    /// Next episodes in series order (rest of season, then later seasons).
    private func episodeFollowing(_ episodeID: UUID) -> [PlaybackQueueEntry] {
        guard let detail = viewModel.detail, case .series(let seasons) = detail.children else { return [] }
        return PlaybackQueueBuilder.episodes(after: episodeID, seriesTitle: detail.work.title, seasons: seasons)
    }

    private func seasonEpisodeTrack(_ season: SeasonDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                    .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                Spacer()
                Text("\(season.episodes.count) episodes")
                    .font(.custom("Avenir Next", fixedSize: 10).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
                DownloadTriggerButton(
                    candidates: season.episodes.compactMap { episode in
                        episode.mediaFileID.map {
                            candidate(
                                mediaFileID: $0,
                                title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                                subtitle: season.season.title ?? "Season \(season.season.seasonNumber)"
                            )
                        }
                    },
                    apiClient: apiClient,
                    downloadRepository: downloadRepository
                )
                .foregroundStyle(PlayarrStyle.muted)
                .accessibilityLabel("Download all episodes in this season")
            }

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(season.episodes) { episode in
                        episodeCard(episode, seasonNumber: season.season.seasonNumber)
                    }
                }
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
        }
    }

    @ViewBuilder
    private func episodeCard(_ detail: EpisodeDetail, seasonNumber: Int32) -> some View {
        let episode = detail.episode
        let title = episode.title ?? "Episode \(episode.episodeNumber)"
        let label = "S\(String(format: "%02d", seasonNumber)) · E\(String(format: "%02d", episode.episodeNumber))"

        Group {
            if let mediaFileID = detail.mediaFileID {
                NavigationLink {
                    PlayerView(
                        apiClient: apiClient,
                        downloadRepository: downloadRepository,
                        initialMediaFileID: mediaFileID.uuidString,
                        initialTitle: title,
                        suggestionsWorkID: viewModel.detail?.work.id,
                        queue: episodeFollowing(detail.id),
                        subtitle: PlaybackQueueBuilder.episodeSubtitle(
                            series: viewModel.detail?.work.title ?? "",
                            season: seasonNumber,
                            episode: episode.episodeNumber
                        )
                    )
                } label: {
                    episodeCardLabel(title: title, label: label, playable: true)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Download", systemImage: "arrow.down.circle") {
                        downloadRepository.enqueue(
                            candidates: [candidate(mediaFileID: mediaFileID, title: title, subtitle: label)],
                            profile: nil,
                            keepUntil: .forever
                        )
                    }
                }
            } else {
                episodeCardLabel(title: title, label: label, playable: false)
            }
        }
    }

    private func episodeCardLabel(title: String, label: String, playable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            ZStack(alignment: .bottomLeading) {
                if let work = viewModel.detail?.work {
                    PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                } else {
                    PlayarrStyle.surfaceStrong
                }
                LinearGradient(colors: [.clear, .black.opacity(0.68)], startPoint: .center, endPoint: .bottom)
                HStack {
                    Text(label)
                        .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                        .foregroundStyle(.white)
                    Spacer()
                    Image(systemName: playable ? "play.fill" : "clock")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(.black.opacity(0.56), in: Circle())
                }
                .padding(10)
            }
            .frame(width: 210, height: 118)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(PlayarrStyle.lineStrong, lineWidth: 1) }

            Text(title)
                .font(.custom("Avenir Next", fixedSize: 12.5).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            Text(playable ? "Episode" : "Not available yet")
                .font(.custom("Avenir Next", fixedSize: 10).weight(.semibold))
                .foregroundStyle(PlayarrStyle.muted)
        }
        .frame(width: 210, alignment: .leading)
    }

    @ViewBuilder
    private func musicTrackRow(_ detail: TrackDetail, following: [PlaybackQueueEntry], album: String) -> some View {
        if let mediaFileID = detail.mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: detail.track.title,
                    suggestionsWorkID: viewModel.detail?.work.id,
                    queue: following,
                    advance: .immediate,
                    subtitle: album
                )
            } label: {
                HStack(spacing: 14) {
                    Text(String(format: "%02d", detail.track.trackNumber))
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(PlayarrStyle.muted)
                        .frame(width: 28)
                    Text(detail.track.title)
                        .font(.custom("Avenir Next", fixedSize: 13).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.ink)
                        .lineLimit(1)
                    Spacer()
                    if let seconds = detail.track.durationSeconds {
                        Text(Self.duration(seconds))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(PlayarrStyle.muted)
                    }
                    Image(systemName: "play.fill")
                        .font(.caption.bold())
                        .foregroundStyle(PlayarrStyle.pink)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Download", systemImage: "arrow.down.circle") {
                    downloadRepository.enqueue(
                        candidates: [candidate(mediaFileID: mediaFileID, title: detail.track.title, subtitle: nil)],
                        profile: nil,
                        keepUntil: .forever
                    )
                }
            }
        }
    }

    private static func duration(_ seconds: Int32) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    @ViewBuilder
    private func playableRow(title: String, subtitle: String, mediaFileID: UUID?) -> some View {
        if let mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: title,
                    suggestionsWorkID: viewModel.detail?.work.id
                )
            } label: {
                rowLabel(title: title, subtitle: subtitle, playable: true)
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Download", systemImage: "arrow.down.circle") {
                    downloadRepository.enqueue(
                        candidates: [candidate(mediaFileID: mediaFileID, title: title, subtitle: subtitle)],
                        profile: nil,
                        keepUntil: .forever
                    )
                }
            }
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
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
        .background(PlayarrStyle.surfaceStrong.opacity(0.68), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        WorkDetailView(
            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: UUID()),
            apiClient: apiClient,
            downloadRepository: DownloadRepository(apiClient: apiClient)
        )
    }
}
