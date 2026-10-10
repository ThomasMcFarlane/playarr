import PlayarrKit
import SwiftUI

struct TVHomeView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @Environment(\.requestNavFocus) private var requestNavFocus
    @State private var viewModel: TVHomeViewModel?
    /// Focus target is rail+work so the same title never lights up on two rails.
    @FocusState private var focusedCard: HomeRailCardFocus?
    /// Leading work ids per rail — Left on these hands focus to the dock.
    @State private var leadingWorkIDs: Set<UUID> = []

    var body: some View {
        Group {
            if let viewModel {
                homeContent(viewModel)
            } else {
                TVHomeSkeleton()
            }
        }
        .task(id: environment.serverURL) {
            let model = TVHomeViewModel(apiClient: environment.apiClient)
            viewModel = model
            await model.load()
        }
    }

    /// Stable focus key: rail id + work id (works may not repeat across rails).
    private struct HomeRailCardFocus: Hashable {
        let rail: String
        let workID: UUID
    }

    @ViewBuilder
    private func homeContent(_ viewModel: TVHomeViewModel) -> some View {
        switch viewModel.state {
        case .idle, .loading:
            TVHomeSkeleton()
        case .failed(let message):
            TVErrorView(title: "Couldn’t load your library", message: message) {
                Task { await viewModel.load() }
            }
        case .loaded where viewModel.works.isEmpty && viewModel.rails.isEmpty:
            ContentUnavailableView(
                "Your library is empty",
                systemImage: "rectangle.stack",
                description: Text("Add media sources in Playarr Server, then return here.")
            )
            .foregroundStyle(DesignTokens.Color.textPrimary)
        case .loaded:
            if TVParityLaunch.frozen {
                parityHomeLoaded(viewModel)
            } else {
                productionHomeLoaded(viewModel)
            }
        }
    }

    /// The web TV Home (`.tv-home`), interactive: the hero on the left follows the focused card; the server's shelves
    /// stack on the right (`.tv-home-rails`, from x 881.6) and the focused rail scrolls up to the first rail's line.
    /// Geometry is the web's at 1920x1080 in screen points; the stage starts after the nav column, hence `- nav`.
    private func productionHomeLoaded(_ viewModel: TVHomeViewModel) -> some View {
        let rails = Self.productionRails(viewModel)
        let firstFocus = rails.first?.works.first.map { HomeRailCardFocus(rail: "r0", workID: $0.id) }
        let hero = focusedCard.flatMap { focus in rails.lazy.flatMap(\.works).first { $0.id == focus.workID } }
            ?? rails.first?.works.first
        return GeometryReader { geo in
        // Screen coordinates: the stage's own origin (after the nav column) is subtracted once here.
        let origin = geo.frame(in: .global).origin
        ZStack(alignment: .topLeading) {
            liveHeroBackdrop(hero)
                .frame(width: 1920, height: 1080)
                .offset(x: -origin.x, y: -origin.y)
                .allowsHitTesting(false)
            if let hero {
                TVHomeHeroCopy(work: hero, apiClient: environment.apiClient)
                    .offset(x: -origin.x, y: -origin.y)
                    .allowsHitTesting(false)
            }
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: Self.railSpacing) {
                        ForEach(Array(rails.enumerated()), id: \.offset) { index, rail in
                            webRail(id: "r\(index)", title: rail.title, works: rail.works).id("r\(index)")
                        }
                    }
                    .padding(.bottom, 1080)
                }
                .scrollClipDisabled()
                .onChange(of: focusedCard?.rail) { _, rail in
                    guard let rail else { return }
                    withAnimation(.smooth(duration: 0.26)) { proxy.scrollTo(rail, anchor: .top) }
                }
            }
            // The first rail heading sits at y 402; rails above the focused one slide up past it, as on the web.
            .padding(.top, 402 - origin.y)
            .padding(.leading, 881.6 - origin.x - Self.cardBleed)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .defaultFocus($focusedCard, firstFocus)
        .onAppear { if focusedCard == nil { focusedCard = firstFocus } }
    }

    /// Web: an 8 px left bleed keeps the first card's focus glow unclipped.
    private static let cardBleed: CGFloat = 8
    /// Rail pitch 365.9 (heading 402 to 767.9) less one rail's height.
    private static let railSpacing: CGFloat = 365.9 - railHeight
    /// Heading (26.5) and the gap to the art (35.3), plus the card (art and caption) and the track's 18/24 padding.
    private static let railHeight: CGFloat = 61.8 + TVWebHomeCard.height + 24

    /// The server shelves with the web's primary rail first; older servers without shelves get the local rails.
    private static func productionRails(_ viewModel: TVHomeViewModel) -> [(title: String, works: [Work])] {
        if !viewModel.rails.isEmpty { return liveRailDefinitions(viewModel) }
        let (start, movies) = homeRailMembership(works: viewModel.works, interactive: true)
        return [("Start watching", start), ("New movies", movies)].filter { !$0.works.isEmpty }
    }

    private func webRail(id: String, title: String, works: [Work]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(TVTheme.font(size: 17.664, css: 610))
                .tracking(-0.53)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .frame(height: 26.5)
                .padding(.leading, Self.cardBleed)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 24.9) {
                    ForEach(works) { work in
                        let focus = HomeRailCardFocus(rail: id, workID: work.id)
                        NavigationLink {
                            TVWorkDetailView(work: work, apiClient: environment.apiClient)
                        } label: {
                            TVWebHomeCard(work: work, apiClient: environment.apiClient, focused: focusedCard == focus,
                                          progress: id == "r0" ? viewModel?.progress[work.id] : nil)
                        }
                        .buttonStyle(TVFocusableCardButtonStyle())
                        .focusEffectDisabled()
                        .focused($focusedCard, equals: focus)
                    }
                }
                .padding(.leading, Self.cardBleed)
                .padding(.trailing, 46)
                .padding(.top, 18)
                .padding(.bottom, 24)
            }
            .padding(.top, 35.3 - 18)
        }
    }

    private func parityHomeLoaded(_ viewModel: TVHomeViewModel) -> some View {
        GeometryReader { geo in
            let hero = TVParityLaunch.isLive
                ? Self.liveHero(viewModel)
                : heroWork(from: viewModel.works)
            ZStack(alignment: .topLeading) {
                heroBackdrop(hero: hero, size: geo.size)
                TVRailPanelGradient(width: geo.size.width * (1 - DesignTokens.Shell.railLeftInset))
                if let hero {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(kindKicker(hero))
                            .font(TVTheme.font(size: 12, weight: .heavy))
                            .tracking(1.2)
                            .foregroundStyle(DesignTokens.Color.brandPrimary)
                            .textCase(.uppercase)
                        TVHeroTitle(title: hero.title)
                            .padding(.top, 28)
                        if let overview = hero.overview, !overview.isEmpty {
                            Text(overview)
                                .font(TVTheme.font(size: DesignTokens.Shell.featureOverviewSize, weight: .regular))
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                                .lineLimit(5)
                                .lineSpacing(4)
                                .frame(maxWidth: DesignTokens.Shell.featureOverviewMaxWidth, alignment: .leading)
                                .padding(.top, 22)
                        }
                    }
                    .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                    .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                }
                homeRails(viewModel: viewModel, size: geo.size)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private func homeRails(viewModel: TVHomeViewModel, size: CGSize) -> some View {
        let (startWatching, newMovies) = Self.homeRailMembership(
            works: viewModel.works,
            interactive: !TVParityLaunch.frozen
        )
        // Interactive: real HStack layout so the focus engine can move left/right.
        // Absolute `.offset` stacking breaks directional focus (all cards share
        // one layout rect). Parity freezes keep pixel-locked absolute geometry.
        return Group {
            if TVParityLaunch.isLive {
                homeRailsLive(viewModel: viewModel, size: size)
            } else if !TVParityLaunch.frozen {
                homeRailsInteractive(startWatching: startWatching, newMovies: newMovies, size: size)
            } else {
                homeRailsAbsolute(startWatching: startWatching, newMovies: newMovies, size: size)
            }
        }
    }

    /// Match SPA Home.tsx `takeUnused`: a work appears on at most one rail.
    private static func homeRailMembership(
        works: [Work],
        interactive: Bool
    ) -> (startWatching: [Work], newMovies: [Work]) {
        let movies = works.filter { $0.kind == .movie }
        let series = works.filter { $0.kind == .series }
        var used = Set<UUID>()
        func takeUnused(_ source: [Work], count: Int) -> [Work] {
            var out: [Work] = []
            for work in source {
                if used.contains(work.id) { continue }
                used.insert(work.id)
                out.append(work)
                if out.count >= count { break }
            }
            return out
        }

        if !interactive {
            let start = Array((series + works.filter { $0.kind != .series }).prefix(5))
            let preferred = [
                "Sample Movie 1",
                "Sample Movie 2",
                "Sample Movie 3",
                "Sample Movie 4",
                "Sample Movie 5",
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
            return (start, Array(ordered.prefix(5)))
        }

        let mixed = series + works.filter { $0.kind != .series && $0.kind != .artist }
        let start = takeUnused(mixed, count: 10)
        let movieRail = takeUnused(movies, count: 12)
        return (start, movieRail)
    }

    /// Production rails: layout-based rows so Siri Remote / keyboard arrows work.
    private func homeRailsInteractive(
        startWatching: [Work],
        newMovies: [Work],
        size: CGSize
    ) -> some View {
        let artW = DesignTokens.Shell.homeCardWidth
        let artH = DesignTokens.Shell.homeCardHeight
        let gap = DesignTokens.Shell.homeCardGap
        let titleBlock = DesignTokens.Shell.homeCardTitleBlock
        let headingH = DesignTokens.Shell.homeRailHeadingOffsetY
        let x0 = DesignTokens.Shell.homeCardOriginX
        let y1 = DesignTokens.Shell.homeCardOriginY1
        let y2 = DesignTokens.Shell.homeCardOriginY2
        let railGap = max(0, y2 - y1 - artH - titleBlock)
        let defaultFocus: HomeRailCardFocus? = startWatching.first.map {
            HomeRailCardFocus(rail: "start", workID: $0.id)
        } ?? newMovies.first.map { HomeRailCardFocus(rail: "movies", workID: $0.id) }
        // Production HStack shell already owns the nav column; only pad the
        // residual gap past that width toward SPA rail origin.
        let navColumn = DesignTokens.Shell.navItemSize
            + DesignTokens.Shell.navGroupPadding * 2
            + DesignTokens.Shell.navEdge * 2
        let leadingPad = max(24, x0 - navColumn)

        return VStack(alignment: .leading, spacing: railGap) {
            if !startWatching.isEmpty {
                interactiveRail(
                    railID: "start",
                    title: "Start watching",
                    works: startWatching,
                    artW: artW,
                    artH: artH,
                    titleBlock: titleBlock,
                    gap: gap,
                    headingH: headingH
                )
            }
            if !newMovies.isEmpty {
                interactiveRail(
                    railID: "movies",
                    title: "New movies",
                    works: newMovies,
                    artW: artW,
                    artH: artH,
                    titleBlock: titleBlock,
                    gap: gap,
                    headingH: headingH
                )
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, leadingPad)
        .padding(.top, y1 - headingH)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .defaultFocus($focusedCard, defaultFocus)
        .onAppear {
            if focusedCard == nil {
                focusedCard = defaultFocus
            }
        }
    }

    private func interactiveRail(
        railID: String,
        title: String,
        works: [Work],
        artW: CGFloat,
        artH: CGFloat,
        titleBlock: CGFloat,
        gap: CGFloat,
        headingH: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: max(8, headingH - 20)) {
            Text(title)
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
            // Native tvOS card buttons + explicit FocusState. No focusScope:
            // that traps focus inside the rail and blocks Left → dock.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: gap) {
                    ForEach(Array(works.enumerated()), id: \.element.id) { index, work in
                        let focus = HomeRailCardFocus(rail: railID, workID: work.id)
                        NavigationLink {
                            TVWorkDetailView(work: work, apiClient: environment.apiClient)
                        } label: {
                            TVHomeCard(
                                work: work,
                                apiClient: environment.apiClient,
                                isSelected: focusedCard == focus
                            )
                            .frame(
                                width: artW,
                                height: artH + titleBlock,
                                alignment: .topLeading
                            )
                        }
                        .buttonStyle(.card)
                        .focused($focusedCard, equals: focus)
                        .onMoveCommand { direction in
                            // Per-card Left at the rail head → dock.
                            if direction == .left, index == 0 {
                                focusedCard = nil
                                requestNavFocus()
                            }
                        }
                    }
                }
                .padding(.vertical, 12)
                .padding(.trailing, 40)
            }
        }
    }

    /// SPA `.tv-home-rails` absolute positions for parity AE freezes only.
    private func homeRailsAbsolute(
        startWatching: [Work],
        newMovies: [Work],
        size: CGSize
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
                .offset(x: x0, y: y1 - headingH)

            ForEach(Array(startWatching.enumerated()), id: \.element.id) { index, work in
                TVHomeCard(
                    work: work,
                    apiClient: environment.apiClient,
                    isSelected: false
                )
                .frame(width: artW, height: artH + titleBlock, alignment: .topLeading)
                .offset(x: x0 + CGFloat(index) * pitch, y: y1)
            }

            Text("New movies")
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .offset(x: x0, y: y2 - headingH)

            ForEach(Array(newMovies.enumerated()), id: \.element.id) { index, work in
                TVHomeCard(
                    work: work,
                    apiClient: environment.apiClient,
                    isSelected: false
                )
                .frame(width: artW, height: artH + titleBlock, alignment: .topLeading)
                .offset(x: x0 + CGFloat(index) * pitch, y: y2)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// Mirrors web `Home.tsx`: the primary rail is the most recently added unique works (8),
    /// followed by the server's own rails.
    private static func liveRailDefinitions(_ viewModel: TVHomeViewModel) -> [(title: String, works: [Work])] {
        let all = viewModel.rails.flatMap(\.items).enumerated()
            .sorted { lhs, rhs in
                lhs.element.addedAt != rhs.element.addedAt
                    ? lhs.element.addedAt > rhs.element.addedAt
                    : lhs.offset < rhs.offset
            }
            .map(\.element)
        var seen = Set<UUID>()
        var primary: [Work] = []
        for work in all where seen.insert(work.id).inserted {
            primary.append(work)
            if primary.count >= 8 { break }
        }
        // Web Home: "On deck" (part-watched, at most 10) when there is any, else "Start watching" (8 most recent).
        let lead: (title: String, works: [Work]) = viewModel.onDeck.isEmpty
            ? ("Start watching", primary)
            : ("On deck", Array(viewModel.onDeck.prefix(10)))
        let definitions: [(title: String, works: [Work])] = [lead] + viewModel.rails.map { ($0.title, $0.items) }
        return definitions.filter { !$0.works.isEmpty }
    }

    /// Frozen live layout: web `.tv-home-rails` geometry measured on the 1920x1080 reference.
    private func homeRailsLive(viewModel: TVHomeViewModel, size: CGSize) -> some View {
        let definitions = Self.liveRailDefinitions(viewModel)
        let x0: CGFloat = 881.6
        let y0: CGFloat = 487.8
        let railPitch: CGFloat = 317.9
        let cardPitch: CGFloat = 243.9
        let headingOffset = DesignTokens.Shell.homeRailHeadingOffsetY
        return ZStack(alignment: .topLeading) {
            ForEach(Array(definitions.enumerated()), id: \.offset) { railIndex, definition in
                let top = y0 + CGFloat(railIndex) * railPitch
                Text(definition.title)
                    .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                    .tracking(-0.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .offset(x: x0, y: top - headingOffset)
                railCards(definition.works, railIndex: railIndex, top: top, x0: x0, cardPitch: cardPitch)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// One live rail's cards. The first rail is the focused one: in the scrolled capture its track is moved left by the
    /// web's scroll offset, the focused card is `cards` steps in, and the web's left gutter mask
    /// (`--tv-track-left-fade`, transparent at the window's edge to opaque 152 px in) hides what scrolled past the start
    /// line. The right-hand shadow (`.tv-media-track-window::after`) shows while content continues off-screen.
    @ViewBuilder
    private func railCards(_ works: [Work], railIndex: Int, top: CGFloat, x0: CGFloat, cardPitch: CGFloat) -> some View {
        let scroll = railIndex == 0 ? TVParityLaunch.homeScroll : nil
        let shift = scroll?.offset ?? 0
        let focusIndex = railIndex == 0 ? (scroll?.cards ?? 0) : -1
        let cards = ZStack(alignment: .topLeading) {
            ForEach(Array(works.enumerated()), id: \.element.id) { index, work in
                let selected = index == focusIndex
                TVHomeCard(work: work, apiClient: environment.apiClient, isSelected: false, focusedLook: selected)
                    .frame(
                        width: DesignTokens.Shell.homeCardWidth,
                        height: DesignTokens.Shell.homeCardHeight + DesignTokens.Shell.homeCardTitleBlock,
                        alignment: .topLeading
                    )
                    // Web: the focused Home card rises 6 px (the art scale is in TVHomeCard).
                    .offset(x: x0 + CGFloat(index) * cardPitch - shift, y: top - (selected ? 6 : 0))
            }
        }
        if shift > 0 {
            let window = x0 - DesignTokens.Shell.railTrackLeftFade
            cards
                .frame(width: 1920, height: 1080, alignment: .topLeading)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .clear, location: window / 1920),
                            .init(color: .black, location: x0 / 1920),
                            .init(color: .black, location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        } else {
            cards
        }
    }

    /// The hero follows focus: the first card of the first rail, or the focused one in the scrolled capture.
    private static func liveHero(_ viewModel: TVHomeViewModel) -> Work? {
        guard let first = liveRailDefinitions(viewModel).first?.works else { return nil }
        let index = TVParityLaunch.homeScroll?.cards ?? 0
        return first.indices.contains(index) ? first[index] : first.first
    }

    private func heroWork(from works: [Work]) -> Work? {
        if let focus = focusedCard, let match = works.first(where: { $0.id == focus.workID }) {
            return match
        }
        // Prefer series for hero (live SPA highlights a series).
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
        if TVParityLaunch.isLive {
            liveHeroBackdrop(hero)
        } else {
            legacyHeroBackdrop(hero: hero, size: size)
        }
    }

    private func liveHeroBackdrop(_ hero: Work?) -> some View {
        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundElevated
            if let hero {
                TVKeyArt(url: imageURL(for: hero, prefer: .backdrop))
            }
            TVStageWash()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func legacyHeroBackdrop(hero: Work?, size: CGSize) -> some View {
        ZStack(alignment: .leading) {
            DesignTokens.Color.backgroundBase
            // Fixture hero is already SPA-filtered; display with opacity + mask only.
            // Live API art gets greyscale + contrast + colorMultiply(0.6) + opacity.
            let liveURL = hero.flatMap { imageURL(for: $0, prefer: .backdrop) }
            let keyW = size.width * DesignTokens.Shell.keyArtWidthFraction
            if let fixture = TVParityArtwork.heroImage,
               TVParityLaunch.requestedScreen != nil || liveURL == nil {
                // SPA-matched media fixture (998×1080 key-art column) already
                // carries CSS filter+opacity look from the SPA capture. Do not
                // re-apply opacity (double-darkens). Chrome is still SwiftUI.
                fixture
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: keyW, height: size.height)
                    .clipped()
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
                            .modifier(TVKeyArtFilter())
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

    // Legacy rail helper kept for parity-only call sites; production home
    // uses `homeRailsInteractive` / `homeRailsAbsolute`.
    private func rail(title: String, works: [Work]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(TVTheme.font(size: DesignTokens.Shell.railHeadingSize, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.leading, DesignTokens.Shell.railTrackLeftFade)
                .padding(.bottom, 17)
            HStack(spacing: DesignTokens.Shell.homeCardGap) {
                ForEach(works.prefix(5)) { work in
                    TVHomeCard(
                        work: work,
                        apiClient: environment.apiClient,
                        isSelected: false
                    )
                }
            }
            .padding(.top, 18)
            .padding(.bottom, 8)
            .padding(.leading, DesignTokens.Shell.railTrackLeftFade + 8)
            .padding(.trailing, 46)
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
    /// The web's focused card: a heavy drop shadow under the picture (rest cards have a light one).
    var focusedLook = false

    var body: some View {
        // Web `.tv-home-card`: 218.9 x 123.1 art (radius 12.48), title 11.3/630 at +10, meta 8.6/400.
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                cardArtwork
                    .frame(width: DesignTokens.Shell.homeCardWidth, height: DesignTokens.Shell.homeCardHeight)
                    .clipShape(RoundedRectangle(cornerRadius: 12.5, style: .continuous))
                    // Pinned web values: rest 0 10 20 .14 + 0 3 8 .10; focused Home 0 26 52 .32 + 0 11 22 .22.
                    .shadow(
                        color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(focusedLook ? 0.32 : 0.14),
                        radius: focusedLook ? 26 : 10,
                        y: focusedLook ? 26 : 10
                    )
                    .shadow(
                        color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(focusedLook ? 0.22 : 0.10),
                        radius: focusedLook ? 11 : 4,
                        y: focusedLook ? 11 : 3
                    )
                    // The art grows to 1.025 when focused.
                    .scaleEffect(focusedLook ? 1.025 : 1)
                // Fixture art may already include the pink unwatched disc.
                if TVParityArtwork.cardImage(forTitle: work.title) == nil {
                    Circle()
                        .fill(DesignTokens.Color.brandPrimary)
                        .frame(width: 13, height: 13)
                        .overlay(Circle().stroke(Color.white, lineWidth: 1.6))
                        .padding(10.8)
                }
            }
            // Media cards never draw a focus ring: shadow plus lift only (owner ruling).

            // `.tv-home-card > strong` / `small`
            Text(work.title)
                .font(TVTheme.font(size: 11.33, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .frame(width: DesignTokens.Shell.homeCardWidth, height: 17, alignment: .leading)
                .padding(.top, 10)
            Text(
                [work.kind.rawValue.capitalized, work.releaseDate.map { String($0.prefix(4)) }]
                    .compactMap { $0 }.joined(separator: " · ")
            )
                .font(TVTheme.font(size: 8.64, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(width: DesignTokens.Shell.homeCardWidth, height: 13, alignment: .leading)
                .padding(.top, 2.5)
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
        // Web cards ask for ["backdrop", "poster"].
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .thumb })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}

/// Web `.tv-home-card` at 1920x1080: 327.2 x 184 art (radius 12.48), title 11.9/610 at +11.5, meta 8.8/400 at +2.5.
/// Focus: the card rises 6, the art grows to 1.025 with the heavy shadow and the brand glow ring (owner 2026-10-09).
struct TVWebHomeCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var focused = false
    /// Web `.tv-watch-progress`: a 3 px bar along the art's foot on On deck cards (replaces the unseen dot).
    var progress: Double? = nil

    static let artWidth: CGFloat = 327.2
    static let artHeight: CGFloat = 184
    static let height: CGFloat = artHeight + 11.5 + 17.9 + 2.5 + 11.5

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                TVWorkArt(work: work, apiClient: apiClient)
                    .frame(width: Self.artWidth, height: Self.artHeight)
                    .overlay(alignment: .bottomLeading) {
                        if let progress {
                            ZStack(alignment: .leading) {
                                Color.white.opacity(0.2)
                                DesignTokens.Color.brandPrimary.frame(width: max(3, Self.artWidth * min(1, progress)))
                            }
                            .frame(height: 3)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12.48, style: .continuous))
                if progress == nil {
                    Circle()
                        .fill(DesignTokens.Color.brandPrimary)
                        .frame(width: 13, height: 13)
                        .padding(10.6)
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 12.48, style: .continuous)
                    .fill(DesignTokens.Stage.surfaceSoft)
                    .shadow(color: Self.shadow.opacity(focused ? 0.32 : 0.16), radius: focused ? 26 : 11, y: focused ? 26 : 10)
                    .shadow(color: Self.shadow.opacity(focused ? 0.22 : 0.10), radius: focused ? 11 : 4.5, y: focused ? 11 : 3)
            )
            .overlay {
                if focused {
                    RoundedRectangle(cornerRadius: 12.48 + 3, style: .continuous)
                        .stroke(Self.glow, lineWidth: 3)
                        .padding(-3)
                        .shadow(color: Self.glow.opacity(0.45), radius: 12)
                }
            }
            .scaleEffect(focused ? 1.025 : 1)
            Text(work.title)
                .font(TVTheme.font(size: 11.904, css: 610))
                .tracking(-0.18)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .frame(width: Self.artWidth, height: 17.9, alignment: .leading)
                .padding(.top, 11.5)
            Text([work.kind.rawValue.capitalized, work.releaseDate.map { String($0.prefix(4)) }].compactMap { $0 }.joined(separator: " \u{00B7} "))
                .font(TVTheme.font(size: 8.832, css: 400))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(1)
                .frame(width: Self.artWidth, height: 11.5, alignment: .leading)
                .padding(.top, 2.5)
        }
        .offset(y: focused ? -6 : 0)
        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.22), value: focused)
    }

    private static let shadow = Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255)
    private static let glow = DesignTokens.Stage.cardGlow
}

/// Web Home `.details-panel` for the focused card: kicker, title, runtime and overview (detail fetched on focus).
struct TVHomeHeroCopy: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    @State private var runtime: (id: UUID, text: String?)?

    var body: some View {
        let lines = TVTextWrap.lines(work.title, weight: 560, size: 69.12, kern: -4.98, width: 379.5)
        let metaY = 303.5 + 62.2 * CGFloat(max(1, lines.count)) + 22.6
        let meta = runtime?.id == work.id ? runtime?.text : nil
        let overviewY = meta == nil ? metaY : metaY + 18 + 22.9
        ZStack(alignment: .topLeading) {
            Text([work.kind.rawValue, work.genres.first].compactMap { $0 }.joined(separator: " \u{00B7} ").uppercased())
                .font(TVTheme.font(size: 12.29, css: 860))
                .tracking(0.98)
                .foregroundStyle(DesignTokens.Stage.brandInk)
                .placed(x: 153.6, y: 259.2, w: 455, h: 18.4)
            TVHeroTitle(title: work.title)
                .placed(x: 153.6, y: 303.5, w: 379.5, h: 62.2 * CGFloat(max(1, lines.count)), alignment: .topLeading)
            if let meta {
                Text(meta)
                    .font(TVTheme.font(size: 12.864, css: 600))
                    .foregroundStyle(DesignTokens.Color.textPrimary.opacity(0.86))
                    .placed(x: 153.6, y: metaY, h: 18)
            }
            if let overview = work.overview, !overview.isEmpty {
                Text(overview)
                    .font(TVTheme.font(size: 12.864, css: 600))
                    .foregroundStyle(DesignTokens.Color.textPrimary.opacity(0.86))
                    .lineLimit(5)
                    .frame(width: 336, alignment: .topLeading)
                    .placed(x: 153.6, y: overviewY, w: 336, h: 101.6, alignment: .topLeading)
            }
        }
        .frame(width: 1920, height: 1080, alignment: .topLeading)
        .task(id: work.id) {
            let detail = try? await apiClient.fetchWork(id: work.id)
            runtime = (work.id, TVWebFormat.runtime(ms: detail?.runtimeMs))
        }
    }
}

/// Web skeleton loading (owner 2026-10-08): the Home's final geometry with placeholder cards, never a spinner screen.
struct TVHomeSkeleton: View {
    var body: some View {
        GeometryReader { geo in
        let origin = geo.frame(in: .global).origin
        let block = DesignTokens.Stage.surfaceSoft
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 4).fill(block).frame(width: 120, height: 14).placed(x: 153.6, y: 261, w: 120, h: 14)
            RoundedRectangle(cornerRadius: 8).fill(block).frame(width: 330, height: 56).placed(x: 153.6, y: 306, w: 330, h: 56)
            ForEach(0..<2, id: \.self) { rail in
                let top = 402 + 365.9 * CGFloat(rail)
                RoundedRectangle(cornerRadius: 4).fill(block).frame(width: 180, height: 18).placed(x: 881.6, y: top + 4, w: 180, h: 18)
                ForEach(0..<4, id: \.self) { card in
                    let x = 881.6 + 352.1 * CGFloat(card)
                    RoundedRectangle(cornerRadius: 12.48, style: .continuous).fill(block)
                        .placed(x: x, y: top + 61.8, w: TVWebHomeCard.artWidth, h: TVWebHomeCard.artHeight)
                    RoundedRectangle(cornerRadius: 3).fill(block).placed(x: x, y: top + 61.8 + 195.3, w: 180, h: 12)
                }
            }
        }
        .frame(width: 1920, height: 1080, alignment: .topLeading)
        .offset(x: -origin.x, y: -origin.y)
        }
        .accessibilityHidden(true)
    }
}

/// Landscape artwork for a work (backdrop, then poster) with the web's text tile as the fallback.
struct TVWorkArt: View {
    let work: Work
    let apiClient: PlayarrAPIClient

    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    tile
                }
            }
        } else {
            tile
        }
    }

    private var tile: some View {
        DesignTokens.Color.backgroundRaised
            .overlay {
                Text(work.title)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(8)
                    .multilineTextAlignment(.center)
            }
    }

    private var url: URL? {
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
            ?? work.images.first?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}

struct TVSearchView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVSearchViewModel?
    @FocusState private var searchFieldFocused: Bool
    @FocusState private var focusedWorkID: UUID?
    private var frozen: Bool { TVParityLaunch.frozen }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // `.tv-search` uses surface (#1b181b), not pure stage base.
            DesignTokens.Color.backgroundElevated.ignoresSafeArea()
            if let viewModel, let work = selectedWork(viewModel) {
                TVKeyArt(url: searchArtURL(work))
            }
            TVStageWash()
            // `.tv-search-rail-surface`: x 729.6, width 1190.4.
            TVRailPanelGradient(width: 1190.4)
            if let viewModel {
                searchContent(viewModel)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        .task(id: environment.serverURL) {
            let model = TVSearchViewModel(apiClient: environment.apiClient)
            viewModel = model
            if let query = TVParityLaunch.liveQuery {
                model.query = query
                await model.search()
            }
        }
    }

    private func searchArtURL(_ work: Work) -> URL? {
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return environment.apiClient.resolvedURL(forPath: path)
    }

    private func selectedWork(_ model: TVSearchViewModel) -> Work? {
        model.results.first { $0.id == focusedWorkID } ?? model.results.first
    }

    @ViewBuilder
    private func searchContent(_ model: TVSearchViewModel) -> some View {
        @Bindable var bindable = model
        TVPageHeader(
            title: "Search",
            detail: model.state == .loaded ? "\(model.results.count) results" : nil
        )

        searchForm(query: $bindable.query, hasQuery: !model.query.isEmpty) {
            Task { await model.search() }
        }

        searchFiltersChip

        switch model.state {
        case .idle:
            Text("Find any available movie, series, artist or playlist.")
                .font(TVTheme.font(size: 14, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(maxWidth: 340, alignment: .leading)
                .lineSpacing(4)
                .placed(x: 153.6, y: 268.2 + 56 + DesignTokens.Shell.searchPromptTopGap, w: 340)
            idleEmptyState
        case .loading:
            ProgressView("Searching…")
                .tint(DesignTokens.Color.brandPrimary)
                .placed(x: 153.6, y: 360)
        case .failed(let message):
            TVErrorView(title: "Search failed", message: message) {
                Task { await model.search() }
            }
            .frame(width: 600)
            .placed(x: 153.6, y: 360)
        case .loaded where model.results.isEmpty:
            Text("No results for \u{201C}\(model.query)\u{201D}")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .placed(x: 153.6, y: 360)
        case .loaded:
            if let work = selectedWork(model) {
                searchPreview(work)
            }
            searchResultRow(model)
            otherSources
        }
    }

    private func searchForm(
        query: Binding<String>,
        hasQuery: Bool,
        onSubmit: @escaping () -> Void
    ) -> some View {
        // Web `.tv-search-form`: 590 x 76 pill at (153.6, 172.8).
        ZStack(alignment: .topLeading) {
            Capsule()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.88))
                .overlay(
                    Capsule().stroke(
                        frozen ? DesignTokens.Color.brandPrimary.opacity(0.6) : DesignTokens.Color.borderDefault.opacity(0.5),
                        lineWidth: frozen ? 1.5 : 1
                    )
                )
                .shadow(color: DesignTokens.Color.brandPrimary.opacity(frozen ? 0.18 : 0), radius: 8)
                .frame(width: 590, height: 76)
            Image(systemName: "magnifyingglass")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 28, y: 26, w: 24, h: 24)
            if frozen {
                Text(hasQuery ? query.wrappedValue : "Search your libraries and playlists")
                    .font(TVTheme.font(size: 17, weight: .medium))
                    .foregroundStyle(hasQuery ? DesignTokens.Color.textPrimary : DesignTokens.Color.textDisabled)
                    .placed(x: 66, y: 0, w: 480, h: 76)
            } else {
                TextField("Search your libraries and playlists", text: query)
                    .font(TVTheme.font(size: 17, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .focused($searchFieldFocused)
                    .onSubmit(onSubmit)
                    .placed(x: 66, y: 0, w: 480, h: 76)
            }
            if hasQuery {
                Text("Clear")
                    .font(TVTheme.font(size: 10.94, weight: .bold))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: 511.5, y: 11, w: 69.5, h: 54, alignment: .center)
            }
        }
        .frame(width: 590, height: 76, alignment: .topLeading)
        .placed(x: 153.6, y: 172.8, w: 590, h: 76)
    }

    private var searchFiltersChip: some View {
        // Web `.tv-search-filter-toggle`: 172.3 x 56 pill at (153.6, 268.2).
        ZStack(alignment: .topLeading) {
            Capsule()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.78))
                .frame(width: 172.3, height: 56)
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.brandPrimary)
                .placed(x: 24, y: 19, w: 18, h: 18)
            Text("Filters")
                .font(TVTheme.font(size: 11.14, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .placed(x: 44.8, y: 19.7, w: 40, h: 16.7)
            Text("All \u{00B7} All libraries")
                .font(TVTheme.font(size: 9.2, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(1)
                .placed(x: 91.4, y: 21.1, w: 70, h: 13.8)
        }
        .frame(width: 172.3, height: 56, alignment: .topLeading)
        .placed(x: 153.6, y: 268.2, w: 172.3, h: 56)
    }

    private func searchPreview(_ work: Work) -> some View {
        let year = work.releaseDate.map { String($0.prefix(4)) }
        let kind = work.kind.rawValue.capitalized
        return ZStack(alignment: .topLeading) {
            Text([kind, year].compactMap { $0 }.joined(separator: " \u{00B7} ").uppercased())
                .font(TVTheme.font(size: 9.98, weight: .heavy))
                .tracking(0.8)
                .foregroundStyle(DesignTokens.Color.brandPrimary)
                .placed(x: 153.6, y: 362, w: 534.5, h: 15)
            Text(work.title)
                .font(TVTheme.font(size: 48, weight: .medium))
                .tracking(-2.88)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .placed(x: 153.6, y: 385.8, w: 534.5, h: 47)
            HStack(spacing: 12) {
                if let year { Text(year) }
                ForEach(work.genres.prefix(2), id: \.self) { Text($0) }
            }
            .font(TVTheme.font(size: 10.37, weight: .regular))
            .foregroundStyle(DesignTokens.Color.textDisabled)
            .placed(x: 153.6, y: 447.2, h: 15.6)
            if let overview = work.overview, !overview.isEmpty {
                Text(overview)
                    .font(TVTheme.font(size: 12.29, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .lineLimit(2)
                    .placed(x: 153.6, y: 480.4, w: 534.5, h: 19)
            }
        }
    }

    private func searchResultRow(_ model: TVSearchViewModel) -> some View {
        // Normal cards 320.6 x 180.3, pitch 346.65, first at x 825.55; the focused card scales 1.04.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 26.05) {
                ForEach(Array(model.results.enumerated()), id: \.element.id) { index, work in
                    // Web: the first hit is not scaled until the remote moves onto the results.
                    let selected = focusedWorkID != nil && (selectedWork(model)?.id == work.id)
                    NavigationLink {
                        TVWorkDetailView(work: work, apiClient: environment.apiClient)
                    } label: {
                        searchResultCard(work, focused: selected)
                            // Pinned web search focus: translateY(-6px) scale(1.015) over 230 ms, cubic-bezier(0.16, 1, 0.3, 1).
                            .scaleEffect(selected ? 1.015 : 1)
                            .offset(y: selected ? -6 : 0)
                            .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.23), value: selected)
                    }
                    .buttonStyle(TVFocusableCardButtonStyle())
                    .focused($focusedWorkID, equals: work.id)
                    .disabled(frozen) // not .focusable: on a Button it adds a second, inert focus target
                    .focusEffectDisabled(frozen)
                }
            }
            .padding(.leading, 96.45)
            .padding(.top, 20)
            .padding(.trailing, 80)
        }
        .frame(width: 1190.4 - 96.45 + 96.45, height: 300, alignment: .topLeading)
        .placed(x: 729.6, y: 172.8 - 20, w: 1190.4, h: 300, alignment: .topLeading)
    }

    private func searchResultCard(_ work: Work, focused: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                TVWorkArt(work: work, apiClient: environment.apiClient)
                    .frame(width: 320.6, height: 180.3)
                    .clipShape(RoundedRectangle(cornerRadius: 12.5, style: .continuous))
                    // Focused search shadow: 0 22px 52px rgba(31, 14, 20, 0.28); the rest shadow is the card default.
                    .shadow(
                        color: Color(red: 31 / 255, green: 14 / 255, blue: 20 / 255).opacity(focused ? 0.28 : 0),
                        radius: 26, y: 22
                    )
                Circle()
                    .fill(DesignTokens.Color.brandPrimary)
                    .frame(width: 13, height: 13)
                    .overlay(Circle().stroke(Color.white, lineWidth: 1.6))
                    .padding(10.9)
            }
            ZStack(alignment: .topLeading) {
                Text(work.title)
                    .font(TVTheme.font(size: 12.29, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .placed(x: 1.6, y: 0, w: 246.8, h: 18.4)
                Text(
                    ([work.kind.rawValue.capitalized] + [work.releaseDate.map { String($0.prefix(4)) }].compactMap { $0 })
                        .joined(separator: " \u{00B7} ").uppercased()
                )
                    .font(TVTheme.font(size: 8.45, weight: .bold))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: 259.6, y: 5, w: 61, h: 12.7, alignment: .trailing)
            }
            .frame(width: 320.6, height: 20, alignment: .topLeading)
            .padding(.top, 11.2)
        }
        .frame(width: 320.6, alignment: .topLeading)
    }

    private var otherSources: some View {
        ZStack(alignment: .topLeading) {
            Text("OTHER SOURCES")
                .font(TVTheme.font(size: 10.88, weight: .bold))
                .tracking(0.76)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 825.6, y: 418.4, w: 1013.8, h: 16.3)
            Text("Nothing found in other sources.")
                .font(TVTheme.font(size: 11.52, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 825.6, y: 446.7, w: 1013.8, h: 17.3)
        }
    }

    /// Idle empty state in the right rail (`.tv-empty-state.graphic-search`).
    private var idleEmptyState: some View {
        let art = DesignTokens.Shell.searchEmptyArtSize
        let cx = DesignTokens.Shell.searchEmptyCenterX
        let cy = DesignTokens.Shell.searchEmptyCenterY
        return HStack(spacing: DesignTokens.Shell.searchEmptyGap) {
            ZStack {
                Circle()
                    .fill(DesignTokens.Color.backgroundRaised.opacity(0.28))
                Circle()
                    .stroke(DesignTokens.Color.borderDefault.opacity(0.55), lineWidth: 1)
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
        .placed(x: cx - art / 2, y: cy - art / 2)
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
    @Environment(\.requestNavFocus) private var requestNavFocus
    @State private var items: [Work] = []
    @FocusState private var selectedID: UUID?
    @State private var didLoad = false
    /// The server's count for the header ("1,754 titles"); nil when it skipped the count.
    @State private var total: Int?

    private var parityMode: Bool { TVParityLaunch.frozen }

    /// Leftmost grid column ids (SPA 3-col grid) — Left from these → dock.
    private var leadingColumnIDs: Set<UUID> {
        let cols = DesignTokens.Shell.libraryGridColumns
        return Set(
            items.enumerated()
                .filter { $0.offset % cols == 0 }
                .map(\.element.id)
        )
    }

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
                TVRailPanelGradient(width: geo.size.width * DesignTokens.Shell.libraryGridWidthFraction)

                TVPageHeader(
                    title: kindLabel,
                    detail: items.isEmpty ? nil : "\((total ?? items.count).formatted()) \(collectionNoun.lowercased())"
                )
                .zIndex(10)

                if let selected {
                    libraryPreview(selected)
                        .frame(maxWidth: DesignTokens.Shell.titlePanelWidth, alignment: .leading)
                        .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                        .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
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
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.trailing, 1920 - 1876.5 - DesignTokens.Shell.libraryAlphabetWidth / 2)
                    .padding(.top, 277.2 - (25.6 - 9.2) / 2)
                    .zIndex(20)

                filterLauncher
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    // The shell action column (page-layout spec, rule 2.3): right edge 12.48 px, top 151.2 px, 62 wide.
                    .padding(.trailing, TVShellActionColumn.edge)
                    .padding(.top, TVShellActionColumn.top)
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
            Text("\u{2190}")
                .font(TVTheme.font(size: 17.3, weight: .semibold))
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
                    if TVParityLaunch.requestedScreen != nil {
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
            // SPA `.tv-library-preview h2` / `.tv-detail-copy h1`: weight 560,
            // tracking -0.072em, max-width 9ch. DemiBold (semibold) matches
            // white-pixel mass better than Medium (full109 title thr200:
            // native 3479 vs SPA 4996).
            // Wraps like the web heading (max-width 9ch), one 62.2 pt line box per line.
            TVHeroTitle(title: work.title)
                .padding(.top, 16)
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
            // SPA `.tv-title-card-copy { padding-top: 0.72rem; gap }` +
            // `strong { font-size: clamp(0.54rem, 0.6vw, 0.74rem) → ~11.5 @ 1920,
            // font-weight: 610, letter-spacing: -0.015em }`.
            VStack(alignment: .leading, spacing: 11.5) {
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
                            TVWorkArt(work: work, apiClient: environment.apiClient)
                                .frame(width: width, height: artHeight)
                                .clipped()
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous))
                    // Pinned web values: rest 0 10 20 .14 + 0 3 8 .10; focused 0 24 48 .30 + 0 10 20 .20.
                    .shadow(
                        color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255)
                            .opacity(isSelected ? 0.3 : 0.14),
                        radius: isSelected ? 24 : 10,
                        y: isSelected ? 24 : 10
                    )
                    .shadow(
                        color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255)
                            .opacity(isSelected ? 0.2 : 0.1),
                        radius: isSelected ? 10 : 4,
                        y: isSelected ? 10 : 3
                    )
                    // SPA fixture crops already include the pink unwatched disc.
                    if !artIncludesDot || TVParityArtwork.cardImage(forTitle: work.title) == nil {
                        Circle()
                            .fill(DesignTokens.Color.brandPrimary)
                            .frame(width: 13, height: 13)
                            .overlay(Circle().stroke(Color.white, lineWidth: 1.6))
                            .padding(10.8)
                    }
                }
                if showTitle {
                    // Fixture SPA crops do not include the title line; draw it.
                    Text(work.title)
                        .font(TVTheme.font(size: 11.9, weight: .semibold))
                        .tracking(-0.18)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(1)
                        .frame(width: width, alignment: .leading)
                }
            }
            .frame(width: width, alignment: .leading)
            .opacity(isSelected || parityMode ? 1 : 0.92)
            // Pinned web library focus: translateY(-5px) scale(1.015) over 260 ms, cubic-bezier(0.2, 0.8, 0.2, 1); no ring.
            .scaleEffect(isSelected ? 1.015 : 1)
            .offset(y: isSelected ? -5 : 0)
            .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.26), value: isSelected)
        }
        .buttonStyle(TVFocusableCardButtonStyle())
        .focused($selectedID, equals: work.id)
        .disabled(parityMode) // not .focusable: on a Button it adds a second, inert focus target
        .focusEffectDisabled(parityMode)
        .onMoveCommand { direction in
            guard !parityMode, direction == .left else { return }
            guard leadingColumnIDs.contains(work.id) else { return }
            selectedID = nil
            requestNavFocus()
        }
        .onAppear {
            if selectedID == nil { selectedID = work.id }
        }
    }

    /// Web: letters `#`, A to Z, 9.2px, 25.6px pitch from y 277; the current title's letter sits in a light disc.
    private var alphabetRail: some View {
        let letters = ["#"] + (0..<26).map { String(UnicodeScalar(65 + $0)!) }
        let current = selected.map { String($0.title.prefix(1)).uppercased() } ?? "A"
        return VStack(spacing: 0) {
            ForEach(letters, id: \.self) { letter in
                let active = letter == current
                Text(letter)
                    .font(TVTheme.font(size: 9.2, weight: .regular))
                    .foregroundStyle(active ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textDisabled)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(active ? DesignTokens.Color.textSecondary : Color.clear))
                    .frame(width: DesignTokens.Shell.libraryAlphabetWidth, height: 25.6)
            }
        }
    }

    /// Web `.page-filters-button`: the 62 x 72 action tile at the top right of the header row.
    private var filterLauncher: some View {
        TVHeaderPill(label: "Filters", symbol: "line.3.horizontal.decrease", width: 62)
    }

    @ViewBuilder
    private func heroBackdrop(size: CGSize) -> some View {
        if TVParityLaunch.isLive {
            ZStack(alignment: .topLeading) {
                DesignTokens.Color.backgroundElevated
                if let selected {
                    TVKeyArt(url: libraryArtURL(selected))
                }
                TVStageWash()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            legacyHeroBackdrop(size: size)
        }
    }

    private func libraryArtURL(_ work: Work) -> URL? {
        let path = work.images.first(where: { $0.kind == .backdrop })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return environment.apiClient.resolvedURL(forPath: path)
    }

    @ViewBuilder
    private func legacyHeroBackdrop(size: CGSize) -> some View {
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
        if TVParityLaunch.requestedScreen != nil {
            items = TVParityFixtures.libraryWorks(kind: workKind)
            selectedID = items.first?.id
            didLoad = true
            return
        }
        let api = environment.apiClient
        do {
            // First screenful fast, then the rest of the library in the background (the web pages the whole grid).
            let page = try await api.browseCatalog(kind: workKind, genre: nil, tag: nil, sort: "title", limit: 48, offset: 0)
            items = page.items
            total = page.total.map(Int.init)
            selectedID = items.first?.id
            didLoad = true
            while !page.items.isEmpty, items.count < (total ?? Int.max) {
                let next = try await api.browseCatalog(kind: workKind, genre: nil, tag: nil, sort: "title", limit: 500, offset: items.count)
                if next.items.isEmpty { break }
                items += next.items
            }
        } catch {
            didLoad = true // keep what loaded; never show fixture titles to a real user
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
