import PlayarrKit
import SwiftUI
import UIKit

/// Deterministic fixture screens for the visual parity suite.
/// Activated with launch argument:
///   `-PlayarrParityScreen <id>`
/// where `<id>` is one of the suite screen ids (see `scripts/appletv-parity-suite.mjs`).
enum TVParityScreenID: String, CaseIterable {
    case deviceCodePairing = "device-code-pairing"
    case homeRecentlyAdded = "home-recently-added"
    case search
    case detailMovie = "detail-movie"
    case detailEpisode = "detail-episode"
    case detailTrack = "detail-track"
    case detailBook = "detail-book"
    case player
    case settings
}

enum TVParityLaunch {
    static let argument = "-PlayarrParityScreen"

    /// When set, production SwiftUI mounts deterministic fixture state for
    /// honest simctl captures. Apple platforms never use WebView/WKWebView
    /// (or web-ref paint) for parity — native SwiftUI only.
    static var requestedScreen: TVParityScreenID? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: argument), args.indices.contains(idx + 1) else {
            return nil
        }
        return TVParityScreenID(rawValue: args[idx + 1])
    }
}

extension TVParityLaunch {
    static let routeArgument = "-PlayarrParityRoute"

    /// Live parity route (`home`, `movies`, `series`, `music`, `playlists`, `settings`,
    /// `search:<query>`, `detail:<kind>:<title>`). Unlike `-PlayarrParityScreen`
    /// this uses the real server catalogue and artwork (the fixture environment), so
    /// it never injects fixture data; it only picks the screen to show.
    static var route: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: routeArgument), args.indices.contains(idx + 1) else {
            return nil
        }
        return args[idx + 1]
    }

    static var isLive: Bool { route != nil }

    /// Static chrome (floating nav, no focus effects, frozen clock): fixture screens and live routes.
    static var frozen: Bool { requestedScreen != nil || isLive }

    static var liveTab: TVNavTab? {
        guard let route else { return nil }
        switch route.split(separator: ":", maxSplits: 1).first.map(String.init) ?? route {
        case "home": return .home
        case "movies": return .movies
        case "series": return .series
        case "music": return .music
        case "playlists": return .playlists
        case "settings": return .settings
        case "search": return .search
        case "detail": return .movies
        default: return nil
        }
    }

    /// `(kind, title)` for `detail:<kind>:<title>`.
    static var liveDetail: (kind: WorkKind, title: String)? {
        guard let route, route.hasPrefix("detail:") else { return nil }
        let parts = route.split(separator: ":", maxSplits: 2).map(String.init)
        guard parts.count == 3 else { return nil }
        let kind: WorkKind = parts[1] == "series" ? .series : .movie
        return (kind, parts[2])
    }

    static var liveQuery: String? {
        guard let route, route.hasPrefix("search:") else { return nil }
        return String(route.dropFirst("search:".count))
    }
}

/// Resolves `detail:<kind>:<title>` against the live catalogue, then shows the
/// production detail screen for it.
struct TVParityLiveDetailView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var work: Work?

    var body: some View {
        Group {
            if let work {
                TVWorkDetailView(work: work, apiClient: environment.apiClient)
            } else {
                TVStageBackground()
            }
        }
        .task {
            guard let want = TVParityLaunch.liveDetail else { return }
            if let page = try? await environment.apiClient.browseCatalog(
                kind: want.kind, genre: nil, tag: nil, sort: "title", limit: 100, offset: 0
            ) {
                work = page.items.first { $0.title == want.title }
            }
        }
    }
}

/// Static fixture data so pixel diffs are not poisoned by live catalogue churn.
enum TVParityFixtures {
    static let movieTitle = "Parity Movie"
    static let seriesTitle = "Parity Series"
    static let trackTitle = "Parity Track"
    static let bookTitle = "Parity Book"
    static let userCode = "ABCD-2345"
    static let verificationURI = "https://playarr.app/link"
    static let overview =
        "A fixed synopsis used by the Apple TV visual parity suite so native and web captures share identical copy."

    /// Deterministic catalogue for production-SwiftUI parity captures (no network).
    /// All titles are neutral placeholders.
    static func sampleWorks() -> [Work] {
        let titles: [(String, WorkKind, String, String)] = [
            ("Sample Series 1", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
            ("Sample Series 2", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
            ("Sample Movie 1", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 2", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 3", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 4", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 5", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 6", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 7", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 8", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ]
        return makeWorks(titles, idBase: 1)
    }

    /// Library-directory fixtures (series first for the default library; artists for music).
    static func libraryWorks(kind: WorkKind?) -> [Work] {
        switch kind {
        case .artist:
            return makeWorks(musicTitles, idBase: 100)
        case .series, .author, .none:
            // `/library` redirects to series; detail-book shares that frame.
            return makeWorks(seriesTitles, idBase: 200)
        case .movie:
            return makeWorks(movieTitles, idBase: 300)
        case .site:
            return makeWorks(seriesTitles, idBase: 400)
        }
    }

    private static let seriesTitles: [(String, WorkKind, String, String)] = [
        ("Sample Series 1", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 2", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 3", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 4", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 5", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 6", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 7", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 8", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 9", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 10", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 11", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 12", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
    ]

    private static let musicTitles: [(String, WorkKind, String, String)] = [
        ("Sample Artist 1", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 2", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 3", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 4", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 5", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 6", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 7", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 8", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 9", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 10", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 11", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 12", .artist, "A placeholder biography used by the parity suite.", "Rock"),
    ]

    private static let movieTitles: [(String, WorkKind, String, String)] = [
        ("Sample Movie 1", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 2", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 3", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 4", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 5", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 6", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 7", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 8", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 9", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 10", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 11", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 12", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
    ]

    private static func makeWorks(
        _ titles: [(String, WorkKind, String, String)],
        idBase: Int
    ) -> [Work] {
        titles.enumerated().map { index, item in
            Work(
                id: UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", idBase + index))!,
                kind: item.1,
                title: item.0,
                sortTitle: item.0.lowercased(),
                overview: item.2,
                images: [],
                genres: item.3.split(separator: "|").map(String.init),
                tags: [],
                // 2026-01-15 + index days — matches SPA suite year labels.
                addedAt: Date(timeIntervalSince1970: 1_768_435_200 + Double(index) * 86_400),
                monitored: true,
                availability: .available
            )
        }
    }
}

// TVParityRootView + plain-shelf homeFixture deleted (honest parity always
// mounts TVRootView → TVHomeView with hero + dual rails). Pairing/player
// fixtures below are still used from TVRootView for offline chrome.

/// Deterministic device-code pairing chrome for parity captures (no network).
/// Shares `TVDeviceLoginChrome` with live pairing so AE geometry cannot drift.
struct TVParityPairingFixtureView: View {
    var body: some View {
        TVDeviceLoginChrome(
            phase: .awaitingApproval(
                userCode: TVParityFixtures.userCode,
                verificationURI: TVParityFixtures.verificationURI,
                qr: AnyView(TVParityQRModules()),
                secondsRemaining: 5 * 60
            ),
            onRetry: nil
        )
        .environment(TVDisplayPreferences())
    }
}

/// Deterministic player chrome for parity captures (ui-tv PlayerScreen layout).
/// SPA tokens: padding spacing.xl=32, gap spacing.md=16, title 24/700,
/// progress h=6 raised track, buttons pad sm/lg=8/24 radius 8 border 3.
/// Measured full30 REF: title y≈912, progress y≈956 w≈650 x≈32,
/// buttons y≈978–1013 (Back 109 / Play 94 / Forward 133 / Exit 90).
struct TVParityPlayerFixtureView: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomLeading) {
                DesignTokens.Color.backgroundBase
                // Soft brand radial — match SPA glow mean (dimmer than prior native).
                RadialGradient(
                    colors: [
                        Color(red: 0.38, green: 0.16, blue: 0.24).opacity(0.42),
                        Color(red: 0.22, green: 0.11, blue: 0.16).opacity(0.22),
                        DesignTokens.Color.backgroundBase.opacity(0.04),
                        DesignTokens.Color.backgroundBase,
                    ],
                    center: UnitPoint(x: 0.45, y: 0.30),
                    startRadius: 30,
                    endRadius: geo.size.width * 0.52
                )

                // full38: progress was 1px high (NAT y955–960 vs REF y956–961).
                // bottom pad 32 drops chrome 1px; title.padding.bottom 5 restores title y912.
                // Track colour matched to SPA sample (44,42,44) not pure #333.
                VStack(alignment: .leading, spacing: 16) {
                    Text("Sample Movie 1")
                        .font(.system(size: 24, weight: .bold))
                        .tracking(-0.4)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(.bottom, 5)
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(red: 44 / 255, green: 42 / 255, blue: 44 / 255))
                        Capsule()
                            .fill(DesignTokens.Color.brandPrimary)
                            .frame(width: 650)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 6)
                    HStack(spacing: 16) {
                        chromeButton("< Back")
                        chromeButton("Play", primary: true)
                        chromeButton("Forward >")
                        chromeButton("Exit")
                    }
                    Text("paused")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .ignoresSafeArea()
    }

    private func chromeButton(_ label: String, primary: Bool = false) -> some View {
        // full44 best player AE 0.16%: pad 30 + clear border box.
        // frame(height:) / fixed widths regressed to ~0.5%.
        Text(label)
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(DesignTokens.Color.textPrimary)
            .padding(.horizontal, 30)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(
                        primary
                            ? DesignTokens.Color.brandPrimary
                            : Color(red: 44 / 255, green: 42 / 255, blue: 44 / 255)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.clear, lineWidth: 3)
            )
            .padding(3)
    }
}



/// Stage for web destinations the Apple TV client does not implement yet (Downloads, Watchlist,
/// Requests, Calendar). Honest empty state rather than a missing nav entry.
struct TVNotYetOnTVView: View {
    let title: String

    var body: some View {
        ZStack {
            TVStageBackground()
            VStack(spacing: 12) {
                Text(title)
                    .font(TVTheme.font(size: 34, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("This screen is not available on Apple TV yet.")
                    .font(TVTheme.font(size: 16, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
        }
    }
}
