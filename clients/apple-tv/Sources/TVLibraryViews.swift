import PlayarrKit
import SwiftUI

struct TVHomeView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVHomeViewModel?
    @State private var focusedWorkID: UUID?

    var body: some View {
        Group {
            if let viewModel {
                homeContent(viewModel)
            } else {
                ProgressView("Connecting to Playarr Server…")
                    .tint(DesignTokens.Color.brandPrimary)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: environment.serverURL) {
            let model = TVHomeViewModel(apiClient: environment.apiClient)
            viewModel = model
            await model.load()
            if focusedWorkID == nil {
                focusedWorkID = model.works.first?.id
            }
        }
    }

    @ViewBuilder
    private func homeContent(_ viewModel: TVHomeViewModel) -> some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading your library…")
                .tint(DesignTokens.Color.brandPrimary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            TVErrorView(title: "Couldn’t load your library", message: message) {
                Task { await viewModel.load() }
            }
        case .loaded where viewModel.works.isEmpty:
            ContentUnavailableView(
                "Your library is empty",
                systemImage: "rectangle.stack",
                description: Text("Add media sources in Playarr Server, then return here.")
            )
            .foregroundStyle(DesignTokens.Color.textPrimary)
        case .loaded:
            GeometryReader { geo in
                let hero = heroWork(from: viewModel.works)
                ZStack(alignment: .topLeading) {
                    // Key art (left half), greyscale wash like web
                    heroBackdrop(hero: hero, size: geo.size)

                    // Title panel — clear of floating nav (nav ~100pt wide).
                    if let hero {
                        VStack(alignment: .leading, spacing: 18) {
                            Text(kindKicker(hero))
                                .font(.system(size: 12, weight: .heavy))
                                .tracking(1.2)
                                .foregroundStyle(DesignTokens.Color.brandPrimary)
                                .textCase(.uppercase)
                            Text(hero.title)
                                .font(TVTheme.heroTitleFont())
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .lineLimit(3)
                                .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
                            if let overview = hero.overview, !overview.isEmpty {
                                Text(overview)
                                    .font(.system(size: 16, weight: .regular))
                                    .foregroundStyle(DesignTokens.Color.textSecondary)
                                    .lineLimit(4)
                                    .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
                            }
                        }
                        .padding(.leading, 200)
                        .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                        .zIndex(2)
                    }

                    // Right rails panel — titles mirror live SPA home rails.
                    VStack(alignment: .leading, spacing: 40) {
                        let movies = viewModel.works.filter { $0.kind == .movie }
                        let series = viewModel.works.filter { $0.kind == .series }
                        rail(title: "Start watching", works: Array((series + viewModel.works).prefix(12)))
                        rail(title: "New movies", works: Array((movies.isEmpty ? viewModel.works : movies).prefix(12)))
                    }
                    .padding(.leading, geo.size.width * DesignTokens.Shell.railLeftInset + 24)
                    .padding(.trailing, 48)
                    .padding(.top, geo.size.height * 0.28)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
            .ignoresSafeArea()
        }
    }

    private func heroWork(from works: [Work]) -> Work? {
        if let id = focusedWorkID, let match = works.first(where: { $0.id == id }) {
            return match
        }
        return works.first
    }

    private func kindKicker(_ work: Work) -> String {
        work.kind.rawValue.uppercased()
    }

    @ViewBuilder
    private func heroBackdrop(hero: Work?, size: CGSize) -> some View {
        ZStack(alignment: .leading) {
            DesignTokens.Color.backgroundBase
            if let hero, let url = imageURL(for: hero, prefer: .backdrop) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(width: size.width * 0.55, height: size.height * 1.06)
                            .clipped()
                            .saturation(0)
                            .contrast(0.85)
                            .brightness(-0.15)
                            .opacity(0.72)
                            .mask(
                                LinearGradient(
                                    colors: [.black, .black, .clear],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                    default:
                        EmptyView()
                    }
                }
            }
            // Stage wash
            LinearGradient(
                colors: [
                    DesignTokens.Color.backgroundElevated.opacity(0.94),
                    .clear,
                ],
                startPoint: .leading,
                endPoint: UnitPoint(x: 0.35, y: 0.5)
            )
            LinearGradient(
                colors: [
                    DesignTokens.Color.backgroundBase,
                    .clear,
                    DesignTokens.Color.backgroundBase.opacity(0.9),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .opacity(0.55)
        }
        .frame(width: size.width, height: size.height)
    }

    private func rail(title: String, works: [Work]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: DesignTokens.Shell.homeCardGap) {
                    ForEach(works) { work in
                        NavigationLink {
                            TVWorkDetailView(work: work, apiClient: environment.apiClient)
                        } label: {
                            TVHomeCard(
                                work: work,
                                apiClient: environment.apiClient,
                                isSelected: focusedWorkID == work.id
                            )
                        }
                        .buttonStyle(.card)
                        .onAppear { if focusedWorkID == nil { focusedWorkID = work.id } }
                    }
                }
                .padding(.vertical, 12)
            }
            .scrollClipDisabled()
        }
    }

    private func imageURL(for work: Work, prefer kind: ImageKind) -> URL? {
        let path = work.images.first(where: { $0.kind == kind })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
            ?? work.images.first?.url
        guard let path else { return nil }
        return environment.apiClient.resolvedURL(forPath: path)
    }
}

struct TVHomeCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var isSelected: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AsyncImage(url: thumbURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    DesignTokens.Color.backgroundRaised
                        .overlay {
                            Text(work.title)
                                .font(TVTheme.captionFont())
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .padding(8)
                                .multilineTextAlignment(.leading)
                        }
                }
            }
            .frame(width: DesignTokens.Shell.homeCardWidth, height: DesignTokens.Shell.homeCardHeight)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous)
                    .stroke(
                        isSelected ? DesignTokens.Color.brandPrimary : Color.clear,
                        lineWidth: 3
                    )
            )

            Text(work.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .frame(width: DesignTokens.Shell.homeCardWidth, alignment: .leading)
            Text(work.kind.rawValue.capitalized)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textDisabled)
        }
        .frame(width: DesignTokens.Shell.homeCardWidth, alignment: .leading)
    }

    private var thumbURL: URL? {
        let path = work.images.first(where: { $0.kind == .thumb })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}

struct TVSearchView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVSearchViewModel?
    @FocusState private var searchFieldFocused: Bool
    private var parityMode: Bool { TVParityLaunch.requestedScreen != nil }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // `.tv-search` uses surface (#1b181b), not pure stage base.
            DesignTokens.Color.backgroundElevated.ignoresSafeArea()

            // Positions are authored against the full 1920×1080 stage (web CSS
            // uses viewport units). Ignore safe-area so GeometryReader origin
            // matches the shell header / nav overlays outside NavigationStack.
            GeometryReader { geo in
                let left = DesignTokens.Shell.searchContentLeft
                let copyWidth = min(DesignTokens.Shell.searchCopyWidth, geo.size.width * 0.31)
                let railWidth = geo.size.width * DesignTokens.Shell.searchRailWidthFraction
                let railLeading = geo.size.width - railWidth

                ZStack(alignment: .topLeading) {
                    // Right rail surface (frosted gradient, 62% width).
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        LinearGradient(
                            stops: [
                                .init(color: .clear, location: 0),
                                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.35), location: 0.12),
                                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.55), location: 0.34),
                                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.72), location: 0.62),
                                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.78), location: 1),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: railWidth)
                    }

                    // Header: back + title (`.tv-library-heading`).
                    HStack(spacing: 20) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                            .frame(
                                width: DesignTokens.Shell.searchBackSize,
                                height: DesignTokens.Shell.searchBackSize
                            )
                            .background(
                                Circle()
                                    .fill(DesignTokens.Color.backgroundElevated.opacity(0.7))
                                    .overlay(
                                        Circle().stroke(
                                            DesignTokens.Color.borderDefault.opacity(0.45),
                                            lineWidth: 1
                                        )
                                    )
                            )
                        Text("Search")
                            .font(.system(size: DesignTokens.Shell.searchTitleSize, weight: .semibold))
                            .tracking(-1.2)
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                    }
                    .padding(.leading, left)
                    .padding(.top, DesignTokens.Shell.searchHeadingTop)

                    // Search copy column. Web: `.tv-search-copy` top=130; form has
                    // margin-top 43 → field top ≈ 173 @ 1080p.
                    VStack(alignment: .leading, spacing: 0) {
                        if let viewModel {
                            @Bindable var model = viewModel
                            searchForm(query: $model.query, width: copyWidth) {
                                Task { await model.search() }
                            }
                            .padding(.top, DesignTokens.Shell.searchFormTopGap)

                            searchFiltersChip
                                .padding(.top, DesignTokens.Shell.searchFilterTopGap)

                            Text("Find any available movie, series, artist or playlist.")
                                .font(.system(size: 14, weight: .regular))
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                                .frame(maxWidth: 340, alignment: .leading)
                                .lineSpacing(4)
                                .padding(.top, DesignTokens.Shell.searchPromptTopGap)

                            if model.state != .idle {
                                searchResults(model)
                                    .padding(.top, 24)
                            }
                        }
                    }
                    .frame(width: copyWidth, alignment: .leading)
                    .padding(.leading, left)
                    .padding(.top, DesignTokens.Shell.searchCopyTop)

                    // Idle empty state in the right rail.
                    // Web places it mid-rail (icon centre ≈ y 380–420 @ 1080p).
                    if let viewModel, viewModel.state == .idle {
                        HStack(spacing: 28) {
                            Circle()
                                .stroke(DesignTokens.Color.borderDefault.opacity(0.5), lineWidth: 1)
                                .frame(
                                    width: DesignTokens.Shell.searchEmptyArtSize,
                                    height: DesignTokens.Shell.searchEmptyArtSize
                                )
                                .background(
                                    Circle().fill(DesignTokens.Color.backgroundElevated.opacity(0.54))
                                )
                                .overlay(
                                    Image(systemName: "magnifyingglass")
                                        .font(.system(size: 36, weight: .medium))
                                        .foregroundStyle(DesignTokens.Color.brandPrimary.opacity(0.85))
                                )
                            Text("Start typing to search.")
                                .font(.system(size: 20, weight: .semibold))
                                .tracking(-0.3)
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                        }
                        .frame(width: railWidth, alignment: .center)
                        .padding(.top, geo.size.height * 0.29)
                        .offset(x: railLeading)
                    }
                }
            }
            .ignoresSafeArea()
        }
        .task(id: environment.serverURL) {
            viewModel = TVSearchViewModel(apiClient: environment.apiClient)
        }
    }

    private func searchForm(
        query: Binding<String>,
        width: CGFloat,
        onSubmit: @escaping () -> Void
    ) -> some View {
        // Parity captures replace TextField with a static replica so the tvOS
        // system focus fill (large white capsule) does not dominate AE.
        // Production keeps a real TextField.
        Group {
            if parityMode {
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .frame(width: 24, height: 24)
                    Text("Search your libraries and playlists")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .frame(width: 24, height: 24)
                    TextField("Search your libraries and playlists", text: query)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .focused($searchFieldFocused)
                        .onSubmit(onSubmit)
                }
            }
        }
        .padding(.leading, 22)
        .padding(.trailing, 16)
        .frame(width: width, height: DesignTokens.Shell.searchFormHeight, alignment: .leading)
        .background(
            Capsule()
                .fill(DesignTokens.Color.backgroundElevated.opacity(0.88))
        )
        .overlay(
            Capsule().stroke(
                DesignTokens.Color.brandPrimary.opacity(0.72),
                lineWidth: 1.5
            )
        )
        .shadow(color: Color.black.opacity(0.18), radius: 26, y: 12)
        .focusEffectDisabled(parityMode)
        .allowsHitTesting(!parityMode)
    }

    private var searchFiltersChip: some View {
        HStack(spacing: 10) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.brandPrimary)
            Text("Filters")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("All libraries")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            Capsule().fill(DesignTokens.Color.backgroundElevated.opacity(0.78))
        )
        .shadow(color: Color.black.opacity(0.12), radius: 16, y: 8)
    }

    @ViewBuilder
    private func searchResults(_ viewModel: TVSearchViewModel) -> some View {
        switch viewModel.state {
        case .idle:
            EmptyView()
        case .loading:
            ProgressView("Searching…").tint(DesignTokens.Color.brandPrimary)
        case .failed(let message):
            TVErrorView(title: "Search failed", message: message) {
                Task { await viewModel.search() }
            }
        case .loaded where viewModel.results.isEmpty:
            Text("No results for “\(viewModel.query)”")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .loaded:
            ScrollView {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: TVTheme.workTileWidth), spacing: DesignTokens.Spacing.md)],
                    spacing: DesignTokens.Spacing.lg
                ) {
                    ForEach(viewModel.results) { work in
                        NavigationLink {
                            TVWorkDetailView(work: work, apiClient: environment.apiClient)
                        } label: {
                            TVHomeCard(work: work, apiClient: environment.apiClient)
                        }
                        .buttonStyle(.card)
                    }
                }
                .padding(.top, 24)
            }
            .frame(maxHeight: 520)
        }
    }
}

struct TVLibraryKindView: View {
    let kindLabel: String
    let emptyMessage: String

    var body: some View {
        ZStack {
            TVStageBackground()
            VStack(alignment: .leading, spacing: 16) {
                Text(kindLabel)
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(emptyMessage)
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.leading, 140)
            .padding(.top, 120)
        }
    }
}

struct TVWorkTile: View {
    let work: Work
    let apiClient: PlayarrAPIClient

    var body: some View {
        TVHomeCard(work: work, apiClient: apiClient)
    }
}

struct TVWorkCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient

    var body: some View {
        TVHomeCard(work: work, apiClient: apiClient)
    }
}

struct TVErrorView: View {
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.Color.stateError)
            Text(title)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text(message)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 800)
            TVPrimaryButton(label: "Try again", action: retry)
        }
        .padding(DesignTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
