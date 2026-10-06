import PlayarrKit
import SwiftUI

enum HomeLayout {
    static let phoneGutter: CGFloat = 16
    static let phoneTopOffset: CGFloat = 78

    static func backdropHeight(viewportHeight: CGFloat, phone: Bool) -> CGFloat {
        phone ? viewportHeight * 0.55 : viewportHeight
    }

    static func carouselHeight(cardWidth: CGFloat, phone: Bool) -> CGFloat {
        cardWidth * 9 / 16 + (phone ? 52 : 46)
    }

    static func railWidth(viewportWidth: CGFloat, phone: Bool) -> CGFloat {
        phone ? viewportWidth : viewportWidth * 0.62
    }

    static func cardWidth(viewportWidth: CGFloat, phone: Bool) -> CGFloat {
        phone ? min(210, viewportWidth * 0.46) : min(225, max(150, viewportWidth * 0.114))
    }
}

struct HomeView: View {
    let viewModel: HomeViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var downloadTarget: Work?
    @Environment(\.colorScheme) private var scheme

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
        .sheet(item: $downloadTarget) { work in
            WorkDownloadSheet(work: work, apiClient: apiClient, downloadRepository: downloadRepository)
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
        }
    }

    private var loadedContent: some View {
        GeometryReader { proxy in
            if PlayarrLayout.isPhone(proxy.size) {
                phoneContent
            } else {
                stageContent(proxy: proxy)
            }
        }
        .background(PlayarrStyle.surface)
        .ignoresSafeArea(edges: .horizontal)
        .navigationBarHidden(true)
    }

    /// Web mobile home: left-aligned horizontal rails under the page gutter,
    /// 179x101 cards, no featured-title copy (numbers from the web layout dump).
    private var phoneContent: some View {
        ZStack(alignment: .topLeading) {
            WM.page
            LinearGradient(
                stops: [
                    .init(color: WM.adaptive(light: (222, 221, 220), dark: (34, 32, 34)), location: 0),
                    .init(color: WM.adaptive(light: (222, 221, 220), dark: (34, 32, 34)), location: 0.18),
                    .init(color: WM.page, location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: scheme == .dark ? 330 : 170)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(viewModel.rails.enumerated()), id: \.element.id) { index, rail in
                        phoneRail(rail, first: index == 0)
                    }
                }
                .padding(.top, 89)
                .padding(.bottom, 130)
            }
            .scrollIndicators(.hidden)
            .refreshable { await viewModel.load() }
        }
        .ignoresSafeArea()
    }

    private func phoneRail(_ rail: HomeViewModel.Rail, first: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WMText(rail.title, 16, 610, lh: 24, ls: -0.48).padding(.horizontal, 16)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(Array(rail.works.enumerated()), id: \.element.id) { index, work in
                        workLink(work) {
                            WMRailCard(
                                work: work,
                                apiClient: apiClient,
                                unseen: viewModel.progressByWorkID[work.id] == nil,
                                focused: first && index == 0
                            )
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollClipDisabled()
            .scrollIndicators(.hidden)
            .frame(height: 147)
            .padding(.top, 18)
        }
        .padding(.bottom, 66)
    }

    private func stageContent(proxy: GeometryProxy) -> some View {
        Group {
            let phone = false
            let backdropHeight = proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
            ZStack(alignment: .topLeading) {
                stageBackdrop(phone: phone, height: backdropHeight)
                    .ignoresSafeArea()

                if !phone, let featured = viewModel.featuredWork {
                    featuredCopy(featured)
                        .frame(width: proxy.size.width * 0.36, alignment: .leading)
                        .padding(.leading, max(112, proxy.size.width * 0.085))
                        .padding(.top, proxy.size.height * 0.24)
                }

                rails(
                    phone: phone,
                    width: proxy.size.width,
                    height: proxy.size.height
                )
                    .frame(
                        width: HomeLayout.railWidth(viewportWidth: proxy.size.width, phone: phone),
                        height: proxy.size.height,
                        alignment: .topLeading
                    )
                    .offset(x: phone ? 0 : proxy.size.width * 0.38)
                    .zIndex(2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
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
                apiClient: apiClient,
                downloadRepository: downloadRepository
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
        .contextMenu {
            Button("Download", systemImage: "arrow.down.circle") { downloadTarget = work }
        }
    }

    private func rails(phone: Bool, width: CGFloat, height: CGFloat) -> some View {
        let railWidth = HomeLayout.railWidth(viewportWidth: width, phone: phone)
        return ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: phone ? 24 : 48) {
                ForEach(viewModel.rails) { rail in
                    mediaRail(rail, phone: phone, width: width)
                }
            }
            .frame(width: railWidth, alignment: .leading)
            .padding(.top, phone ? HomeLayout.phoneTopOffset : height * 0.5)
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
        .frame(
            width: railWidth,
            height: height,
            alignment: .topLeading
        )
    }

    private func mediaRail(_ rail: HomeViewModel.Rail, phone: Bool, width: CGFloat) -> some View {
        let mediaCardWidth = HomeLayout.cardWidth(viewportWidth: width, phone: phone)
        let railWidth = HomeLayout.railWidth(viewportWidth: width, phone: phone)
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
            .padding(.horizontal, phone ? HomeLayout.phoneGutter : 24)

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
                .padding(.horizontal, phone ? HomeLayout.phoneGutter : 24)
                .padding(.vertical, 8)
            }
            .frame(
                width: railWidth,
                height: HomeLayout.carouselHeight(cardWidth: mediaCardWidth, phone: phone),
                alignment: .leading
            )
            .scrollIndicators(.hidden)
        }
        .frame(width: railWidth, alignment: .leading)
    }

    private func workLink<Content: View>(_ work: Work, @ViewBuilder content: () -> Content) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                apiClient: apiClient,
                downloadRepository: downloadRepository
            )
        } label: {
            content()
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Download", systemImage: "arrow.down.circle") { downloadTarget = work }
        }
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        HomeView(
            viewModel: HomeViewModel(apiClient: apiClient),
            apiClient: apiClient,
            downloadRepository: DownloadRepository(apiClient: apiClient)
        )
    }
}
