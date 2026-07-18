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
        ScrollView {
            LazyVStack(spacing: 12) {
                if viewModel.playlists.isEmpty {
                    VStack(spacing: 14) {
                        Image(systemName: "music.note.list")
                            .font(.system(size: 40, weight: .light))
                            .foregroundStyle(PlayarrStyle.pink)
                        Text("No playlists yet").font(.title3.weight(.bold))
                        Text("Playlists created in Playarr appear here automatically.")
                            .font(.footnote)
                            .foregroundStyle(PlayarrStyle.inkSoft)
                    }
                    .padding(.top, 90)
                } else {
                    ForEach(viewModel.playlists) { playlist in
                        NavigationLink {
                            PlaylistDetailView(playlist: playlist, apiClient: viewModel.apiClient)
                        } label: {
                            HStack(spacing: 16) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .fill(PlayarrStyle.ink.gradient)
                                    Image(systemName: playlist.mediaType == .audio ? "music.note" : "play.rectangle")
                                        .font(.title2)
                                        .foregroundStyle(.white)
                                }
                                .frame(width: 64, height: 64)

                                VStack(alignment: .leading, spacing: 5) {
                                    Text(playlist.name)
                                        .font(.headline)
                                        .foregroundStyle(PlayarrStyle.ink)
                                    Text(playlist.isSystem ? "System playlist" : "Personal playlist")
                                        .font(.caption)
                                        .foregroundStyle(PlayarrStyle.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.bold())
                                    .foregroundStyle(PlayarrStyle.muted)
                            }
                            .padding(14)
                            .background(PlayarrStyle.surface.opacity(0.78), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 96)
            .padding(.bottom, 112)
        }
        .refreshable { await viewModel.load() }
        .background(PlayarrStyle.background)
        .overlay(alignment: .topLeading) {
            Text("Playlists")
                .font(.system(size: 32, weight: .medium, design: .rounded))
                .tracking(-1.2)
                .foregroundStyle(PlayarrStyle.ink)
                .padding(.top, 54)
                .padding(.horizontal, 18)
        }
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
