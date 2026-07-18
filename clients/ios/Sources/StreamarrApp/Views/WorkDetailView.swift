import StreamarrKit
import SwiftUI

struct WorkDetailView: View {
    let viewModel: WorkDetailViewModel
    let apiClient: StreamarrAPIClient
    @Environment(\.dismiss) private var dismiss

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
        GeometryReader { proxy in
            let phone = proxy.size.width <= 760
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

            if hasVisibleChildren(detail.children) {
                ScrollView(.vertical) {
                    children(for: detail.children)
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

            if let mediaFileID = detail.mediaFileID {
                NavigationLink {
                    PlayerView(
                        viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient),
                        initialMediaFileID: mediaFileID.uuidString,
                        initialTitle: detail.work.title
                    )
                } label: {
                    Label("Play", systemImage: "play.fill")
                        .frame(minWidth: 112)
                }
                .buttonStyle(PlayarrPrimaryButtonStyle())
                .padding(.top, phone ? 24 : 30)
            }
        }
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
                            .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
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
                            .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
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
                    .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
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
            apiClient: apiClient
        )
    }
}
