import Observation
import StreamarrKit
import SwiftUI

@MainActor
@Observable
private final class PlaylistsViewModel {
    enum State { case idle, loading, loaded, failed(String) }
    var state: State = .idle
    var playlists: [Playlist] = []
    var coverWorksByPlaylist: [UUID: [Work]] = [:]
    var itemCountByPlaylist: [UUID: Int] = [:]
    let apiClient: StreamarrAPIClient

    init(apiClient: StreamarrAPIClient) { self.apiClient = apiClient }

    func load() async {
        state = .loading
        do {
            let loaded = try await apiClient.listPlaylists()
                .sorted { $0.updatedAt > $1.updatedAt }
            playlists = loaded
            state = .loaded
            await loadDirectorySummaries(for: loaded)
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

    func childCount(for playlist: Playlist) -> Int {
        playlists.count { $0.parentPlaylistID == playlist.id }
    }

    private func loadDirectorySummaries(for playlists: [Playlist]) async {
        let itemGroups = await withTaskGroup(of: (UUID, [PlaylistItem]).self, returning: [UUID: [PlaylistItem]].self) { group in
            for playlist in playlists {
                group.addTask {
                    (playlist.id, (try? await self.apiClient.listPlaylistItems(playlistID: playlist.id)) ?? [])
                }
            }
            var result: [UUID: [PlaylistItem]] = [:]
            for await (playlistID, items) in group { result[playlistID] = items }
            return result
        }
        itemCountByPlaylist = itemGroups.mapValues(\.count)

        let workIDs = Set(itemGroups.values.flatMap { $0.prefix(3).map(\.workID) })
        let works = await withTaskGroup(of: (UUID, Work?).self, returning: [UUID: Work].self) { group in
            for workID in workIDs {
                group.addTask { (workID, try? await self.apiClient.fetchWork(id: workID).work) }
            }
            var result: [UUID: Work] = [:]
            for await (workID, work) in group {
                if let work { result[workID] = work }
            }
            return result
        }

        coverWorksByPlaylist = itemGroups.mapValues { items in
            items.prefix(3).compactMap { works[$0.workID] }
        }
    }
}

struct PlaylistsView: View {
    @State private var viewModel: PlaylistsViewModel
    let downloadRepository: DownloadRepository
    @State private var showingCreate = false
    @State private var playlistName = ""
    @State private var playlistType: PlaylistMediaType = .video
    @State private var parentID: UUID?
    @State private var editingPlaylist: Playlist?
    @State private var deletingPlaylist: Playlist?
    @State private var mutationError: String?
    @State private var submitting = false

    init(apiClient: StreamarrAPIClient, downloadRepository: DownloadRepository) {
        _viewModel = State(initialValue: PlaylistsViewModel(apiClient: apiClient))
        self.downloadRepository = downloadRepository
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
            let phone = PlayarrLayout.isPhone(proxy.size)
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
                                    PlaylistDetailView(playlist: playlist, apiClient: viewModel.apiClient, downloadRepository: downloadRepository)
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
                let coverWorks = viewModel.coverWorksByPlaylist[playlist.id] ?? []
                if coverWorks.isEmpty {
                    RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)), style: .continuous)
                        .fill(LinearGradient(colors: [PlayarrStyle.pink.opacity(0.24), PlayarrStyle.surfaceStrong], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .overlay {
                            RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)))
                                .stroke(PlayarrStyle.lineStrong, lineWidth: 1)
                        }
                    Text(playlist.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PlayarrStyle.muted)
                        .lineLimit(2)
                        .padding(16)
                } else {
                    ForEach(Array(coverWorks.enumerated()), id: \.element.id) { index, work in
                        PlayarrArtwork(work: work, kind: .poster, apiClient: viewModel.apiClient)
                            .frame(width: width * 0.86, height: width * 0.61)
                            .clipShape(RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)), style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: min(13, max(8, width * 0.058)))
                                    .stroke(PlayarrStyle.lineStrong, lineWidth: 1)
                            }
                            .rotationEffect(.degrees((Double(index) - Double(coverWorks.count - 1) / 2) * -1.5))
                            .offset(x: CGFloat(index) * width * 0.022, y: CGFloat(index) * 4)
                            .zIndex(Double(coverWorks.count - index))
                    }
                }
            }
            .frame(width: width, height: width * 0.625)

            Text(playlist.name)
                .font(.custom("Avenir Next", fixedSize: width <= 210 ? 12.5 : 11).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            Text(playlistMetadata(playlist))
                .font(.custom("Avenir Next", fixedSize: width <= 210 ? 10 : 8.5).weight(.semibold))
                .foregroundStyle(PlayarrStyle.muted)
                .lineLimit(2)
        }
        .frame(width: width, alignment: .leading)
    }

    private func playlistMetadata(_ playlist: Playlist) -> String {
        let media = playlist.mediaType == .audio ? "Audio" : "Video"
        let ownership = playlist.isSystem ? "Shared" : "Personal"
        let items = viewModel.itemCountByPlaylist[playlist.id] ?? 0
        let children = viewModel.childCount(for: playlist)
        return "\(media) · \(ownership) · \(items) \(items == 1 ? "item" : "items")" +
            (children > 0 ? " · \(children) \(children == 1 ? "folder" : "folders")" : "")
    }
}

struct PlaylistDetailView: View {
    private struct ResolvedItem: Sendable {
        let work: Work
        let title: String
        let subtitle: String
    }

    let playlist: Playlist
    let apiClient: StreamarrAPIClient
    let downloadRepository: DownloadRepository
    @Environment(\.dismiss) private var dismiss
    @State private var items: [PlaylistItem] = []
    @State private var resolvedByItemID: [UUID: ResolvedItem] = [:]
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        Group {
            if loading {
                PlayarrLoadingView(title: "Loading \(playlist.name)…")
            } else if let errorMessage {
                PlayarrFailureView(title: "Couldn’t load playlist", message: errorMessage) { load() }
            } else {
                playlistStage
            }
        }
        .navigationBarHidden(true)
        .task { await loadItems() }
    }

    private var playlistStage: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            let firstWork = items.compactMap { resolvedByItemID[$0.id]?.work }.first
            ZStack(alignment: .topLeading) {
                PlayarrStyle.surface
                if let firstWork {
                    PlayarrArtwork(work: firstWork, kind: .backdrop, apiClient: apiClient)
                        .frame(width: proxy.size.width, height: phone ? proxy.size.height * 0.46 : proxy.size.height)
                        .opacity(phone ? 0.34 : 0.68)
                        .overlay {
                            LinearGradient(
                                colors: phone
                                    ? [.clear, PlayarrStyle.surface]
                                    : [PlayarrStyle.surface.opacity(0.44), .clear, PlayarrStyle.surface.opacity(0.18)],
                                startPoint: phone ? .top : .leading,
                                endPoint: phone ? .bottom : .trailing
                            )
                        }
                }

                if !phone {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(playlist.mediaType == .audio ? "AUDIO · \(playlist.isSystem ? "SHARED" : "PERSONAL")" : "VIDEO · \(playlist.isSystem ? "SHARED" : "PERSONAL")")
                            .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                            .tracking(1.1)
                            .foregroundStyle(PlayarrStyle.pink)
                        Text(playlist.name)
                            .font(.custom("Avenir Next", fixedSize: 52).weight(.medium))
                            .tracking(-3.7)
                            .lineLimit(3)
                            .foregroundStyle(PlayarrStyle.ink)
                        Text("\(items.count) \(items.count == 1 ? "item" : "items")")
                            .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
                            .foregroundStyle(PlayarrStyle.muted)
                    }
                    .frame(width: proxy.size.width * 0.25, alignment: .leading)
                    .padding(.leading, max(102, proxy.size.width * 0.08))
                    .padding(.top, proxy.size.height * 0.27)
                }

                playlistTrack(phone: phone, proxy: proxy)

                HStack(spacing: 14) {
                    Button { dismiss() } label: {
                        Image(systemName: "arrow.left")
                            .frame(width: 44, height: 44)
                            .background(PlayarrStyle.surfaceStrong.opacity(0.76), in: Circle())
                            .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                    }
                    Text(playlist.name)
                        .font(.custom("Avenir Next", fixedSize: phone ? 22 : 30).weight(.medium))
                        .tracking(-1)
                        .lineLimit(1)
                    Text("\(items.count) ITEMS")
                        .font(.custom("Avenir Next", fixedSize: 9).weight(.bold))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .foregroundStyle(PlayarrStyle.ink)
                .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(66, max(34, proxy.size.height * 0.052)))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea()
    }

    private func playlistTrack(phone: Bool, proxy: GeometryProxy) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(playlist.name)
                        .font(.custom("Avenir Next", fixedSize: phone ? 16 : 14).weight(.semibold))
                    Spacer()
                    Text("\(playlist.mediaType.rawValue.capitalized) · \(items.count) items")
                        .font(.custom("Avenir Next", fixedSize: phone ? 10 : 9).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .foregroundStyle(PlayarrStyle.ink)
                .padding(.horizontal, phone ? 16 : 24)

                if items.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "music.note.list")
                            .font(.system(size: 40, weight: .ultraLight))
                            .foregroundStyle(PlayarrStyle.pink)
                        Text("Playlist is empty").font(.headline)
                        Text("Add a title from its detail page.")
                            .font(.caption).foregroundStyle(PlayarrStyle.muted)
                    }
                    .foregroundStyle(PlayarrStyle.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 54)
                } else {
                    ScrollView(.horizontal) {
                        LazyHStack(alignment: .top, spacing: phone ? 12 : 18) {
                            ForEach(items) { item in
                                if let resolved = resolvedByItemID[item.id] {
                                    playlistItemCard(item, resolved: resolved, width: phone ? min(210, proxy.size.width * 0.46) : 190)
                                } else {
                                    playlistItemPlaceholder(width: phone ? min(210, proxy.size.width * 0.46) : 190)
                                }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .contentMargins(.horizontal, phone ? 16 : 24, for: .scrollContent)
                    .scrollIndicators(.hidden)
                }
            }
            .padding(.top, phone ? max(122, proxy.size.height * 0.34) : proxy.size.height * 0.5)
            .padding(.bottom, phone ? 120 : proxy.size.height * 0.5)
        }
        .frame(width: phone ? proxy.size.width : proxy.size.width * 0.62, height: proxy.size.height)
        .offset(x: phone ? 0 : proxy.size.width * 0.38)
        .background {
            LinearGradient(
                colors: phone ? [.clear, PlayarrStyle.surface] : [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                startPoint: phone ? .top : .leading,
                endPoint: phone ? .bottom : .trailing
            )
        }
        .scrollIndicators(.hidden)
    }

    private func playlistItemCard(_ item: PlaylistItem, resolved: ResolvedItem, width: CGFloat) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: resolved.work.id),
                apiClient: apiClient,
                downloadRepository: downloadRepository
            )
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                PlayarrArtwork(work: resolved.work, kind: .backdrop, apiClient: apiClient)
                    .frame(width: width, height: width * 9 / 16)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                Text(resolved.title)
                    .font(.custom("Avenir Next", fixedSize: 12.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(1)
                Text(resolved.subtitle)
                    .font(.custom("Avenir Next", fixedSize: 10).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineLimit(1)
            }
            .frame(width: width, alignment: .leading)
        }
        .buttonStyle(.plain)
        .contextMenu {
            if !playlist.isSystem {
                Button("Move earlier", systemImage: "arrow.left") { move(item, by: -1) }
                Button("Move later", systemImage: "arrow.right") { move(item, by: 1) }
                Button("Remove from playlist", systemImage: "minus.circle", role: .destructive) { remove(item) }
            }
        }
    }

    private func playlistItemPlaceholder(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(PlayarrStyle.surfaceStrong.opacity(0.72))
                .frame(width: width, height: width * 9 / 16)
                .overlay { ProgressView().tint(PlayarrStyle.pink) }
            RoundedRectangle(cornerRadius: 3).fill(PlayarrStyle.lineStrong).frame(width: width * 0.7, height: 10)
            RoundedRectangle(cornerRadius: 3).fill(PlayarrStyle.line).frame(width: width * 0.42, height: 8)
        }
        .frame(width: width, alignment: .leading)
        .accessibilityLabel("Loading playlist item")
    }

    private func load() { Task { await loadItems() } }

    private func loadItems() async {
        loading = true
        errorMessage = nil
        do {
            items = try await apiClient.listPlaylistItems(playlistID: playlist.id)
                .sorted { $0.position < $1.position }
            let loadedItems = items
            resolvedByItemID = [:]
            loading = false
            await withTaskGroup(of: (PlaylistItem, WorkDetail?).self) { group in
                for item in loadedItems {
                    group.addTask { (item, try? await apiClient.fetchWork(id: item.workID)) }
                }
                for await (item, detail) in group {
                    guard let detail else { continue }
                    let track = item.trackID.flatMap { trackID -> TrackDetail? in
                        guard case .artist(let albums) = detail.children else { return nil }
                        return albums.lazy.flatMap(\.tracks).first { $0.track.id == trackID }
                    }
                    resolvedByItemID[item.id] = ResolvedItem(
                        work: detail.work,
                        title: track?.track.title ?? detail.work.title,
                        subtitle: track.map { "\(detail.work.title) · Track \($0.track.trackNumber)" } ?? detail.work.kind.displayName
                    )
                }
            }
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

    private func remove(_ item: PlaylistItem) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        remove(at: IndexSet(integer: index))
    }

    private func move(_ item: PlaylistItem, by delta: Int) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        let target = min(max(0, index + delta), items.count - 1)
        guard index != target else { return }
        let moved = items.remove(at: index)
        items.insert(moved, at: target)
        persistOrder()
    }

    private func persistOrder() {
        let order = items.map(\.id)
        Task {
            do { items = try await apiClient.reorderPlaylistItems(playlistID: playlist.id, body: ReorderPlaylistItemsRequest(itemIDs: order)) }
            catch { await loadItems() }
        }
    }
}
