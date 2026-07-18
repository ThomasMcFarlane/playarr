import StreamarrKit
import SwiftUI

struct HomeView: View {
    let viewModel: HomeViewModel
    let apiClient: StreamarrAPIClient

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: "Preparing your home…")
            case .failed(let message):
                PlayarrFailureView(title: "Home isn’t available", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                loadedContent
            }
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
        }
    }

    private var loadedContent: some View {
        GeometryReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 30) {
                    if proxy.size.width >= 700, let featured = viewModel.recentlyAdded.first {
                        featuredStage(featured)
                    }

                    if !viewModel.continueWatching.isEmpty {
                        railHeader("Continue watching", count: viewModel.continueWatching.count)
                        horizontalRail {
                            ForEach(viewModel.continueWatching) { item in
                                NavigationLink {
                                    WorkDetailView(
                                        viewModel: WorkDetailViewModel(apiClient: apiClient, workID: item.work.id),
                                        apiClient: apiClient
                                    )
                                } label: {
                                    PlayarrMediaCard(
                                        work: item.work,
                                        apiClient: apiClient,
                                        progress: item.progress,
                                        width: proxy.size.width >= 700 ? 230 : 178
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    mediaRail(
                        title: "Recently added",
                        works: viewModel.recentlyAdded,
                        width: proxy.size.width >= 700 ? 230 : 178
                    )

                    ForEach(WorkKind.allCases, id: \.self) { kind in
                        let works = viewModel.recentlyAdded.filter { $0.kind == kind }
                        if !works.isEmpty {
                            mediaRail(
                                title: kind == .artist ? "Recently added music" : kind.displayName,
                                works: works,
                                width: proxy.size.width >= 700 ? 230 : 178
                            )
                        }
                    }
                }
                .padding(.top, proxy.size.width >= 700 ? 30 : 74)
                .padding(.bottom, 112)
            }
            .refreshable { await viewModel.load() }
            .scrollIndicators(.hidden)
        }
        .background(PlayarrStyle.background)
        .navigationBarHidden(true)
    }

    private func featuredStage(_ work: Work) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                apiClient: apiClient
            )
        } label: {
            ZStack(alignment: .bottomLeading) {
                PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                    .frame(height: 390)
                    .overlay {
                        LinearGradient(
                            colors: [.clear, PlayarrStyle.ink.opacity(0.82)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }

                VStack(alignment: .leading, spacing: 10) {
                    Text(work.kind.displayName.uppercased())
                        .font(.caption2.weight(.black))
                        .tracking(1.2)
                        .foregroundStyle(PlayarrStyle.pink)
                    Text(work.title)
                        .font(.system(size: 48, weight: .medium, design: .rounded))
                        .tracking(-2)
                        .foregroundStyle(.white)
                    if let overview = work.overview {
                        Text(overview)
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.78))
                            .lineLimit(2)
                            .frame(maxWidth: 560, alignment: .leading)
                    }
                }
                .padding(34)
            }
            .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
            .padding(.horizontal, 28)
        }
        .buttonStyle(.plain)
    }

    private func mediaRail(title: String, works: [Work], width: CGFloat) -> some View {
        Group {
            railHeader(title, count: works.count)
            horizontalRail {
                ForEach(works) { work in
                    NavigationLink {
                        WorkDetailView(
                            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                            apiClient: apiClient
                        )
                    } label: {
                        PlayarrMediaCard(work: work, apiClient: apiClient, width: width)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func railHeader(_ title: String, count: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(PlayarrStyle.ink)
            Spacer()
            Text("\(count) titles")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PlayarrStyle.muted)
        }
        .padding(.horizontal, 18)
        .padding(.bottom, -20)
    }

    private func horizontalRail<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12, content: content)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
        }
        .scrollIndicators(.hidden)
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        HomeView(viewModel: HomeViewModel(apiClient: apiClient), apiClient: apiClient)
    }
}
