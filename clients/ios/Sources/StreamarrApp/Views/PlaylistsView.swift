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

    func create(name: String, mediaType: PlaylistMediaType, parentID: UUID?) async throws {
        let playlist = try await apiClient.createPlaylist(
            CreatePlaylistRequest(name: name, mediaType: mediaType, parentPlaylistID: parentID)
        )
        playlists.insert(playlist, at: 0)
    }

    func rename(_ playlist: Playlist, to name: String) async throws {
        let updated = try await apiClient.updatePlaylist(
            id: playlist.id,
            body: UpdatePlaylistRequest(name: name, parentPlaylistID: playlist.parentPlaylistID)
        )
        if let index = playlists.firstIndex(where: { $0.id == playlist.id }) { playlists[index] = updated }
    }

    func delete(_ playlist: Playlist) async throws {
        try await apiClient.deletePlaylist(id: playlist.id)
        playlists.removeAll { $0.id == playlist.id || $0.parentPlaylistID == playlist.id }
    }
}

struct PlaylistsView: View {
    @State private var viewModel: PlaylistsViewModel
    @State private var showingCreate = false
    @State private var playlistName = ""
    @State private var playlistType: PlaylistMediaType = .video
    @State private var parentID: UUID?
    @State private var editingPlaylist: Playlist?
    @State private var deletingPlaylist: Playlist?
    @State private var mutationError: String?
    @State private var submitting = false

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
        .sheet(isPresented: $showingCreate) { playlistEditor }
        .alert("Rename playlist", isPresented: Binding(
            get: { editingPlaylist != nil },
            set: { if !$0 { editingPlaylist = nil } }
        )) {
            TextField("Playlist name", text: $playlistName)
            Button("Cancel", role: .cancel) { editingPlaylist = nil }
            Button("Save") { renamePlaylist() }.disabled(playlistName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .confirmationDialog(
            "Delete \(deletingPlaylist?.name ?? "playlist")?",
            isPresented: Binding(
                get: { deletingPlaylist != nil },
                set: { if !$0 { deletingPlaylist = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete playlist and nested playlists", role: .destructive) { deletePlaylist() }
            Button("Cancel", role: .cancel) { deletingPlaylist = nil }
        } message: {
            Text("This cannot be undone.")
        }
        .alert("Couldn’t update playlist", isPresented: Binding(
            get: { mutationError != nil },
            set: { if !$0 { mutationError = nil } }
        )) { Button("OK") { mutationError = nil } } message: { Text(mutationError ?? "") }
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
                                .contextMenu {
                                    if !playlist.isSystem {
                                        Button("Rename", systemImage: "pencil") {
                                            playlistName = playlist.name
                                            editingPlaylist = playlist
                                        }
                                        Button("Delete", systemImage: "trash", role: .destructive) {
                                            deletingPlaylist = playlist
                                        }
                                    }
                                }
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

                HStack(spacing: 12) {
                    Text("Playlists")
                        .font(.custom("Avenir Next", fixedSize: phone ? 22 : min(34, proxy.size.width * 0.0175)).weight(.medium))
                        .tracking(phone ? -1 : -1.5)
                    Spacer()
                    Button {
                        playlistName = ""
                        playlistType = .video
                        parentID = nil
                        showingCreate = true
                    } label: {
                        Label(phone ? "" : "Create", systemImage: "plus")
                            .font(.custom("Avenir Next", fixedSize: 12).weight(.bold))
                            .frame(minWidth: 42, minHeight: 42)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(PlayarrStyle.ink)
                    .background(PlayarrStyle.surfaceStrong.opacity(0.82), in: Capsule())
                    .overlay { Capsule().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                }
                .foregroundStyle(PlayarrStyle.ink)
                .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                .padding(.trailing, phone ? 66 : max(22, proxy.size.width * 0.024))
                .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(66, max(34, proxy.size.height * 0.052)))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea()
    }

    private var playlistEditor: some View {
        NavigationStack {
            Form {
                Section("Playlist") {
                    TextField("Name", text: $playlistName)
                    Picker("Media", selection: $playlistType) {
                        Label("Video", systemImage: "play.rectangle").tag(PlaylistMediaType.video)
                        Label("Music", systemImage: "music.note").tag(PlaylistMediaType.audio)
                    }
                    .pickerStyle(.segmented)
                }
                Section("Parent playlist") {
                    Picker("Parent", selection: $parentID) {
                        Text("None · top level").tag(Optional<UUID>.none)
                        ForEach(viewModel.playlists.filter { !$0.isSystem && $0.mediaType == playlistType }) { playlist in
                            Text(playlist.name).tag(Optional(playlist.id))
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PlayarrStyle.background)
            .navigationTitle("Create playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showingCreate = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitting ? "Creating…" : "Create") { createPlaylist() }
                        .disabled(submitting || playlistName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
    }

    private func createPlaylist() {
        let name = playlistName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        submitting = true
        Task {
            do {
                try await viewModel.create(name: name, mediaType: playlistType, parentID: parentID)
                showingCreate = false
            } catch let error as APIError { mutationError = error.displayMessage }
            catch { mutationError = error.localizedDescription }
            submitting = false
        }
    }

    private func renamePlaylist() {
        guard let playlist = editingPlaylist else { return }
        let name = playlistName.trimmingCharacters(in: .whitespacesAndNewlines)
        editingPlaylist = nil
        Task {
            do { try await viewModel.rename(playlist, to: name) }
            catch let error as APIError { mutationError = error.displayMessage }
            catch { mutationError = error.localizedDescription }
        }
    }

    private func deletePlaylist() {
        guard let playlist = deletingPlaylist else { return }
        deletingPlaylist = nil
        Task {
            do { try await viewModel.delete(playlist) }
            catch let error as APIError { mutationError = error.displayMessage }
            catch { mutationError = error.localizedDescription }
        }
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

struct PlaylistDetailView: View {
    let playlist: Playlist
    let apiClient: StreamarrAPIClient
    @State private var items: [PlaylistItem] = []
    @State private var worksByID: [UUID: Work] = [:]
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        Group {
            if loading {
                PlayarrLoadingView(title: "Loading \(playlist.name)…")
            } else if let errorMessage {
                PlayarrFailureView(title: "Couldn’t load playlist", message: errorMessage) { load() }
            } else {
                List {
                    if items.isEmpty {
                        ContentUnavailableView(
                            "Playlist is empty",
                            systemImage: "music.note.list",
                            description: Text("Add a title from its detail page.")
                        )
                        .listRowBackground(Color.clear)
                    }
                    ForEach(items) { item in
                        if let work = worksByID[item.workID] {
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
                                .padding(.vertical, 5)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .onDelete { offsets in remove(at: offsets) }
                    .onMove { source, destination in move(from: source, to: destination) }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(PlayarrStyle.background)
            }
        }
        .navigationTitle(playlist.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if !playlist.isSystem { EditButton() } }
        .task { await loadItems() }
    }

    private func load() { Task { await loadItems() } }

    private func loadItems() async {
        loading = true
        errorMessage = nil
        do {
            items = try await apiClient.listPlaylistItems(playlistID: playlist.id)
                .sorted { $0.position < $1.position }
            var resolved: [UUID: Work] = [:]
            for item in items {
                if let detail = try? await apiClient.fetchWork(id: item.workID) {
                    resolved[item.workID] = detail.work
                }
            }
            worksByID = resolved
        } catch let error as APIError {
            errorMessage = error.displayMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    private func remove(at offsets: IndexSet) {
        let removed = offsets.map { items[$0] }
        items.remove(atOffsets: offsets)
        Task {
            do {
                for item in removed { try await apiClient.removePlaylistItem(playlistID: playlist.id, itemID: item.id) }
            } catch {
                await loadItems()
            }
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        items.move(fromOffsets: source, toOffset: destination)
        let order = items.map(\.id)
        Task {
            do { items = try await apiClient.reorderPlaylistItems(playlistID: playlist.id, body: ReorderPlaylistItemsRequest(itemIDs: order)) }
            catch { await loadItems() }
        }
    }
}
