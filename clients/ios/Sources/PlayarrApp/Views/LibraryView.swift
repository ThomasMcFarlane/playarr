import PlayarrKit
import SwiftUI

struct LibraryView: View {
    @State private var viewModel: LibraryViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    let title: String
    @State private var showingFilters = false
    @State private var downloadTarget: Work?

    init(kind: WorkKind?, apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository, title: String? = nil) {
        let viewModel = LibraryViewModel(apiClient: apiClient)
        viewModel.selectedKind = kind
        viewModel.isSearchMode = kind == nil
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.title = title ?? kind?.displayName ?? "Search"
    }

    init(viewModel: LibraryViewModel, apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository) {
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.title = viewModel.selectedKind?.displayName ?? "Library"
    }

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: viewModel.searchText.isEmpty ? "Loading \(title.lowercased())…" : "Searching…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load \(title.lowercased())", message: message) {
                    Task { await viewModel.load() }
                }
            case .empty:
                stage { emptyState }
            case .loaded:
                stage { libraryContent }
            }
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
        }
        .navigationBarHidden(true)
        .sheet(isPresented: $showingFilters) { filterSheet }
        .sheet(item: $downloadTarget) { work in
            WorkDownloadSheet(work: work, apiClient: apiClient, downloadRepository: downloadRepository)
        }
    }

    private func stage<Content: View>(@ViewBuilder content: @escaping () -> Content) -> some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack(alignment: .topLeading) {
                if !phone, let preview = viewModel.works.first {
                    PlayarrArtwork(work: preview, kind: .backdrop, apiClient: apiClient)
                        .frame(width: proxy.size.width * 0.52, height: proxy.size.height)
                        .opacity(0.68)
                        .overlay {
                            LinearGradient(
                                colors: [PlayarrStyle.surface.opacity(0.2), PlayarrStyle.surface],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        }
                    previewCopy(preview)
                        .frame(width: proxy.size.width * 0.24, alignment: .leading)
                        .padding(.leading, max(102, proxy.size.width * 0.08))
                        .padding(.top, proxy.size.height * 0.24)
                        .zIndex(2)
                }

                content().zIndex(1)

                pageHeading(phone: phone, proxy: proxy).zIndex(3)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(PlayarrStyle.surface)
        .ignoresSafeArea()
    }

    private var libraryContent: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            let panelWidth = phone ? proxy.size.width : proxy.size.width * 0.65
            let columnCount = viewModel.viewMode == .list ? 1 : (viewModel.viewMode == .cover ? (phone ? 3 : 5) : (phone ? 2 : 3))
            let gutter: CGFloat = phone ? 16 : max(28, proxy.size.width * 0.028)
            let trailing: CGFloat = phone ? 16 : max(80, proxy.size.width * 0.065)
            let gap: CGFloat = phone ? 12 : min(28, proxy.size.width * 0.0135)
            let cardWidth = (panelWidth - gutter - trailing - gap * CGFloat(columnCount - 1)) / CGFloat(columnCount)

            Group {
                if viewModel.viewMode == .coverFlow {
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: -34) {
                            ForEach(Array(viewModel.works.enumerated()), id: \.element.id) { index, work in
                                NavigationLink {
                                    WorkDetailView(
                                        viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                        apiClient: apiClient,
                                        downloadRepository: downloadRepository
                                    )
                                } label: {
                                    PlayarrArtwork(work: work, kind: .poster, apiClient: apiClient)
                                        .frame(width: phone ? 176 : 220, height: phone ? 264 : 330)
                                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                        .overlay(alignment: .bottomLeading) {
                                            Text(work.title)
                                                .font(.caption.weight(.bold)).foregroundStyle(.white)
                                                .lineLimit(2).padding(12)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                                .background(.black.opacity(0.48))
                                        }
                                        .rotation3DEffect(.degrees(index.isMultiple(of: 2) ? 7 : -7), axis: (x: 0, y: 1, z: 0))
                                        .shadow(color: .black.opacity(0.34), radius: 18, y: 10)
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button("Download", systemImage: "arrow.down.circle") { downloadTarget = work }
                                }
                                .task { if work.id == viewModel.works.last?.id { await viewModel.loadMore() } }
                            }
                        }
                        .scrollTargetLayout()
                        .padding(.horizontal, gutter + 24)
                    }
                    .contentMargins(.top, phone ? 112 : max(150, proxy.size.height * 0.19), for: .scrollContent)
                    .contentMargins(.bottom, phone ? 130 : 70, for: .scrollContent)
                    .scrollTargetBehavior(.viewAligned)
                } else {
                    ScrollView(.vertical) {
                        LazyVGrid(
                    columns: Array(repeating: GridItem(.fixed(cardWidth), spacing: gap, alignment: .top), count: columnCount),
                    alignment: .leading,
                    spacing: phone ? 24 : min(36, proxy.size.height * 0.025)
                        ) {
                    ForEach(viewModel.playlists) { playlist in
                        NavigationLink {
                            PlaylistDetailView(playlist: playlist, apiClient: apiClient, downloadRepository: downloadRepository)
                        } label: {
                            playlistSearchCard(playlist, width: cardWidth)
                        }
                        .buttonStyle(.plain)
                    }
                    ForEach(viewModel.works) { work in
                        NavigationLink {
                            WorkDetailView(
                                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                apiClient: apiClient,
                                downloadRepository: downloadRepository
                            )
                        } label: {
                            if viewModel.viewMode == .list {
                                libraryListRow(work, width: cardWidth)
                            } else {
                                PlayarrMediaCard(work: work, apiClient: apiClient, width: cardWidth)
                            }
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Download", systemImage: "arrow.down.circle") { downloadTarget = work }
                        }
                        .task {
                            if work.id == viewModel.works.last?.id { await viewModel.loadMore() }
                        }
                    }
                    if viewModel.isLoadingMore { ProgressView().tint(PlayarrStyle.pink).frame(width: cardWidth, height: 80) }
                        }
                        .padding(.leading, gutter)
                        .padding(.trailing, trailing)
                        .padding(.top, phone ? 92 : max(128, proxy.size.height * 0.15))
                        .padding(.bottom, phone ? 118 : max(48, proxy.size.height * 0.06))
                    }
                }
            }
            .frame(width: panelWidth, height: proxy.size.height)
            .offset(x: phone ? 0 : proxy.size.width * 0.35)
            .refreshable { await viewModel.load() }
            .scrollIndicators(.hidden)
            .background {
                if phone {
                    PlayarrStyle.surface.opacity(0.96)
                } else {
                    LinearGradient(
                        colors: [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
            }
        }
    }

    private func previewCopy(_ work: Work) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(work.kind.displayName.uppercased())
                .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                .tracking(1.1)
                .foregroundStyle(PlayarrStyle.pink)
                .padding(.bottom, 24)
            Text(work.title)
                .font(.custom("Avenir Next", fixedSize: 48).weight(.medium))
                .tracking(-3.45)
                .lineSpacing(-5)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(3)
            Text(work.genres.prefix(2).joined(separator: "  •  "))
                .font(.custom("Avenir Next", fixedSize: 10).weight(.semibold))
                .foregroundStyle(PlayarrStyle.inkSoft)
                .padding(.top, 22)
            if let overview = work.overview {
                Text(overview)
                    .font(.custom("Avenir Next", fixedSize: 11))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineSpacing(5)
                    .lineLimit(5)
                    .padding(.top, 18)
            }
        }
    }

    private func pageHeading(phone: Bool, proxy: GeometryProxy) -> some View {
        HStack(spacing: phone ? 10 : 20) {
            Text(title)
                .font(.custom("Avenir Next", fixedSize: phone ? 22 : min(34, proxy.size.width * 0.0175)).weight(.medium))
                .tracking(phone ? -1 : -1.5)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            if !phone, let total = viewModel.total {
                Rectangle().fill(PlayarrStyle.lineStrong).frame(width: 1, height: 22)
                Text("\(total) TITLES")
                    .font(.custom("Avenir Next", fixedSize: 9).weight(.bold))
                    .tracking(0.4)
                    .foregroundStyle(PlayarrStyle.muted)
            }

            Spacer()

            if title == "Search" {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                    TextField("Search your library", text: $viewModel.searchText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.load() } }
                        .onChange(of: viewModel.searchText) { _, value in
                            if value.isEmpty { Task { await viewModel.load() } }
                        }
                }
                .font(.custom("Avenir Next", fixedSize: 12))
                .foregroundStyle(PlayarrStyle.inkSoft)
                .padding(.horizontal, 12)
                .frame(width: phone ? 150 : 220, height: phone ? 42 : 44)
                .background(PlayarrStyle.surfaceStrong.opacity(0.72))
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                Menu {
                    ForEach(LibraryViewModel.SearchScope.allCases, id: \.self) { scope in
                        Button {
                            viewModel.searchScope = scope
                            Task { await viewModel.load() }
                        } label: {
                            if scope == viewModel.searchScope { Label(searchScopeLabel(scope), systemImage: "checkmark") }
                            else { Text(searchScopeLabel(scope)) }
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PlayarrStyle.inkSoft)
            } else {
                Button { showingFilters = true } label: {
                    Label(phone ? "" : "Filters", systemImage: "slider.horizontal.3")
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.bold))
                        .frame(minWidth: 42, minHeight: 42)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PlayarrStyle.ink)
                .background(PlayarrStyle.surfaceStrong.opacity(0.8), in: Capsule())
                .overlay { Capsule().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
            }
        }
        .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
        .padding(.trailing, phone ? 66 : max(22, proxy.size.width * 0.024))
        .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(66, max(34, proxy.size.height * 0.052)))
    }

    private func playlistSearchCard(_ playlist: Playlist, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [PlayarrStyle.pink.opacity(0.3), PlayarrStyle.surfaceStrong], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: playlist.mediaType == .audio ? "music.note.list" : "play.rectangle")
                    .font(.system(size: min(44, width * 0.2), weight: .light)).foregroundStyle(PlayarrStyle.pink)
            }
            .frame(width: width, height: viewModel.viewMode == .list ? 96 : width * 1.42)
            Text(playlist.name).font(.subheadline.weight(.semibold)).foregroundStyle(PlayarrStyle.ink).lineLimit(1)
            Text("Playlist").font(.caption2.weight(.semibold)).foregroundStyle(PlayarrStyle.muted)
        }
    }

    private func searchScopeLabel(_ scope: LibraryViewModel.SearchScope) -> String {
        switch scope {
        case .all: "Everything"
        case .movie: "Movies"
        case .series: "Series"
        case .site: "Sites"
        case .artist: "Music"
        case .playlist: "Playlists"
        }
    }

    private func libraryListRow(_ work: Work, width: CGFloat) -> some View {
        HStack(spacing: 14) {
            PlayarrArtwork(work: work, kind: .poster, apiClient: apiClient)
                .frame(width: 62, height: 86)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                Text(work.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(work.genres.prefix(2).joined(separator: " · "))
                    .font(.caption2).foregroundStyle(PlayarrStyle.muted).lineLimit(1)
                Text(work.addedAt.formatted(date: .abbreviated, time: .omitted))
                    .font(.caption2).foregroundStyle(PlayarrStyle.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(PlayarrStyle.muted)
        }
        .foregroundStyle(PlayarrStyle.ink)
        .frame(width: width)
        .frame(minHeight: 96)
        .padding(.horizontal, 12)
        .background(PlayarrStyle.surfaceStrong.opacity(0.62))
        .overlay { Rectangle().stroke(PlayarrStyle.line, lineWidth: 1) }
    }

    private var filterSheet: some View {
        NavigationStack {
            Form {
                Section("View") {
                    Picker("View", selection: $viewModel.viewMode) {
                        Label("List", systemImage: "list.bullet").tag(LibraryViewModel.ViewMode.list)
                        Label("Screen", systemImage: "rectangle.grid.2x2").tag(LibraryViewModel.ViewMode.screen)
                        Label("Covers", systemImage: "square.grid.3x3").tag(LibraryViewModel.ViewMode.cover)
                        if viewModel.selectedKind == .artist {
                            Label("Flow", systemImage: "rectangle.on.rectangle.angled").tag(LibraryViewModel.ViewMode.coverFlow)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                Section("Sort") {
                    Picker("Sort by", selection: $viewModel.sort) {
                        Text("Title").tag("title")
                        Text("Date added").tag("date_added")
                    }
                    Picker("Order", selection: $viewModel.order) {
                        Text(viewModel.sort == "title" ? "A–Z" : "Oldest first").tag("asc")
                        Text(viewModel.sort == "title" ? "Z–A" : "Newest first").tag("desc")
                    }
                    .pickerStyle(.segmented)
                }
            }
            .scrollContentBackground(.hidden)
            .background(PlayarrStyle.background)
            .navigationTitle("Library filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showingFilters = false
                        Task { await viewModel.load() }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium])
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.searchText.isEmpty ? "Nothing here yet" : "No results")
                .font(.custom("Avenir Next", fixedSize: 20).weight(.bold))
            if !viewModel.searchText.isEmpty {
                Text("Try another title, artist, genre, or tag.")
                    .font(.custom("Avenir Next", fixedSize: 12))
                    .foregroundStyle(PlayarrStyle.inkSoft)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(PlayarrStyle.ink)
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        LibraryView(kind: .movie, apiClient: apiClient, downloadRepository: DownloadRepository(apiClient: apiClient))
    }
}
