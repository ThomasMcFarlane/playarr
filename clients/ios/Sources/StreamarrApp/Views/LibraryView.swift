import StreamarrKit
import SwiftUI

struct LibraryView: View {
    @State private var viewModel: LibraryViewModel
    let apiClient: StreamarrAPIClient
    let title: String

    init(kind: WorkKind?, apiClient: StreamarrAPIClient, title: String? = nil) {
        let viewModel = LibraryViewModel(apiClient: apiClient)
        viewModel.selectedKind = kind
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.title = title ?? kind?.displayName ?? "Search"
    }

    init(viewModel: LibraryViewModel, apiClient: StreamarrAPIClient) {
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
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
    }

    private func stage<Content: View>(@ViewBuilder content: @escaping () -> Content) -> some View {
        GeometryReader { proxy in
            let phone = proxy.size.width <= 760
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
            let phone = proxy.size.width <= 760
            let panelWidth = phone ? proxy.size.width : proxy.size.width * 0.65
            let columnCount = phone ? 2 : 3
            let gutter: CGFloat = phone ? 16 : max(28, proxy.size.width * 0.028)
            let trailing: CGFloat = phone ? 16 : max(80, proxy.size.width * 0.065)
            let gap: CGFloat = phone ? 12 : min(28, proxy.size.width * 0.0135)
            let cardWidth = (panelWidth - gutter - trailing - gap * CGFloat(columnCount - 1)) / CGFloat(columnCount)

            ScrollView(.vertical) {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.fixed(cardWidth), spacing: gap, alignment: .top), count: columnCount),
                    alignment: .leading,
                    spacing: phone ? 24 : min(36, proxy.size.height * 0.025)
                ) {
                    ForEach(viewModel.works) { work in
                        NavigationLink {
                            WorkDetailView(
                                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                apiClient: apiClient
                            )
                        } label: {
                            PlayarrMediaCard(work: work, apiClient: apiClient, width: cardWidth)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, gutter)
                .padding(.trailing, trailing)
                .padding(.top, phone ? 92 : max(128, proxy.size.height * 0.15))
                .padding(.bottom, phone ? 118 : max(48, proxy.size.height * 0.06))
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
            }
        }
        .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
        .padding(.trailing, phone ? 66 : max(22, proxy.size.width * 0.024))
        .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(66, max(34, proxy.size.height * 0.052)))
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
    NavigationStack { LibraryView(kind: .movie, apiClient: apiClient) }
}
