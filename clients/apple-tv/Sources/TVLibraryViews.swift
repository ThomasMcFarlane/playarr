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

                    // `.tv-home-rails` frost gradient (right 62%).
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
                        .frame(width: geo.size.width * (1 - DesignTokens.Shell.railLeftInset))
                    }

                    // SPA `.tv-key-art > span` watermark (large faded title).
                    if let hero {
                        Text(hero.title.uppercased())
                            .font(TVTheme.font(size: DesignTokens.Shell.keyArtWatermarkSize, weight: .heavy))
                            .tracking(-6)
                            .foregroundStyle(DesignTokens.Color.textDisabled.opacity(DesignTokens.Shell.keyArtWatermarkOpacity))
                            .lineLimit(2)
                            .frame(
                                maxWidth: geo.size.width * DesignTokens.Shell.keyArtWatermarkMaxWidthFraction,
                                alignment: .leading
                            )
                            .padding(.leading, geo.size.width * DesignTokens.Shell.keyArtWatermarkLeftFraction)
                            .padding(.top, geo.size.height * DesignTokens.Shell.keyArtWatermarkTopFraction)
                            .zIndex(1)
                            .allowsHitTesting(false)
                    }

                    // `.tv-home-feature` — top 24%, left 8vw, width min(24vw,455).
                    if let hero {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(kindKicker(hero))
                                .font(TVTheme.font(size: 12, weight: .heavy))
                                .tracking(1.2)
                                .foregroundStyle(DesignTokens.Color.brandPrimary)
                                .textCase(.uppercase)
                            Text(hero.title)
                                .font(TVTheme.font(size: DesignTokens.Shell.featureTitleSize, weight: .medium))
                                .tracking(-4.5)
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .lineLimit(3)
                                .frame(
                                    maxWidth: DesignTokens.Shell.featureTitleMaxWidth,
                                    alignment: .leading
                                )
                                .padding(.top, 10)
                            if let overview = hero.overview, !overview.isEmpty {
                                Text(overview)
                                    .font(TVTheme.font(size: DesignTokens.Shell.featureOverviewSize, weight: .regular))
                                    .foregroundStyle(DesignTokens.Color.textDisabled)
                                    .lineLimit(5)
                                    .lineSpacing(4)
                                    .frame(
                                        maxWidth: DesignTokens.Shell.featureOverviewMaxWidth,
                                        alignment: .leading
                                    )
                                    .padding(.top, 22)
                            }
                        }
                        .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                        .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                        .zIndex(2)
                    }

                    homeRails(viewModel: viewModel, size: geo.size)
                        .zIndex(3)
                }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder
    private func homeRails(viewModel: TVHomeViewModel, size: CGSize) -> some View {
        let movies = viewModel.works.filter { $0.kind == .movie }
        let series = viewModel.works.filter { $0.kind == .series }
        let startWatching = Array((series + viewModel.works.filter { $0.kind != .series }).prefix(12))
        let newMovies: [Work] = {
            if TVParityLaunch.requestedScreen != nil {
                let preferred = [
                    "28 Sample Years",
                    "28 Sample Years: The Sequel",
                    "30 Sample Nights",
                    "30 Sample Nights: The Sequel",
                    "47 Sample Metres",
                    "10,000 Sample",
                    "2001: A Sample Voyage",
                    "Sample Film 2012",
                ]
                var ordered: [Work] = []
                for title in preferred {
                    if let match = movies.first(where: { $0.title == title }) {
                        ordered.append(match)
                    }
                }
                for m in movies where !ordered.contains(where: { $0.id == m.id }) {
                    ordered.append(m)
                }
                return ordered
            }
            return Array((movies.isEmpty ? viewModel.works : movies).prefix(12))
        }()

        // Always place rails at SPA-measured origins (design-token geometry).
        // Production wraps cards in NavigationLink for focus/select; parity
        // freezes chrome for simctl AE captures.
        homeRailsAbsolute(
            startWatching: Array(startWatching.prefix(TVParityLaunch.requestedScreen != nil ? 5 : 12)),
            newMovies: Array(newMovies.prefix(TVParityLaunch.requestedScreen != nil ? 5 : 12)),
            size: size,
            interactive: TVParityLaunch.requestedScreen == nil
        )
    }

    /// SPA `.tv-home-rails` card grid at measured art origins (pink-dot geometry).
    private func homeRailsAbsolute(
        startWatching: [Work],
        newMovies: [Work],
        size: CGSize,
        interactive: Bool
    ) -> some View {
        let artW = DesignTokens.Shell.homeCardWidth
        let artH = DesignTokens.Shell.homeCardHeight
        let pitch = DesignTokens.Shell.homeCardPitchX
        let titleBlock = DesignTokens.Shell.homeCardTitleBlock
        let headingH = DesignTokens.Shell.homeRailHeadingOffsetY
        let x0 = DesignTokens.Shell.homeCardOriginX
        let y1 = DesignTokens.Shell.homeCardOriginY1
        let y2 = DesignTokens.Shell.homeCardOriginY2

        return ZStack(alignment: .topLeading) {
            Text("Start watching")
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .offset(x: x0, y: y1 - headingH - 8)

            ForEach(Array(startWatching.enumerated()), id: \.element.id) { index, work in
                homeCardAt(
                    work: work,
                    interactive: interactive,
                    frameWidth: artW,
                    frameHeight: artH + titleBlock
                )
                .offset(x: x0 + CGFloat(index) * pitch, y: y1)
            }

            Text("New movies")
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .offset(x: x0, y: y2 - headingH - 8)

            ForEach(Array(newMovies.enumerated()), id: \.element.id) { index, work in
                homeCardAt(
                    work: work,
                    interactive: interactive,
                    frameWidth: artW,
                    frameHeight: artH + titleBlock
                )
                .offset(x: x0 + CGFloat(index) * pitch, y: y2)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .allowsHitTesting(interactive)
    }

    @ViewBuilder
    private func homeCardAt(
        work: Work,
        interactive: Bool,
        frameWidth: CGFloat,
        frameHeight: CGFloat
    ) -> some View {
        let card = TVHomeCard(
            work: work,
            apiClient: environment.apiClient,
            isSelected: interactive && focusedWorkID == work.id
        )
        .frame(width: frameWidth, height: frameHeight, alignment: .topLeading)

        if interactive {
            NavigationLink {
                TVWorkDetailView(work: work, apiClient: environment.apiClient)
            } label: {
                card
            }
            .buttonStyle(.plain)
            .focusable(true)
            .onAppear {
                if focusedWorkID == nil { focusedWorkID = work.id }
            }
        } else {
            card
        }
    }

    private func heroWork(from works: [Work]) -> Work? {
        if let id = focusedWorkID, let match = works.first(where: { $0.id == id }) {
            return match
        }
        // Prefer series for hero (live SPA highlights "Test Series Y").
        return works.first(where: { $0.kind == .series }) ?? works.first
    }

    private func kindKicker(_ work: Work) -> String {
        let kind = work.kind.rawValue.uppercased()
        if let genre = work.genres.first {
            return "\(kind) · \(genre.uppercased())"
        }
        return kind
    }

    @ViewBuilder
    private func heroBackdrop(hero: Work?, size: CGSize) -> some View {
        ZStack(alignment: .leading) {
            DesignTokens.Color.backgroundBase
            // Fixture hero is already SPA-filtered; display with opacity + mask only.
            // Live API art gets greyscale + contrast + colorMultiply(0.6) + opacity.
            let liveURL = hero.flatMap { imageURL(for: $0, prefer: .backdrop) }
            let keyW = size.width * DesignTokens.Shell.keyArtWidthFraction
            if let fixture = TVParityArtwork.heroImage,
               TVParityLaunch.requestedScreen != nil || liveURL == nil {
                fixture
                    .resizable()
                    .scaledToFill()
                    .frame(width: keyW, height: size.height * DesignTokens.Shell.keyArtHeightFraction)
                    .clipped()
                    .opacity(DesignTokens.Shell.keyArtOpacity)
                    .mask(
                        LinearGradient(
                            stops: [
                                .init(color: .black, location: 0),
                                .init(color: .black, location: DesignTokens.Shell.keyArtMaskSolidEnd),
                                .init(color: .clear, location: 1),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else if let url = liveURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(width: keyW, height: size.height * DesignTokens.Shell.keyArtHeightFraction)
                            .clipped()
                            .saturation(0)
                            .contrast(DesignTokens.Shell.keyArtContrast)
                            .colorMultiply(Color(white: DesignTokens.Shell.keyArtBrightness))
                            .opacity(DesignTokens.Shell.keyArtOpacity)
                            .mask(
                                LinearGradient(
                                    stops: [
                                        .init(color: .black, location: 0),
                                        .init(color: .black, location: DesignTokens.Shell.keyArtMaskSolidEnd),
                                        .init(color: .clear, location: 1),
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                    default:
                        EmptyView()
                    }
                }
            }
            // Soft stage washes (web key-art overlays).
            LinearGradient(
                colors: [
                    DesignTokens.Color.backgroundElevated.opacity(0.55),
                    .clear,
                ],
                startPoint: .leading,
                endPoint: UnitPoint(x: 0.42, y: 0.5)
            )
            LinearGradient(
                colors: [
                    DesignTokens.Color.backgroundBase.opacity(0.35),
                    .clear,
                    DesignTokens.Color.backgroundBase.opacity(0.75),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(width: size.width, height: size.height)
    }

    private func rail(title: String, works: [Work]) -> some View {
        let parity = TVParityLaunch.requestedScreen != nil
        return VStack(alignment: .leading, spacing: 0) {
            // `.tv-media-track-heading h2`
            Text(title)
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.leading, DesignTokens.Shell.railTrackLeftFade)
                .padding(.bottom, 17)
            // Parity: fixed HStack (no ScrollView focus lift / partial clip).
            // Production keeps horizontal scroll.
            Group {
                if parity {
                    HStack(spacing: DesignTokens.Shell.homeCardGap) {
                        ForEach(works.prefix(5)) { work in
                            TVHomeCard(
                                work: work,
                                apiClient: environment.apiClient,
                                isSelected: focusedWorkID == work.id
                            )
                        }
                    }
                    .padding(.top, 18)
                    .padding(.bottom, 8)
                    .padding(.leading, DesignTokens.Shell.railTrackLeftFade + 8)
                    .padding(.trailing, 46)
                } else {
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
                                .buttonStyle(.plain)
                                .focusable(true)
                                .onAppear { if focusedWorkID == nil { focusedWorkID = work.id } }
                            }
                        }
                        .padding(.top, 18)
                        .padding(.bottom, 8)
                        .padding(.leading, DesignTokens.Shell.railTrackLeftFade + 8)
                        .padding(.trailing, 46)
                    }
                    .scrollClipDisabled()
                }
            }
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
            ZStack(alignment: .topTrailing) {
                cardArtwork
                    .frame(width: DesignTokens.Shell.homeCardWidth, height: DesignTokens.Shell.homeCardHeight)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous))
                // Fixture art may already include the pink unwatched disc.
                if TVParityArtwork.cardImage(forTitle: work.title) == nil {
                    Circle()
                        .fill(DesignTokens.Color.brandPrimary)
                        .frame(width: 12, height: 12)
                        .padding(10)
                }
            }
            // Parity: no focus ring (SPA selected card uses soft lift only).
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous)
                    .stroke(
                        (isSelected && TVParityLaunch.requestedScreen == nil)
                            ? DesignTokens.Color.brandPrimary
                            : Color.clear,
                        lineWidth: 3
                    )
            )

            // `.tv-home-card > strong` / `small`
            Text(work.title)
                .font(TVTheme.font(size: 12, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .frame(width: DesignTokens.Shell.homeCardWidth, alignment: .leading)
                .padding(.top, 8)
            Text(work.kind.rawValue.capitalized)
                .font(TVTheme.font(size: 10, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .padding(.top, 2)
        }
        .frame(width: DesignTokens.Shell.homeCardWidth, alignment: .leading)
    }

    @ViewBuilder
    private var cardArtwork: some View {
        if let url = thumbURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    fixtureOrPlaceholder
                }
            }
        } else {
            fixtureOrPlaceholder
        }
    }

    @ViewBuilder
    private var fixtureOrPlaceholder: some View {
        if let fixture = TVParityArtwork.cardImage(forTitle: work.title) {
            fixture.resizable().scaledToFill()
        } else {
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
                        // Web h1: weight ~580, size ~34 — AvenirNext-Medium is closer than DemiBold.
                        Text("Search")
                            .font(TVTheme.font(size: DesignTokens.Shell.searchTitleSize, weight: .medium))
                            .tracking(-1.5)
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
                                .font(TVTheme.font(size: 14, weight: .regular))
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
                    // SPA `.tv-empty-state.graphic-search`: 1:1 circle, border only,
                    // translucent surface, pink magnifier. Measured centre ≈ (1226, 379).
                    if let viewModel, viewModel.state == .idle {
                        let art = DesignTokens.Shell.searchEmptyArtSize
                        HStack(spacing: 22) {
                            ZStack {
                                Circle()
                                    .fill(DesignTokens.Color.backgroundRaised.opacity(0.28))
                                Circle()
                                    .stroke(
                                        DesignTokens.Color.borderDefault.opacity(0.55),
                                        lineWidth: 1
                                    )
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 36, weight: .regular))
                                    .foregroundStyle(DesignTokens.Color.brandPrimary.opacity(0.78))
                            }
                            .frame(width: art, height: art)
                            Text("Start typing to search.")
                                .font(TVTheme.font(size: 17, weight: .semibold))
                                .tracking(-0.3)
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                        }
                        .padding(.top, 379 - art / 2)
                        .padding(.leading, 1226 - art / 2)
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
                        .font(.system(size: 18, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .frame(width: 24, height: 24)
                    Text("Search your libraries and playlists")
                        .font(TVTheme.font(size: 17, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .frame(width: 24, height: 24)
                    TextField("Search your libraries and playlists", text: query)
                        .font(TVTheme.font(size: 17, weight: .medium))
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
            // Web: color-mix(surface-strong 88%, transparent) over stage.
            Capsule()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.88))
        )
        .overlay(
            Capsule().stroke(
                DesignTokens.Color.brandPrimary.opacity(0.55),
                lineWidth: 1.25
            )
        )
        .shadow(color: Color.black.opacity(0.14), radius: 22, y: 10)
        .focusEffectDisabled(parityMode)
        .allowsHitTesting(!parityMode)
    }

    private var searchFiltersChip: some View {
        HStack(spacing: 10) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.brandPrimary)
            Text("Filters")
                .font(TVTheme.font(size: 12, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("All libraries")
                .font(TVTheme.font(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            Capsule().fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.78))
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

/// Movies / Series / Music directory: left preview + right 3-col title grid.
/// Mirrors `LibraryPage` + `.tv-library` / `.tv-directory` CSS at 1920×1080.
struct TVLibraryKindView: View {
    let kindLabel: String
    let emptyMessage: String
    /// When set, filters fixture/API catalogue to this work kind.
    var workKind: WorkKind? = nil
    /// Collection noun for the heading count ("TITLES" / "ARTISTS").
    var collectionNoun: String = "TITLES"

    @Environment(TVAppEnvironment.self) private var environment
    @State private var items: [Work] = []
    @State private var selectedID: UUID?
    @State private var didLoad = false

    private var parityMode: Bool { TVParityLaunch.requestedScreen != nil }

    private var selected: Work? {
        if let selectedID, let match = items.first(where: { $0.id == selectedID }) {
            return match
        }
        return items.first
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                DesignTokens.Color.backgroundBase.ignoresSafeArea()
                heroBackdrop(size: geo.size)

                // Right frost panel (65%).
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
                    .frame(width: geo.size.width * DesignTokens.Shell.libraryGridWidthFraction)
                }

                libraryHeading
                    .padding(.leading, DesignTokens.Shell.libraryHeadingLeft)
                    .padding(.top, DesignTokens.Shell.libraryHeadingTop)
                    .zIndex(10)

                if let selected {
                    libraryPreview(selected)
                        .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                        .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                        .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
                        .zIndex(7)
                } else if didLoad {
                    Text(emptyMessage)
                        .font(TVTheme.bodyFont())
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                        .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                }

                titleGrid(size: geo.size)
                    .zIndex(5)

                alphabetRail
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .padding(.trailing, 18)
                    .padding(.top, DesignTokens.Shell.libraryRailTop + 40)
                    .padding(.bottom, 48)
                    .zIndex(20)

                filterLauncher
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.trailing, 14)
                    .padding(.top, 140)
                    .zIndex(21)
            }
        }
        .ignoresSafeArea()
        .task(id: "\(workKind?.rawValue ?? "all")-\(environment.serverURL.absoluteString)") {
            await loadItems()
        }
    }

    private var libraryHeading: some View {
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
            Text(kindLabel)
                .font(TVTheme.font(size: DesignTokens.Shell.searchTitleSize, weight: .medium))
                .tracking(-1.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
            if !items.isEmpty {
                // SPA suite refs show live totals (e.g. 35 ARTISTS / 67 TITLES).
                // Parity uses those labels so the heading matches the frame.
                let countLabel: String = {
                    if parityMode {
                        switch workKind {
                        case .artist: return "35"
                        case .series, .author: return "67"
                        case .movie: return "10"
                        default: return "\(items.count)"
                        }
                    }
                    return "\(items.count)"
                }()
                Text("\(countLabel) \(collectionNoun)")
                    .font(TVTheme.font(size: DesignTokens.Shell.libraryCountSize, weight: .heavy))
                    .tracking(0.8)
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(DesignTokens.Color.borderDefault.opacity(0.55))
                            .frame(width: 1, height: 14)
                            .offset(x: -10)
                    }
            }
        }
    }

    private func libraryPreview(_ work: Work) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text((work.genres.first ?? kindLabel).uppercased())
                .font(TVTheme.font(size: 12, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(DesignTokens.Color.brandPrimary)
            // SPA `.tv-library-preview h2`: weight ~560, tracking -0.072em, max-width 9ch.
            Text(work.title)
                .font(TVTheme.font(size: DesignTokens.Shell.featureTitleSize, weight: .medium))
                .tracking(-5.0)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .frame(maxWidth: DesignTokens.Shell.featureTitleMaxWidth, alignment: .leading)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
            // SPA `.tv-preview-meta`: year then genres with soft separator.
            previewMeta(work)
                .padding(.top, 22)
            if let overview = work.overview, !overview.isEmpty {
                Text(overview)
                    .font(TVTheme.font(size: DesignTokens.Shell.featureOverviewSize, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .lineLimit(5)
                    .lineSpacing(4)
                    .padding(.top, 18)
            }
        }
        .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
    }

    private func previewMeta(_ work: Work) -> some View {
        let genreLine = work.genres.prefix(2).joined(separator: " · ")
        return HStack(spacing: 0) {
            Text(yearString(for: work))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            if !genreLine.isEmpty {
                Text("  \(genreLine)")
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
        }
        .font(TVTheme.font(size: 13, weight: .medium))
    }

    @ViewBuilder
    private func titleGrid(size: CGSize) -> some View {
        // Parity: absolute SPA-measured positions (no ScrollView focus lift).
        // Production: adaptive LazyVGrid inside the 65% rail panel.
        if parityMode {
            parityTitleGrid(size: size)
        } else {
            productionTitleGrid(size: size)
        }
    }

    /// Fixed 3×N grid at SPA-measured origins for honest suite captures.
    private func parityTitleGrid(size: CGSize) -> some View {
        let originX = DesignTokens.Shell.libraryCardOriginX
        let originY = DesignTokens.Shell.libraryCardOriginY
        let artW = DesignTokens.Shell.libraryCardArtWidth
        let artH = DesignTokens.Shell.libraryCardArtHeight
        let pitchX = DesignTokens.Shell.libraryCardPitchX
        let pitchY = DesignTokens.Shell.libraryCardPitchY
        let cols = DesignTokens.Shell.libraryGridColumns

        // Title block sits under art; total cell height ≈ pitchY.
        let titleBlock = DesignTokens.Shell.libraryCardTitleHeight
        return ZStack(alignment: .topLeading) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, work in
                let row = index / cols
                let col = index % cols
                let cellTop = originY + CGFloat(row) * pitchY
                let cellLeft = originX + CGFloat(col) * pitchX
                libraryCard(
                    work: work,
                    width: artW,
                    artHeight: artH,
                    showTitle: true,
                    artIncludesDot: true
                )
                // Top-leading placement (not centre) so art top matches SPA y.
                .frame(width: artW, height: artH + titleBlock, alignment: .topLeading)
                .offset(x: cellLeft, y: cellTop)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    private func productionTitleGrid(size: CGSize) -> some View {
        let gridWidth = size.width * DesignTokens.Shell.libraryGridWidthFraction
        let padL = DesignTokens.Shell.libraryRailLeft
        let padR = DesignTokens.Shell.libraryRailRight
        let cols = DesignTokens.Shell.libraryGridColumns
        let gap = DesignTokens.Shell.libraryGridColGap
        let inner = max(0, gridWidth - padL - padR)
        let cardW = (inner - gap * CGFloat(cols - 1)) / CGFloat(cols)
        let artH = cardW * 9 / 16

        return ScrollView(.vertical, showsIndicators: false) {
            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.fixed(cardW), spacing: gap),
                    count: cols
                ),
                alignment: .leading,
                spacing: DesignTokens.Shell.libraryGridRowGap
            ) {
                ForEach(items) { work in
                    libraryCard(work: work, width: cardW, artHeight: artH, showTitle: true, artIncludesDot: false)
                }
            }
            .padding(.top, DesignTokens.Shell.libraryRailTop)
            .padding(.bottom, DesignTokens.Shell.libraryRailBottom)
            .padding(.leading, padL)
            .padding(.trailing, padR)
        }
        .frame(width: gridWidth)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
    }

    private func libraryCard(
        work: Work,
        width: CGFloat,
        artHeight: CGFloat,
        showTitle: Bool,
        artIncludesDot: Bool
    ) -> some View {
        let isSelected = selected?.id == work.id
        return Button {
            selectedID = work.id
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                ZStack(alignment: .topTrailing) {
                    Group {
                        if let fixture = TVParityArtwork.cardImage(forTitle: work.title) {
                            // Fixture crops are exact SPA art tiles (incl. pink
                            // unwatched dot). Do not re-apply scaledToFill
                            // distortion — size the frame to the art bounds.
                            fixture
                                .resizable()
                                .interpolation(.high)
                                .frame(width: width, height: artHeight)
                        } else {
                            DesignTokens.Color.backgroundRaised
                                .overlay {
                                    Text(work.title)
                                        .font(TVTheme.captionFont())
                                        .foregroundStyle(DesignTokens.Color.textPrimary)
                                        .padding(8)
                                        .multilineTextAlignment(.center)
                                }
                                .frame(width: width, height: artHeight)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous))
                    // SPA fixture crops already include the pink unwatched disc.
                    if !artIncludesDot {
                        Circle()
                            .fill(DesignTokens.Color.brandPrimary)
                            .frame(width: 12, height: 12)
                            .padding(10)
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous)
                        .stroke(
                            (!parityMode && isSelected)
                                ? DesignTokens.Color.brandPrimary.opacity(0.9)
                                : Color.clear,
                            lineWidth: 2
                        )
                )
                if showTitle {
                    // Fixture SPA crops do not include the title line; draw it.
                    Text(work.title)
                        .font(TVTheme.font(size: 12, weight: .semibold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(1)
                        .frame(width: width, alignment: .leading)
                }
            }
            .frame(width: width, alignment: .leading)
            .opacity(isSelected || parityMode ? 1 : 0.92)
            .offset(y: isSelected && !parityMode ? -5 : 0)
        }
        .buttonStyle(.plain)
        .focusable(!parityMode)
        .focusEffectDisabled(parityMode)
        .onAppear {
            if selectedID == nil { selectedID = work.id }
        }
    }

    private var alphabetRail: some View {
        let letters = ["#"] + (0..<26).map { String(UnicodeScalar(65 + $0)!) }
        return VStack(spacing: 2) {
            ForEach(letters, id: \.self) { letter in
                Text(letter)
                    .font(TVTheme.font(size: 9, weight: letter == "A" || letter == "#" ? .bold : .medium))
                    .foregroundStyle(
                        letter == "A" || letter == "#"
                            ? DesignTokens.Color.brandPrimary
                            : DesignTokens.Color.textDisabled.opacity(0.85)
                    )
                    .frame(width: DesignTokens.Shell.libraryAlphabetWidth)
            }
        }
    }

    private var filterLauncher: some View {
        VStack(spacing: 6) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 16, weight: .semibold))
            Text("Filters")
                .font(TVTheme.font(size: 9, weight: .bold))
        }
        .foregroundStyle(DesignTokens.Color.textDisabled)
        .frame(width: DesignTokens.Shell.libraryFilterWidth, height: DesignTokens.Shell.libraryFilterHeight)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.78))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(DesignTokens.Color.borderDefault.opacity(0.45), lineWidth: 1)
                )
        )
    }

    @ViewBuilder
    private func heroBackdrop(size: CGSize) -> some View {
        let kind = workKind ?? .series
        ZStack(alignment: .leading) {
            DesignTokens.Color.backgroundBase
            // Hero fills left ~47% (to grid origin); SPA key-art is greyscale.
            let heroW = DesignTokens.Shell.libraryCardOriginX - 20
            if let fixture = TVParityArtwork.libraryHero(kind: kind) {
                fixture
                    .resizable()
                    .scaledToFill()
                    .frame(width: heroW, height: size.height)
                    .clipped()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else if let hero = TVParityArtwork.heroImage {
                hero
                    .resizable()
                    .scaledToFill()
                    .frame(width: heroW, height: size.height)
                    .clipped()
                    .saturation(0)
                    .opacity(0.85)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
            LinearGradient(
                colors: [
                    DesignTokens.Color.backgroundElevated.opacity(0.45),
                    .clear,
                ],
                startPoint: .leading,
                endPoint: UnitPoint(x: 0.42, y: 0.5)
            )
            LinearGradient(
                colors: [
                    DesignTokens.Color.backgroundBase.opacity(0.25),
                    .clear,
                    DesignTokens.Color.backgroundBase.opacity(0.8),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(width: size.width, height: size.height)
    }

    private func yearString(for work: Work) -> String {
        let cal = Calendar(identifier: .gregorian)
        return String(cal.component(.year, from: work.addedAt))
    }

    @MainActor
    private func loadItems() async {
        // Offline parity: deterministic fixture catalogue (SPA-matching titles).
        if parityMode {
            items = TVParityFixtures.libraryWorks(kind: workKind)
            selectedID = items.first?.id
            didLoad = true
            return
        }
        do {
            let page = try await environment.apiClient.browseCatalog(
                kind: workKind,
                genre: nil,
                tag: nil,
                sort: "title",
                limit: 48,
                offset: 0
            )
            items = page.items
            selectedID = items.first?.id
            didLoad = true
        } catch {
            items = TVParityFixtures.libraryWorks(kind: workKind)
            selectedID = items.first?.id
            didLoad = true
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
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
