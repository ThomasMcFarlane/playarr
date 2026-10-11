import PlayarrKit
import SwiftUI

struct TVHomeView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @Environment(TVDisplayPreferences.self) private var displayPreferences
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
                    VStack(alignment: .leading, spacing: 365.9 - railHeight(displayPreferences.cardWidth)) {
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
        // The lead rail can change after the first paint (On deck arrives): keep focus on a card that still exists.
        .task(id: firstFocus) {
            // The lazy rail creates its cards after this first layout pass: wait a frame or two before focusing.
            try? await Task.sleep(for: .milliseconds(200))
            let ids = Set(rails.flatMap(\.works).map(\.id))
            if focusedCard.map({ !ids.contains($0.workID) }) ?? true { focusedCard = firstFocus }
        }
    }

    /// Web: an 8 px left bleed keeps the first card's focus glow unclipped.
    private static let cardBleed: CGFloat = 8
    /// Heading (26.5) and the gap to the art (35.3), plus the card (art and caption) and the track's 18/24 padding.
    private func railHeight(_ width: CGFloat) -> CGFloat { 61.8 + TVWebHomeCard.height(width: width) + 24 }

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
                        TVCardButton(work: work) {
                            TVWebHomeCard(work: work, apiClient: environment.apiClient, focused: focusedCard == focus,
                                          progress: id == "r0" ? viewModel?.progress[work.id] : nil,
                                          artWidth: displayPreferences.cardWidth)
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
    /// The artwork size setting's card width (medium 327.2); 16:9 art.
    var artWidth: CGFloat = 327.2

    private var artHeight: CGFloat { artWidth * 9 / 16 }
    static func height(width: CGFloat) -> CGFloat { width * 9 / 16 + 11.5 + 17.9 + 2.5 + 11.5 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                TVWorkArt(work: work, apiClient: apiClient)
                    .frame(width: artWidth, height: artHeight)
                    .overlay(alignment: .bottomLeading) {
                        if let progress {
                            ZStack(alignment: .leading) {
                                Color.white.opacity(0.2)
                                DesignTokens.Color.brandPrimary.frame(width: max(3, artWidth * min(1, progress)))
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
            .modifier(TVCardFocusGlow(focused: focused, cornerRadius: 12.48))
            .scaleEffect(focused ? 1.025 : 1)
            Text(work.title)
                .font(TVTheme.font(size: 11.904, css: 610))
                .tracking(-0.18)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .frame(width: artWidth, height: 17.9, alignment: .leading)
                .padding(.top, 11.5)
            Text([work.kind.rawValue.capitalized, work.releaseDate.map { String($0.prefix(4)) }].compactMap { $0 }.joined(separator: " \u{00B7} "))
                .font(TVTheme.font(size: 8.832, css: 400))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .lineLimit(1)
                .frame(width: artWidth, height: 11.5, alignment: .leading)
                .padding(.top, 2.5)
        }
        .offset(y: focused ? -6 : 0)
        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.22), value: focused)
    }

    private static let shadow = Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255)
}

/// The one card focus ring (owner 2026-10-09, web `--card-glow`): a 3 px brand ring outside the art plus a soft
/// glow, following the art's shape. Every media card uses it with its own lift and shadow.
struct TVCardFocusGlow: ViewModifier {
    let focused: Bool
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content.overlay {
            if focused {
                RoundedRectangle(cornerRadius: cornerRadius + 3, style: .continuous)
                    .stroke(DesignTokens.Stage.cardGlow, lineWidth: 3)
                    .padding(-3)
                    .shadow(color: DesignTokens.Stage.cardGlow.opacity(0.45), radius: 12)
            }
        }
    }
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
                        .placed(x: x, y: top + 61.8, w: 327.2, h: 184)
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
    /// Cover (2:3) cards ask for the poster first (web `libraryImageKinds("cover")`).
    var posterFirst = false

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
        let order: [ImageKind] = posterFirst ? [.poster, .backdrop] : [.backdrop, .poster]
        let path = order.lazy.compactMap { kind in work.images.first(where: { $0.kind == kind })?.url }.first
            ?? work.images.first?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}

struct TVSearchView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @Environment(TVDisplayPreferences.self) private var displayPreferences
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

        // Web: Filters is the shell action column tile, as on the libraries.
        TVHeaderPill(label: "Filters", symbol: "line.3.horizontal.decrease", width: 62)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .padding(.trailing, TVShellActionColumn.edge)
            .padding(.top, TVShellActionColumn.top)

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

    /// Web search `.details-panel` (TV): kicker 286.6, title 49.92/560 at 330.9 (420 wide, wraps), meta 13.056/600 at
    /// title bottom + 27, overview 13.824/600 (336 wide, 4 lines) at meta bottom + 21.6.
    private func searchPreview(_ work: Work) -> some View {
        let year = TVWebFormat.year(work.releaseDate)
        let kind = work.kind.rawValue.capitalized
        let lines = TVTextWrap.lines(work.title, weight: 560, size: 49.92, kern: -3, width: 420).count
        let metaY = 330.9 + 47.4 * CGFloat(max(1, lines)) + 27
        let soft = DesignTokens.Color.textPrimary.opacity(0.86)
        return ZStack(alignment: .topLeading) {
            Text([kind, year].compactMap { $0 }.joined(separator: " \u{00B7} ").uppercased())
                .font(TVTheme.font(size: 12.288, css: 860))
                .tracking(0.98)
                .foregroundStyle(DesignTokens.Stage.brandInk)
                .placed(x: 153.6, y: 286.6, w: 544, h: 18.4)
            Text(work.title)
                .font(TVTheme.font(size: 49.92, css: 560))
                .tracking(-3)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(2)
                .frame(width: 420, alignment: .topLeading)
                .placed(x: 153.6, y: 330.9, w: 420, h: 47.4 * CGFloat(max(1, lines)), alignment: .topLeading)
            HStack(spacing: 12.8) {
                if let year { Text(year) }
                if !work.genres.isEmpty { Text(work.genres.prefix(2).joined(separator: " \u{00B7} ")) }
            }
            .font(TVTheme.font(size: 13.056, css: 600))
            .foregroundStyle(soft)
            .placed(x: 153.6, y: metaY, h: 19.6)
            if let overview = work.overview, !overview.isEmpty {
                Text(overview)
                    .font(TVTheme.font(size: 13.824, css: 600))
                    .foregroundStyle(soft)
                    .lineLimit(4)
                    .frame(width: 336, alignment: .topLeading)
                    .placed(x: 153.6, y: metaY + 19.6 + 21.6, w: 336, h: 87.4, alignment: .topLeading)
            }
        }
    }

    /// Web `.tv-search-results`: a 3-column grid from x 825.6, y 172.8 (327.2 x 184 art, pitch 353.1 x 251.2) in the
    /// right rail, scrolling under a top edge fade; other sources follow the results.
    private func searchResultRow(_ model: TVSearchViewModel) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(displayPreferences.cardWidth), spacing: 25.9),
                                     count: displayPreferences.cardColumns),
                      alignment: .leading, spacing: 251.2 - 184 - 11.5 - 20) {
                ForEach(model.results) { work in
                    // Web: the first hit is not lifted until the remote moves onto the results.
                    let selected = focusedWorkID != nil && (selectedWork(model)?.id == work.id)
                    TVCardButton(work: work) {
                        searchResultCard(work, focused: selected)
                            // Pinned web search focus: translateY(-6px) scale(1.015) over 230 ms, cubic-bezier(0.16, 1, 0.3, 1).
                            .scaleEffect(selected ? 1.015 : 1)
                            .offset(y: selected ? -6 : 0)
                            .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.23), value: selected)
                    }
                    .buttonStyle(TVFocusableCardButtonStyle())
                    .focused($focusedWorkID, equals: work.id)
                    .disabled(frozen) // not .focusable: on a Button it adds a second, inert focus target
                    .focusEffectDisabled()
                }
            }
            .padding(.leading, 825.6 - 729.6)
            .padding(.top, 172.8)
            otherSources
                .padding(.leading, 825.6 - 729.6)
                .padding(.top, 36)
                .padding(.bottom, 120)
        }
        .mask(
            LinearGradient(
                stops: [.init(color: .clear, location: 0), .init(color: .clear, location: 40 / 1080),
                        .init(color: .black, location: 92 / 1080), .init(color: .black, location: 1)],
                startPoint: .top, endPoint: .bottom
            )
        )
        .placed(x: 729.6, y: 0, w: 1190.4, h: 1080, alignment: .topLeading)
    }

    private func searchResultCard(_ work: Work, focused: Bool = false) -> some View {
        let w = displayPreferences.cardWidth
        return VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                TVWorkArt(work: work, apiClient: environment.apiClient)
                    .frame(width: w, height: w * 9 / 16)
                    .clipShape(RoundedRectangle(cornerRadius: 12.5, style: .continuous))
                    .modifier(TVCardFocusGlow(focused: focused, cornerRadius: 12.5))
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
                    .font(TVTheme.font(size: 11.904, css: 610))
                    .tracking(-0.18)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .placed(x: 1.9, y: 0, w: w - 66.4, h: 18.4)
                Text(
                    ([work.kind.rawValue.capitalized] + [work.releaseDate.map { String($0.prefix(4)) }].compactMap { $0 })
                        .joined(separator: " \u{00B7} ").uppercased()
                )
                    .font(TVTheme.font(size: 8.448, css: 720))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: w - 120, y: 3, w: 120, h: 12.7, alignment: .trailing)
            }
            .frame(width: w, height: 20, alignment: .topLeading)
            .padding(.top, 11.5)
        }
        .frame(width: w, alignment: .topLeading)
    }

    private var otherSources: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("OTHER SOURCES")
                .font(TVTheme.font(size: 10.88, weight: .bold))
                .tracking(0.76)
                .foregroundStyle(DesignTokens.Color.textDisabled)
            Text("Nothing found in other sources.")
                .font(TVTheme.font(size: 11.52, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
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
    @Environment(TVDisplayPreferences.self) private var displayPreferences
    let kindLabel: String
    let emptyMessage: String
    /// When set, filters fixture/API catalogue to this work kind.
    var workKind: WorkKind? = nil
    /// Collection noun for the heading count ("TITLES" / "ARTISTS").
    var collectionNoun: String = "TITLES"
    /// The Playlists tab: lists the profile's playlists (web `/playlists`), not the catalogue.
    var listsPlaylists = false
    /// One playlist's titles (opened from the Playlists tab).
    var playlistID: UUID? = nil

    @Environment(TVAppEnvironment.self) private var environment
    @Environment(\.requestNavFocus) private var requestNavFocus
    @State private var items: [Work] = []
    /// Title counts of the listed playlists (the preview's "5 titles").
    @State private var playlistCounts: [UUID: Int] = [:]
    /// Web library Filters drawer: sort (`title` / `date_added`) and order (`asc` / `desc`).
    @State private var filtersOpen = false
    @State private var sort = "title"
    @State private var order = "asc"
    /// Web library view (`?view=`): list rows, screen (16:9) cards or cover (2:3) cards.
    @State private var view = "screen"
    /// Web audio/subtitle language filters (any of the chosen codes) and the facets the drawer offers.
    @State private var audioLangs: [String] = []
    @State private var subtitleLangs: [String] = []
    @State private var facets: LanguageFacets?
    /// The title focus returns to when it re-enters the grid, and whether the next focus is such an entry.
    @State private var lastFocusedID: UUID?
    @State private var entryPending = true
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
                    .disabled(filtersOpen) // the open drawer is modal, as on the web
                    .zIndex(5)

                alphabetRail
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(.trailing, 1920 - 1876.5 - DesignTokens.Shell.libraryAlphabetWidth / 2)
                    .padding(.top, 277.2 - (25.6 - 9.2) / 2)
                    .zIndex(20)

                if playlistID == nil, !listsPlaylists {
                    filterLauncher
                        .disabled(filtersOpen)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        // The shell action column (page-layout spec, rule 2.3): right edge 12.48 px, top 151.2 px, 62 wide.
                        .padding(.trailing, TVShellActionColumn.edge)
                        .padding(.top, TVShellActionColumn.top)
                        .zIndex(21)
                }

                if filtersOpen {
                    TVDrawer(kicker: "Library controls", title: "Filters", onClose: { filtersOpen = false }) {
                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(alignment: .leading, spacing: 0) {
                                TVChoiceSection(title: "View", options: [("list", "List"), ("screen", "Screen"), ("cover", "Cover")], selection: $view)
                                TVChoiceSection(title: "Sort by", options: [("title", "Title"), ("date_added", "Date added")], selection: $sort)
                                TVChoiceSection(title: "Order", options: [("asc", sort == "title" ? "A-Z" : "Oldest"),
                                                                          ("desc", sort == "title" ? "Z-A" : "Newest")], selection: $order)
                                TVMultiSelectSection(title: "Audio language", facets: facets?.audio, loaded: facets != nil, selection: $audioLangs)
                                TVMultiSelectSection(title: "Subtitle language", facets: facets?.subtitle, loaded: facets != nil, selection: $subtitleLangs)
                            }
                            .padding(.bottom, 80)
                        }
                        .scrollClipDisabled()
                        .task(id: "\(audioLangs)-\(subtitleLangs)") {
                            do {
                                facets = try await environment.apiClient.catalogLanguages(kind: workKind, audioLang: audioLangs, subtitleLang: subtitleLangs)
                            } catch {
                                NSLog("PlayarrTV: language facets failed: %@", String(describing: error))
                                facets = LanguageFacets(audio: [], subtitle: [])
                            }
                        }
                    }
                    .zIndex(30)
                }
            }
        }
        .ignoresSafeArea()
        .task(id: "\(workKind?.rawValue ?? "all")-\(sort)-\(order)-\(audioLangs)-\(subtitleLangs)-\(environment.serverURL.absoluteString)") {
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
                .font(TVTheme.font(size: 12.29, css: 820))
                .tracking(0.98)
                .foregroundStyle(DesignTokens.Stage.brandInk)
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

    /// Web `.tv-title-grid` at 1920x1080: columns of `--card-w` (327.2 at medium) from x 783.4, 25.92 apart, first row at
    /// y 162, rows 240.4 apart at medium (27 between a card's caption and the next art).
    private func productionTitleGrid(size: CGSize) -> some View {
        let gridWidth = size.width - 783.4
        let padL: CGFloat = 0
        let padR: CGFloat = 0
        // Web: screen cards use `--card-w` (3 + step columns, 25.92 apart); cover cards `--card-w-cover`
        // (5 + step columns, 19.2 apart, 2:3); list rows are one column.
        let cover = view == "cover"
        let cols = view == "list" ? 1 : cover ? displayPreferences.cardColumns + 2 : displayPreferences.cardColumns
        let gap: CGFloat = cover ? 19.2 : 25.92
        let cardW = view == "list" ? 1033.44 : cover ? (1033.44 - 19.2 * CGFloat(cols - 1)) / CGFloat(cols) : displayPreferences.cardWidth
        let artH = cover ? cardW * 1.5 : cardW * 9 / 16
        return ScrollView(.vertical, showsIndicators: false) {
            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.fixed(cardW), spacing: gap),
                    count: cols
                ),
                alignment: .leading,
                spacing: 27
            ) {
                ForEach(items) { work in
                    if view == "list" {
                        libraryRow(work)
                    } else {
                        libraryCard(work: work, width: cardW, artHeight: artH, showTitle: true, artIncludesDot: false)
                    }
                }
            }
            .padding(.top, DesignTokens.Shell.libraryRailTop)
            .padding(.bottom, DesignTokens.Shell.libraryRailBottom)
            .padding(.leading, padL)
            .padding(.trailing, padR)
        }
        .frame(width: gridWidth)
        // Web: the first title is focused when the page opens and whenever focus enters the grid from outside
        // (the nav, the header); `.userInitiated` applies it on every entry, not only the first.
        .focusSection()
        .defaultFocus($selectedID, items.first?.id, priority: .userInitiated)
        // Entering the grid from outside (nav, header) lands on the last focused title, else the first (web), never on
        // the card that happens to sit level with the nav item.
        .onChange(of: selectedID) { previous, current in
            guard let current else { return }
            if previous == nil, entryPending, let target = lastFocusedID ?? items.first?.id {
                entryPending = false
                if target != current { selectedID = target; return }
            }
            lastFocusedID = current
        }
        .onChange(of: selectedID == nil) { _, left in if left { entryPending = true } }
        // Web scroll edge fade: content leaving the top fades out before the header line (owner rule).
        .mask(
            LinearGradient(
                stops: [.init(color: .clear, location: 0), .init(color: .clear, location: 40 / 1080),
                        .init(color: .black, location: 92 / 1080), .init(color: .black, location: 1)],
                startPoint: .top, endPoint: .bottom
            )
        )
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
        return TVCardButton(work: work, route: playlistCounts[work.id] != nil ? .playlist(id: work.id, name: work.title) : nil) {
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
                            TVWorkArt(work: work, apiClient: environment.apiClient, posterFirst: view == "cover")
                                .frame(width: width, height: artHeight)
                                .clipped()
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous))
                    .modifier(TVCardFocusGlow(focused: isSelected && !parityMode, cornerRadius: DesignTokens.Radius.card))
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

    }

    /// Web list view row (`.tv-list-card`): a 172.8 x 97.2 thumbnail, the title 14.98/610 and "Genres · Year" 9.6 beside
    /// it; rows 121.9 apart. Same focus look and actions as the cards.
    private func libraryRow(_ work: Work) -> some View {
        let isSelected = selected?.id == work.id
        return TVCardButton(work: work, route: playlistCounts[work.id] != nil ? .playlist(id: work.id, name: work.title) : nil) {
            HStack(alignment: .center, spacing: 30) {
                TVWorkArt(work: work, apiClient: environment.apiClient)
                    .frame(width: 172.8, height: 97.2)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .modifier(TVCardFocusGlow(focused: isSelected && !parityMode, cornerRadius: 9))
                VStack(alignment: .leading, spacing: 12) {
                    Text(work.title)
                        .font(TVTheme.font(size: 14.976, css: 610))
                        .tracking(-0.22)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(1)
                    Text([work.genres.prefix(2).joined(separator: " \u{00B7} "), TVWebFormat.year(work.releaseDate) ?? ""]
                        .filter { !$0.isEmpty }.joined(separator: "  "))
                        .font(TVTheme.font(size: 9.6, css: 400))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .frame(width: 1033.44, height: 97.2 + 24.7 - 27, alignment: .leading)
            .scaleEffect(isSelected ? 1.015 : 1, anchor: .leading)
            .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.26), value: isSelected)
        }
        .buttonStyle(TVFocusableCardButtonStyle())
        .focused($selectedID, equals: work.id)
        .disabled(parityMode)
        .focusEffectDisabled()
    }

    /// Web `.page-filters-button`: the shared TVHeaderPill tile in the shell action column; opens the Filters drawer.
    private var filterLauncher: some View {
        Button { filtersOpen = true } label: {
            TVHeaderPill(label: "Filters", symbol: "line.3.horizontal.decrease", width: TVShellActionColumn.width)
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 14))
        .focusEffectDisabled()
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

    @ViewBuilder
    private func heroBackdrop(size: CGSize) -> some View {
        if TVParityLaunch.requestedScreen == nil {
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

    /// The release year (owner ruling 2026-10-08: never the date the title was added); a playlist shows its count.
    private func yearString(for work: Work) -> String {
        if let count = playlistCounts[work.id] { return count == 1 ? "1 title" : "\(count) titles" }
        return TVWebFormat.year(work.releaseDate) ?? ""
    }

    /// Web `orderWorks`: titles compare like a person reads them (numbers by value, case and accents ignored: "2"
    /// before "10"), on the sort title; date added by date.
    static func ordered(_ works: [Work], sort: String, order: String) -> [Work] {
        let ascending = order != "desc"
        if sort == "date_added" {
            return works.sorted { ascending ? $0.addedAt < $1.addedAt : $0.addedAt > $1.addedAt }
        }
        return works.sorted {
            let a = $0.sortTitle.isEmpty ? $0.title : $0.sortTitle
            let b = $1.sortTitle.isEmpty ? $1.title : $1.sortTitle
            let result = a.compare(b, options: [.numeric, .caseInsensitive, .diacriticInsensitive], locale: .current)
            return ascending ? result == .orderedAscending : result == .orderedDescending
        }
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
        if listsPlaylists || playlistID != nil {
            await loadPlaylists(api)
            return
        }
        do {
            // First screenful fast, then the rest of the library in the background (the web pages the whole grid).
            let page = try await api.browseCatalog(kind: workKind, sort: sort, order: order, audioLang: audioLangs, subtitleLang: subtitleLangs, limit: 48, offset: 0)
            items = page.items
            total = page.total.map(Int.init)
            didLoad = true
            items = Self.ordered(items, sort: sort, order: order)
            while workKind != nil, !page.items.isEmpty, items.count < (total ?? Int.max) {
                let next = try await api.browseCatalog(kind: workKind, sort: sort, order: order, audioLang: audioLangs, subtitleLang: subtitleLangs, limit: 500, offset: items.count)
                if next.items.isEmpty { break }
                items = Self.ordered(items + next.items, sort: sort, order: order)
            }
        } catch {
            didLoad = true // keep what loaded; never show fixture titles to a real user
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

extension TVLibraryKindView {
    /// The Playlists tab (each playlist as a card with its first title's art) or one playlist's titles.
    @MainActor
    fileprivate func loadPlaylists(_ api: PlayarrAPIClient) async {
        defer { didLoad = true }
        if let playlistID {
            let rows = (try? await api.listPlaylistItems(playlistID: playlistID)) ?? []
            items = await Self.works(rows.sorted { $0.position < $1.position }.map(\.workID), api: api)
        } else {
            let lists = (try? await api.listPlaylists()) ?? []
            var cards: [Work] = []
            var counts: [UUID: Int] = [:]
            for list in lists {
                let rows = (try? await api.listPlaylistItems(playlistID: list.id)) ?? []
                let first = await Self.works(rows.min { $0.position < $1.position }.map { [$0.workID] } ?? [], api: api).first
                counts[list.id] = rows.count
                cards.append(Work(
                    id: list.id, kind: list.mediaType == .audio ? .artist : .movie, title: list.name, sortTitle: list.name,
                    images: first?.images ?? [], genres: ["\(list.mediaType.rawValue.capitalized) \u{00B7} Your playlist"],
                    addedAt: list.createdAt, monitored: false, availability: .available
                ))
            }
            playlistCounts = counts
            items = cards
        }
        total = items.count
    }

    private static func works(_ ids: [UUID], api: PlayarrAPIClient) async -> [Work] {
        await withTaskGroup(of: (Int, Work?).self) { group in
            for (index, id) in ids.enumerated() {
                group.addTask { (index, try? await api.fetchWork(id: id).work) }
            }
            var found: [(Int, Work)] = []
            for await (index, work) in group { if let work { found.append((index, work)) } }
            return found.sorted { $0.0 < $1.0 }.map(\.1)
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


/// Web `MediaContextMenu` "Title actions" in the shared drawer: Play, Add to Playlist, Mark as Watched / Unwatched.
/// Download is left out: Apple TV keeps no offline copies (web hides it without download storage).
struct TVActionsDrawer: View {
    let work: Work
    let onClose: () -> Void
    let onPlay: (UUID, String) -> Void

    @Environment(TVAppEnvironment.self) private var environment
    @State private var playlists: [Playlist]?
    @State private var message: String?
    @State private var busy = false

    var body: some View {
        TVDrawer(kicker: playlists == nil ? "Title actions" : "Add to Playlist", title: work.title, onClose: onClose) {
            VStack(alignment: .leading, spacing: 14) {
                if let playlists {
                    ForEach(playlists) { list in
                        TVActionRow(glyph: "\u{FF0B}", label: list.name) { Task { await add(to: list) } }
                    }
                    if playlists.isEmpty {
                        Text("No playlists yet.").font(TVTheme.font(size: 12.48, css: 400)).foregroundStyle(DesignTokens.Color.textDisabled)
                    }
                    TVActionRow(glyph: "\u{2190}", label: "Back") { self.playlists = nil }
                } else {
                    TVActionRow(glyph: "\u{25B6}\u{FE0E}", label: "Play") { Task { await play() } }
                    TVActionRow(glyph: "\u{FF0B}", label: "Add to Playlist") {
                        Task { playlists = (try? await environment.apiClient.listPlaylists()) ?? [] }
                    }
                    TVActionRow(glyph: "\u{2713}", label: "Mark as Watched") { Task { await setWatched(true) } }
                    TVActionRow(glyph: "\u{25CB}", label: "Mark as Unwatched") { Task { await setWatched(false) } }
                }
                if let message {
                    Text(message)
                        .font(TVTheme.font(size: 12.48, css: 400))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(width: 268, alignment: .leading)
                }
            }
            .disabled(busy)
        }
    }

    /// The playable leaves: the film itself, or every episode (in order) of a series.
    private func leaves() async throws -> [(id: UUID, runtimeMs: Int64?, title: String)] {
        let detail = try await environment.apiClient.fetchWork(id: work.id)
        switch detail.children {
        case .series(let seasons):
            return seasons.sorted { $0.season.seasonNumber < $1.season.seasonNumber }
                .flatMap { $0.episodes.sorted { $0.episode.episodeNumber < $1.episode.episodeNumber } }
                .compactMap { ep in ep.mediaFileID.map { ($0, ep.runtimeMs, ep.episode.title ?? work.title) } }
        default:
            return detail.mediaFileID.map { [($0, detail.runtimeMs, work.title)] } ?? []
        }
    }

    private func play() async {
        busy = true
        defer { busy = false }
        do {
            guard let first = try await leaves().first else { message = "Nothing to play yet."; return }
            onPlay(first.id, first.title)
        } catch { message = "Playback could not be started." }
    }

    private func setWatched(_ watched: Bool) async {
        busy = true
        defer { busy = false }
        do {
            let items = try await leaves()
            guard !items.isEmpty else { message = "Nothing to mark yet."; return }
            for item in items {
                let duration = item.runtimeMs ?? 0
                _ = try await environment.apiClient.updateWatchProgress(
                    mediaFileID: item.id,
                    body: UpdateWatchProgressRequest(positionMS: watched ? duration : 0, durationMS: duration, completed: watched)
                )
            }
            onClose()
        } catch { message = "The change could not be made." }
    }

    private func add(to list: Playlist) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await environment.apiClient.addPlaylistItem(playlistID: list.id, body: AddPlaylistItemRequest(workID: work.id))
            onClose()
        } catch { message = "\(work.title) could not be added to \(list.name)." }
    }
}
