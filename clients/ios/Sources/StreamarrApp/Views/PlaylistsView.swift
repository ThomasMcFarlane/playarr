import Observation
import StreamarrKit
import SwiftUI

@MainActor
@Observable
private final class PlaylistsViewModel {
    enum State { case idle, loading, loaded, failed(String) }
    var state: State = .idle
    var playlists: [Playlist] = []
    let apiClient: StreamarrAPIClient

    init(apiClient: StreamarrAPIClient) { self.apiClient = apiClient }

    func load() async {
        state = .loading
        do {
            playlists = try await apiClient.listPlaylists()
                .sorted { $0.updatedAt > $1.updatedAt }
            state = .loaded
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

struct PlaylistsView: View {
    @State private var viewModel: PlaylistsViewModel

    init(apiClient: StreamarrAPIClient) {
        _viewModel = State(initialValue: PlaylistsViewModel(apiClient: apiClient))
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading:
                PlayarrLoadingView(title: "Loading playlists…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load playlists", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                playlistList
            }
        }
        .task {
            if case .idle = viewModel.state { await viewModel.load() }
        }
        .navigationBarHidden(true)
    }

    private var playlistList: some View {
        GeometryReader { proxy in
            let phone = proxy.size.width <= 760
            let columns = phone ? 2 : 3
            let contentWidth = phone ? proxy.size.width : proxy.size.width * 0.65
            let leading: CGFloat = phone ? 16 : max(28, proxy.size.width * 0.028)
            let trailing: CGFloat = phone ? 16 : max(80, proxy.size.width * 0.065)
            let gap: CGFloat = phone ? 12 : min(28, proxy.size.width * 0.0135)
            let cardWidth = (contentWidth - leading - trailing - gap * CGFloat(columns - 1)) / CGFloat(columns)

            ZStack(alignment: .topLeading) {
                PlayarrStyle.surface

                RadialGradient(
                    colors: [PlayarrStyle.pink.opacity(0.11), .clear],
                    center: UnitPoint(x: 0.25, y: 0.48),
                    startRadius: 0,
                    endRadius: 360
                )

                ScrollView {
                    if viewModel.playlists.isEmpty {
                        VStack(spacing: 16) {
                            Image(systemName: "music.note.list")
                                .font(.system(size: 52, weight: .ultraLight))
                                .foregroundStyle(PlayarrStyle.pink)
                            Text("No playlists yet")
                                .font(.custom("Avenir Next", fixedSize: 22).weight(.semibold))
                            Text("Playlists created in Playarr appear here automatically.")
                                .font(.custom("Avenir Next", fixedSize: 12))
                                .foregroundStyle(PlayarrStyle.muted)
                        }
                        .foregroundStyle(PlayarrStyle.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.top, proxy.size.height * 0.34)
                    } else {
                        LazyVGrid(
                            columns: Array(repeating: GridItem(.fixed(cardWidth), spacing: gap, alignment: .top), count: columns),
                            alignment: .leading,
                            spacing: phone ? 26 : 36
                        ) {
                            ForEach(viewModel.playlists) { playlist in
                                NavigationLink {
                                    PlaylistDetailView(playlist: playlist, apiClient: viewModel.apiClient)
                                } label: {
                                    playlistCard(playlist, width: cardWidth)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.leading, leading)
                        .padding(.trailing, trailing)
                        .padding(.top, phone ? 92 : max(128, proxy.size.height * 0.15))
                        .padding(.bottom, phone ? 118 : 70)
                    }
                }
                .frame(width: contentWidth, height: proxy.size.height)
                .offset(x: phone ? 0 : proxy.size.width * 0.35)
                .scrollIndicators(.hidden)
                .refreshable { await viewModel.load() }
                .background {
                    if !phone {
                        LinearGradient(
                            colors: [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                }

                Text("Playlists")
                    .font(.custom("Avenir Next", fixedSize: phone ? 22 : min(34, proxy.size.width * 0.0175)).weight(.medium))
                    .tracking(phone ? -1 : -1.5)
                    .foregroundStyle(PlayarrStyle.ink)
                    .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                    .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(66, max(34, proxy.size.height * 0.052)))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea()
    }

    private func playlistCard(_ playlist: Playlist, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)), style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    PlayarrStyle.pink.opacity(0.18 + Double(index) * 0.07),
                                    PlayarrStyle.surfaceStrong,
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)))
                                .stroke(PlayarrStyle.lineStrong, lineWidth: 1)
                        }
                        .offset(x: CGFloat(index - 1) * width * 0.055, y: CGFloat(abs(index - 1)) * 5)
                }
                Image(systemName: playlist.mediaType == .audio ? "music.note" : "play.rectangle")
                    .font(.system(size: width * 0.16, weight: .ultraLight))
                    .foregroundStyle(PlayarrStyle.pink)
            }
            .frame(width: width, height: width * 0.625)

            Text(playlist.name)
                .font(.custom("Avenir Next", fixedSize: width <= 210 ? 12.5 : 11).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            Text(playlist.isSystem ? "System playlist" : "Personal playlist")
                .font(.custom("Avenir Next", fixedSize: width <= 210 ? 10 : 8.5).weight(.semibold))
                .foregroundStyle(PlayarrStyle.muted)
        }
        .frame(width: width, alignment: .leading)
    }
}

private struct PlaylistDetailView: View {
    let playlist: Playlist
    let apiClient: StreamarrAPIClient
    @State private var works: [Work] = []
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        Group {
            if loading {
                PlayarrLoadingView(title: "Loading \(playlist.name)…")
            } else if let errorMessage {
                PlayarrFailureView(title: "Couldn’t load playlist", message: errorMessage) { load() }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(works) { work in
                            NavigationLink {
                                WorkDetailView(
                                    viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                    apiClient: apiClient
                                )
                            } label: {
                                HStack(spacing: 14) {
                                    PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                                        .frame(width: 120, height: 74)
                                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(work.title).font(.headline).lineLimit(2)
                                        Text(work.kind.displayName)
                                            .font(.caption2.bold())
                                            .foregroundStyle(PlayarrStyle.muted)
                                    }
                                    Spacer()
                                }
                                .foregroundStyle(PlayarrStyle.ink)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(18)
                }
                .background(PlayarrStyle.background)
            }
        }
        .navigationTitle(playlist.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadItems() }
    }

    private func load() { Task { await loadItems() } }

    private func loadItems() async {
        loading = true
        errorMessage = nil
        do {
            let items = try await apiClient.listPlaylistItems(playlistID: playlist.id)
                .sorted { $0.position < $1.position }
            var resolved: [Work] = []
            for item in items {
                if let detail = try? await apiClient.fetchWork(id: item.workID) {
                    resolved.append(detail.work)
                }
            }
            works = resolved
        } catch let error as APIError {
            errorMessage = error.displayMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }
}
