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

    var body: some View {
        ZStack {
            TVStageBackground()
            GeometryReader { geo in
                // Match live SPA: title+field sit left of centre; empty state mid-right.
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 14) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(DesignTokens.Color.backgroundRaised.opacity(0.75)))
                        Text("Search")
                            .font(.system(size: 40, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                    }
                    .padding(.leading, 130)
                    .padding(.top, 100)

                    if let viewModel {
                        @Bindable var model = viewModel
                        HStack(spacing: 12) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(DesignTokens.Color.brandPrimary)
                            TextField("Search your libraries and playlists", text: $model.query)
                                .font(.system(size: 17, weight: .medium))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .onSubmit { Task { await model.search() } }
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 18)
                        .frame(width: min(620, geo.size.width * 0.42), alignment: .leading)
                        .background(
                            Capsule()
                                .fill(DesignTokens.Color.backgroundElevated.opacity(0.9))
                        )
                        .overlay(
                            Capsule().stroke(DesignTokens.Color.brandPrimary.opacity(0.85), lineWidth: 2)
                        )
                        .padding(.leading, 130)
                        .padding(.top, 28)

                        // Filters chip (web has Filters · All libraries)
                        HStack(spacing: 8) {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                                .foregroundStyle(DesignTokens.Color.brandPrimary)
                            Text("Filters")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                            Text("All libraries")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(DesignTokens.Color.backgroundRaised.opacity(0.85)))
                        .padding(.leading, 130)
                        .padding(.top, 16)

                        Text("Find any available movie, series, artist or playlist.")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .frame(maxWidth: 300, alignment: .leading)
                            .padding(.leading, 130)
                            .padding(.top, 20)

                        searchResults(model)
                            .padding(.leading, 130)
                            .padding(.top, 20)
                    }
                    Spacer()
                }

                if let viewModel, viewModel.state == .idle {
                    HStack(spacing: 16) {
                        Circle()
                            .stroke(DesignTokens.Color.brandPrimary.opacity(0.45), lineWidth: 1.5)
                            .frame(width: 96, height: 96)
                            .overlay(
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 30, weight: .medium))
                                    .foregroundStyle(DesignTokens.Color.brandPrimary)
                            )
                        Text("Start typing to search.")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                    }
                    .position(x: geo.size.width * 0.68, y: geo.size.height * 0.52)
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
