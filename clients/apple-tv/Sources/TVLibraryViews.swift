import PlayarrKit
import SwiftUI

struct TVHomeView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVHomeViewModel?

    var body: some View {
        ZStack {
            TVStageBackground()
            Group {
                if let viewModel {
                    homeContent(viewModel)
                } else {
                    ProgressView("Connecting to Playarr Server…")
                        .tint(DesignTokens.Color.brandPrimary)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                }
            }
        }
        .navigationTitle("Playarr")
        .task(id: environment.serverURL) {
            let model = TVHomeViewModel(apiClient: environment.apiClient)
            viewModel = model
            await model.load()
        }
    }

    @ViewBuilder
    private func homeContent(_ viewModel: TVHomeViewModel) -> some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading your library…")
                .tint(DesignTokens.Color.brandPrimary)
                .foregroundStyle(DesignTokens.Color.textPrimary)
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
            // Netflix-style shelf layout matching ui-tv `BrowseScreen`.
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xl) {
                    Text("Recently added")
                        .font(TVTheme.titleFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)

                    ScrollView(.horizontal) {
                        LazyHStack(spacing: DesignTokens.Spacing.md) {
                            ForEach(viewModel.works) { work in
                                NavigationLink {
                                    TVWorkDetailView(work: work, apiClient: environment.apiClient)
                                } label: {
                                    TVWorkTile(work: work, apiClient: environment.apiClient)
                                }
                                .buttonStyle(.card)
                            }
                        }
                        .padding(.vertical, DesignTokens.Spacing.md)
                    }
                    .scrollClipDisabled()
                }
                .padding(DesignTokens.Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

struct TVSearchView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: TVSearchViewModel?

    var body: some View {
        ZStack {
            TVStageBackground()
            VStack(spacing: DesignTokens.Spacing.lg) {
                if let viewModel {
                    @Bindable var model = viewModel
                    TextField("Search movies, series, music, or books", text: $model.query)
                        .font(TVTheme.bodyFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(DesignTokens.Spacing.md)
                        .background(
                            RoundedRectangle(cornerRadius: DesignTokens.Radius.input, style: .continuous)
                                .fill(DesignTokens.Color.backgroundRaised)
                        )
                        .onSubmit { Task { await model.search() } }

                    searchResults(model)
                }
            }
            .padding(DesignTokens.Spacing.xl)
        }
        .navigationTitle("Search")
        .task(id: environment.serverURL) {
            viewModel = TVSearchViewModel(apiClient: environment.apiClient)
        }
    }

    @ViewBuilder
    private func searchResults(_ viewModel: TVSearchViewModel) -> some View {
        switch viewModel.state {
        case .idle:
            ContentUnavailableView("Search your library", systemImage: "magnifyingglass")
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .loading:
            ProgressView("Searching…")
                .tint(DesignTokens.Color.brandPrimary)
        case .failed(let message):
            TVErrorView(title: "Search failed", message: message) {
                Task { await viewModel.search() }
            }
        case .loaded where viewModel.results.isEmpty:
            ContentUnavailableView.search(text: viewModel.query)
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
                            TVWorkTile(work: work, apiClient: environment.apiClient)
                        }
                        .buttonStyle(.card)
                    }
                }
                .padding(DesignTokens.Spacing.md)
            }
            .scrollClipDisabled()
        }
    }
}

/// Landscape work tile matching ui-tv `WorkTile` (240×135, raised bg, focus scale).
struct TVWorkTile: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: thumbURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    DesignTokens.Color.backgroundRaised
                        .overlay {
                            Text(work.title)
                                .font(TVTheme.bodyFont())
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .padding(DesignTokens.Spacing.sm)
                                .multilineTextAlignment(.leading)
                        }
                }
            }
            .frame(width: TVTheme.workTileWidth, height: TVTheme.workTileHeight)
            .clipped()
        }
        .frame(width: TVTheme.workTileWidth, height: TVTheme.workTileHeight)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.md, style: .continuous)
                .stroke(
                    isFocused ? DesignTokens.Color.focusRing : Color.clear,
                    lineWidth: 3
                )
        )
        .scaleEffect(isFocused ? DesignTokens.FocusMotion.focusScale : DesignTokens.FocusMotion.restScale)
        .animation(
            .timingCurve(0.4, 0, 0.2, 1, duration: DesignTokens.FocusMotion.transitionSeconds),
            value: isFocused
        )
        .accessibilityLabel(work.title)
    }

    private var thumbURL: URL? {
        let path = work.images.first(where: { $0.kind == .thumb })?.url
            ?? work.images.first(where: { $0.kind == .poster })?.url
        guard let path else { return nil }
        return apiClient.resolvedURL(forPath: path)
    }
}

/// Portrait poster card used when a taller shelf is preferred.
struct TVWorkCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            AsyncImage(url: posterURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ZStack {
                        DesignTokens.Color.backgroundRaised
                        Image(systemName: "play.tv")
                            .font(.system(size: 54))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                    }
                }
            }
            .frame(width: TVTheme.posterCardWidth, height: TVTheme.posterCardHeight)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous))

            Text(work.title)
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
            Text(work.kind.rawValue.capitalized)
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        }
        .frame(width: TVTheme.posterCardWidth, alignment: .leading)
    }

    private var posterURL: URL? {
        guard let path = work.images.first(where: { $0.kind == .poster })?.url else { return nil }
        return apiClient.resolvedURL(forPath: path)
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
    }
}
