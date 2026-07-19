import StreamarrKit
import SwiftUI

enum HomeLayout {
    static func backdropHeight(viewportHeight: CGFloat, phone: Bool) -> CGFloat {
        phone ? viewportHeight * 0.55 : viewportHeight
    }

    static func carouselHeight(cardWidth: CGFloat, phone: Bool) -> CGFloat {
        cardWidth * 9 / 16 + (phone ? 52 : 46)
    }
}

struct HomeView: View {
    let viewModel: HomeViewModel
    let apiClient: StreamarrAPIClient
    @State private var railSessionID = UUID()

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
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack(alignment: .topLeading) {
                stageBackdrop(phone: phone, height: proxy.size.height)

                if !phone, let featured = viewModel.featuredWork {
                    featuredCopy(featured)
                        .frame(width: proxy.size.width * 0.36, alignment: .leading)
                        .padding(.leading, max(112, proxy.size.width * 0.085))
                        .padding(.top, proxy.size.height * 0.24)
                }

                rails(
                    phone: phone,
                    width: proxy.size.width,
                    height: proxy.size.height,
                    safeTop: proxy.safeAreaInsets.top
                )
                    .frame(
                        width: phone ? proxy.size.width : proxy.size.width * 0.62,
                        height: proxy.size.height,
                        alignment: .topLeading
                    )
                    .offset(x: phone ? 16 : proxy.size.width * 0.38)
                    .zIndex(2)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .background(PlayarrStyle.surface)
        .ignoresSafeArea(edges: .vertical)
        .navigationBarHidden(true)
    }

    @ViewBuilder
    private func stageBackdrop(phone: Bool, height: CGFloat) -> some View {
        ZStack(alignment: .top) {
            PlayarrStyle.surface
            if let featured = viewModel.featuredWork {
                PlayarrArtwork(work: featured, kind: .backdrop, apiClient: apiClient)
                    .frame(maxWidth: .infinity)
                    .frame(height: HomeLayout.backdropHeight(viewportHeight: height, phone: phone))
                    .opacity(phone ? 0.42 : 0.72)
            }
            LinearGradient(
                stops: phone
                    ? [
                        .init(color: .clear, location: 0.12),
                        .init(color: PlayarrStyle.surface.opacity(0.34), location: 0.33),
                        .init(color: PlayarrStyle.surface, location: 0.52),
                    ]
                    : [
                        .init(color: PlayarrStyle.surface.opacity(0.12), location: 0),
                        .init(color: PlayarrStyle.surface.opacity(0.36), location: 1),
                    ],
                startPoint: .top,
                endPoint: .bottom
            )
            LinearGradient(
                colors: [PlayarrStyle.surface.opacity(phone ? 0.28 : 0.5), .clear],
                startPoint: .leading,
                endPoint: .trailing
            )
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

    private func rails(phone: Bool, width: CGFloat, height: CGFloat, safeTop: CGFloat) -> some View {
        let signature = viewModel.rails
            .flatMap { [$0.id] + $0.works.map { $0.id.uuidString } }
            .joined(separator: ":")
        return ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: phone ? 24 : 48) {
                ForEach(viewModel.rails) { rail in
                    mediaRail(rail, phone: phone, width: width)
                }
            }
            .frame(width: phone ? width : width * 0.62, alignment: .leading)
            .padding(.top, phone ? max(76, safeTop + 58) : height * 0.5)
            .padding(.bottom, phone ? 112 : height * 0.5)
        }
        .refreshable { await viewModel.load() }
        .contentMargins(.horizontal, 0, for: .scrollContent)
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
        .frame(
            width: phone ? width : width * 0.62,
            height: height,
            alignment: .topLeading
        )
        .id("\(railSessionID.uuidString):\(signature)")
    }

    private func mediaRail(_ rail: HomeViewModel.Rail, phone: Bool, width: CGFloat) -> some View {
        let mediaCardWidth = cardWidth(phone: phone, viewport: width)
        let railWidth = phone ? width : width * 0.62
        return VStack(alignment: .leading, spacing: phone ? 8 : 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(rail.title)
                    .font(.custom("Avenir Next", fixedSize: phone ? 16 : 14).weight(.semibold))
                    .tracking(-0.4)
                    .foregroundStyle(PlayarrStyle.ink)
                Text("\(rail.works.count) titles")
                    .font(.custom("Avenir Next", fixedSize: phone ? 10.5 : 8.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
            }
            .padding(.horizontal, phone ? 16 : 24)

            GeometryReader { proxy in
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: phone ? 12 : 18) {
                        ForEach(rail.works) { work in
                            workLink(work) {
                                PlayarrMediaCard(
                                    work: work,
                                    apiClient: apiClient,
                                    progress: viewModel.progressByWorkID[work.id],
                                    width: mediaCardWidth
                                )
                            }
                        }
                    }
                    .padding(.horizontal, phone ? 16 : 24)
                    .padding(.vertical, 8)
                }
                .contentMargins(.horizontal, 0, for: .scrollContent)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
                .scrollIndicators(.hidden)
                .id("\(railSessionID.uuidString):\(rail.id):\(rail.works.map { $0.id.uuidString }.joined(separator: ":"))")
            }
            .frame(width: railWidth, height: HomeLayout.carouselHeight(cardWidth: mediaCardWidth, phone: phone))
        }
        .frame(width: railWidth, alignment: .leading)
        .id(rail.id)
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
