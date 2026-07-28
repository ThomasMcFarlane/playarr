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

                    // Title panel
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
                        .padding(.leading, DesignTokens.Shell.titlePanelLeft)
                        .padding(.top, geo.size.height * DesignTokens.Shell.titlePanelTopFraction)
                    }

                    // Right rails panel
                    VStack(alignment: .leading, spacing: 40) {
                        rail(title: "Recently added", works: Array(viewModel.works.prefix(12)))
                        if viewModel.works.count > 6 {
                            rail(title: "More from your library", works: Array(viewModel.works.dropFirst(6).prefix(12)))
                        }
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

    var body: some View {
        ZStack {
            TVStageBackground()
            HStack(alignment: .top, spacing: 0) {
                // Left copy column (web search layout)
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 16) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(DesignTokens.Color.backgroundRaised.opacity(0.8)))
                        Text("Search")
                            .font(.system(size: 36, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                    }
                    if let viewModel {
                        @Bindable var model = viewModel
                        HStack(spacing: 12) {
                            Image(systemName: "magnifyingglass")
                                .foregroundStyle(DesignTokens.Color.brandPrimary)
                            TextField("Search your libraries and playlists", text: $model.query)
                                .font(.system(size: 18))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .onSubmit { Task { await model.search() } }
                        }
                        .padding(.horizontal, 22)
                        .padding(.vertical, 16)
                        .background(
                            Capsule()
                                .stroke(DesignTokens.Color.brandPrimary.opacity(0.7), lineWidth: 2)
                                .background(Capsule().fill(DesignTokens.Color.backgroundElevated.opacity(0.85)))
                        )
                        .frame(maxWidth: 560)
                        Text("Find any available movie, series, artist or playlist.")
                            .font(TVTheme.bodyFont())
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .frame(maxWidth: 320, alignment: .leading)
                        searchResults(model)
                    }
                    Spacer()
                }
                .padding(.leading, 140)
                .padding(.top, 110)
                .frame(maxWidth: .infinity, alignment: .leading)

                // Right empty state
                if let viewModel, viewModel.state == .idle {
                    HStack(spacing: 18) {
                        Circle()
                            .stroke(DesignTokens.Color.brandPrimary.opacity(0.5), lineWidth: 1.5)
                            .frame(width: 88, height: 88)
                            .overlay(
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 28))
                                    .foregroundStyle(DesignTokens.Color.brandPrimary)
                            )
                        Text("Start typing to search.")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .task(id: environment.serverURL) {
            viewModel = TVSearchViewModel(apiClient: environment.apiClient)
        }
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
