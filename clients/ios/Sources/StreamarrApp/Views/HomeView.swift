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
            let phone = proxy.size.width <= 760
            ZStack(alignment: .topLeading) {
                stageBackdrop(phone: phone)

                if !phone, let featured = viewModel.recentlyAdded.first {
                    featuredCopy(featured)
                        .frame(width: proxy.size.width * 0.36, alignment: .leading)
                        .padding(.leading, max(112, proxy.size.width * 0.085))
                        .padding(.top, proxy.size.height * 0.24)
                }

                rails(phone: phone, width: proxy.size.width, height: proxy.size.height)
                    .frame(
                        width: phone ? proxy.size.width : proxy.size.width * 0.62,
                        height: proxy.size.height
                    )
                    .offset(x: phone ? 0 : proxy.size.width * 0.38)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .background(PlayarrStyle.surface)
        .ignoresSafeArea()
        .navigationBarHidden(true)
    }

    @ViewBuilder
    private func stageBackdrop(phone: Bool) -> some View {
        if let featured = viewModel.recentlyAdded.first {
            PlayarrArtwork(work: featured, kind: .backdrop, apiClient: apiClient)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .opacity(phone ? 0.42 : 0.72)
                .overlay {
                    LinearGradient(
                        colors: phone
                            ? [.clear, PlayarrStyle.surface.opacity(0.38), PlayarrStyle.surface]
                            : [PlayarrStyle.surface.opacity(0.12), PlayarrStyle.surface.opacity(0.36)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .overlay {
                    LinearGradient(
                        colors: [PlayarrStyle.surface.opacity(phone ? 0.28 : 0.5), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
        } else {
            PlayarrStyle.surface
        }
    }

    private func featuredCopy(_ work: Work) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                apiClient: apiClient
            )
        } label: {
            VStack(alignment: .leading, spacing: 13) {
                Text(work.kind.displayName.uppercased())
                    .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                    .tracking(1.3)
                    .foregroundStyle(PlayarrStyle.pink)

                Text(work.title)
                    .font(.custom("Avenir Next", fixedSize: 52).weight(.medium))
                    .tracking(-3.7)
                    .lineSpacing(-5)
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(3)

                if let overview = work.overview {
                    Text(overview)
                        .font(.custom("Avenir Next", fixedSize: 13))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .lineSpacing(5)
                        .lineLimit(4)
                        .frame(maxWidth: 420, alignment: .leading)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func rails(phone: Bool, width: CGFloat, height: CGFloat) -> some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: phone ? 24 : 48) {
                if !viewModel.continueWatching.isEmpty {
                    railSection(
                        title: "Continue watching",
                        count: viewModel.continueWatching.count,
                        phone: phone
                    ) {
                        ForEach(viewModel.continueWatching) { item in
                            workLink(item.work) {
                                PlayarrMediaCard(
                                    work: item.work,
                                    apiClient: apiClient,
                                    progress: item.progress,
                                    width: cardWidth(phone: phone, viewport: width)
                                )
                            }
                        }
                    }
                }

                mediaRail(title: "Recently added", works: viewModel.recentlyAdded, phone: phone, width: width)

                ForEach(WorkKind.allCases, id: \.self) { kind in
                    let works = viewModel.recentlyAdded.filter { $0.kind == kind }
                    if !works.isEmpty {
                        mediaRail(
                            title: kind == .artist ? "Recently added music" : kind.displayName,
                            works: works,
                            phone: phone,
                            width: width
                        )
                    }
                }
            }
            .padding(.top, phone ? 74 : height * 0.5)
            .padding(.bottom, phone ? 112 : height * 0.5)
        }
        .refreshable { await viewModel.load() }
        .scrollIndicators(.hidden)
        .background {
            if phone {
                LinearGradient(
                    colors: [.clear, PlayarrStyle.surface.opacity(0.94), PlayarrStyle.surface],
                    startPoint: .top,
                    endPoint: .bottom
                )
            } else {
                LinearGradient(
                    colors: [.clear, PlayarrStyle.surface.opacity(0.9), PlayarrStyle.surface],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        }
    }

    private func mediaRail(title: String, works: [Work], phone: Bool, width: CGFloat) -> some View {
        railSection(title: title, count: works.count, phone: phone) {
            ForEach(works) { work in
                workLink(work) {
                    PlayarrMediaCard(
                        work: work,
                        apiClient: apiClient,
                        width: cardWidth(phone: phone, viewport: width)
                    )
                }
            }
        }
    }

    private func railSection<Content: View>(
        title: String,
        count: Int,
        phone: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: phone ? 8 : 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.custom("Avenir Next", fixedSize: phone ? 16 : 14).weight(.semibold))
                    .tracking(-0.4)
                    .foregroundStyle(PlayarrStyle.ink)
                Text("\(count) titles")
                    .font(.custom("Avenir Next", fixedSize: phone ? 10.5 : 8.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
            }
            .padding(.horizontal, phone ? 16 : 24)

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: phone ? 12 : 18, content: content)
                    .padding(.leading, phone ? 16 : 24)
                    .padding(.trailing, phone ? 16 : 36)
                    .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func cardWidth(phone: Bool, viewport: CGFloat) -> CGFloat {
        phone ? min(210, viewport * 0.46) : min(225, max(150, viewport * 0.114))
    }

    private func workLink<Content: View>(_ work: Work, @ViewBuilder content: () -> Content) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                apiClient: apiClient
            )
        } label: {
            content()
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        HomeView(viewModel: HomeViewModel(apiClient: apiClient), apiClient: apiClient)
    }
}
