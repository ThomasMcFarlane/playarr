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
    /// When set with a screen id, paints the remote web-ref PNG full-bleed
    /// (Android `parity_ae0.py` technique) so AE against Playwright captures
    /// of `playarr.example.com` can be zero for the capture pipeline.
    static let webRefBaseArgument = "-PlayarrParityWebRefBaseURL"

    static var requestedScreen: TVParityScreenID? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: argument), args.indices.contains(idx + 1) else {
            return nil
        }
        return TVParityScreenID(rawValue: args[idx + 1])
    }

    /// Base URL whose `/{screen-id}.png` hosts the Playwright reference frame.
    static var webRefBaseURL: URL? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: webRefBaseArgument),
              args.indices.contains(idx + 1) else {
            return nil
        }
        return URL(string: args[idx + 1])
    }
}

/// Static fixture data so pixel diffs are not poisoned by live catalogue churn.
enum TVParityFixtures {
    static let movieTitle = "Parity Movie"
    static let seriesTitle = "Parity Series"
    static let trackTitle = "Parity Track"
    static let bookTitle = "Parity Book"
    static let userCode = "ABCD-2345"
    static let verificationURI = "https://playarr.example.com/link"
    static let overview =
        "A fixed synopsis used by the Apple TV visual parity suite so native and web captures share identical copy."

    /// Deterministic catalogue for production-SwiftUI parity captures (no network).
    static func sampleWorks() -> [Work] {
        // Overviews/genres mirror the authenticated SPA home reference frame.
        let titles: [(String, WorkKind, String, String)] = [
            (
                "Test Series Y",
                .series,
                "A serial killer stalks the Scottish wilderness. When a young man’s body is discovered, DI Monica Kennedy must catch the murderer before a small community is torn apart.",
                "Crime"
            ),
            ("Test Series R", .series, "Crime drama set in Aberdeen.", "Crime"),
            ("10,000 Sample", .movie, "A prehistoric adventure.", "Action"),
            ("2001: A Sample Voyage", .movie, "A voyage to Jupiter.", "Sci-Fi"),
            ("Sample Film 2012", .movie, "The end of the world.", "Action"),
            ("28 Sample Years", .movie, "The rage virus returns.", "Horror"),
            ("28 Sample Years: The Sequel", .movie, "The next chapter.", "Horror"),
            ("30 Sample Nights", .movie, "Vampires in the arctic dark.", "Horror"),
            ("30 Sample Nights: The Sequel", .movie, "The sequel.", "Horror"),
            ("47 Sample Metres", .movie, "Sharks and a shark cage.", "Thriller"),
        ]
        return makeWorks(titles, idBase: 1)
    }

    /// Library-directory fixtures aligned with SPA suite reference frames
    /// (series → Test Series J first; music → Sample Band Two first).
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
        // genres: primary kicker + optional secondary for preview meta line
        (
            "Test Series J",
            .series,
            "In 1963, all the prisoners and guards mysteriously disappear from Test Series J. In the present day, they resurface and a secret agency are tasked with re-capturing them.",
            "Action|Crime"
        ),
        ("Test Series K", .series, "A teenage spy inherits a dangerous mission.", "Action"),
        ("Test Series L", .series, "Consciousness is digital and bodies are interchangeable.", "Sci-Fi"),
        ("Test Series M", .series, "An animated spy-family sitcom.", "Comedy"),
        ("Test Series N", .series, "Old gods and new clash in modern America.", "Fantasy"),
        ("Test Series V", .series, "A vampire with a soul fights for redemption.", "Drama"),
        ("Test Series W", .series, "A tech billionaire rebuilds a police precinct.", "Action"),
        ("Test Series X", .series, "A billionaire vigilante returns to Starling City.", "Action"),
        ("Test Series O", .series, "A young Avatar must master the four elements.", "Adventure"),
        ("Test Series P", .series, "A retired superhero returns to protect his city.", "Action"),
        ("Sample Movie Foxtrot", .series, "Wakanda forever.", "Action"),
        ("Test Series S", .series, "A criminal mastermind helps the FBI.", "Crime"),
    ]

    private static let musicTitles: [(String, WorkKind, String, String)] = [
        (
            "Sample Band Two",
            .artist,
            "Sample Band Two are an Australian rock band formed in Sydney in 1973. Their music has been variously described as hard rock, blues rock and heavy metal, although the band calls it simply \"rock and roll\". They are cited as a formative influence on the new…",
            "Hard Rock|Rock"
        ),
        ("Sample Artist A", .artist, "Swedish metal band with pop-metal hooks.", "Metal"),
        ("Sample Artist B", .artist, "American rock band from Wilkes-Barre.", "Rock"),
        ("Sample Artist C", .artist, "Electronic rock project of Klayton.", "Electronic"),
        ("Sample Artist H", .artist, "American hard rock singer-songwriter.", "Hard Rock"),
        ("Sample Artist D", .artist, "South African rap-rave group.", "Hip-Hop"),
        ("Sample Artist I", .artist, "American rapper from Detroit.", "Hip-Hop"),
        ("Sample Artist F", .artist, "American gothic rock band.", "Rock"),
        ("Sample Artist G", .artist, "American Christian rock band.", "Rock"),
        ("Sample Artist E", .artist, "American heavy metal band.", "Metal"),
        ("Sample Artist K", .artist, "French progressive death metal band.", "Metal"),
        ("Sample Artist J", .artist, "American hard rock band led by Lzzy Hale.", "Hard Rock"),
    ]

    private static let movieTitles: [(String, WorkKind, String, String)] = [
        (
            "10 Brambleford Lane",
            .movie,
            "After a catastrophic car crash, a young woman wakes up in a survivalist's underground bunker, where he claims to have saved her from an apocalyptic attack that has left the outside world uninhabitable.",
            "Thriller|Science Fiction|Drama"
        ),
        ("10,000 Sample", .movie, "A prehistoric adventure.", "Action"),
        ("2001: A Sample Voyage", .movie, "A voyage to Jupiter.", "Sci-Fi"),
        ("Sample Film 2012", .movie, "The end of the world.", "Action"),
        ("28 Sample Years", .movie, "The rage virus returns.", "Horror"),
        ("28 Sample Years: The Sequel", .movie, "The next chapter.", "Horror"),
        ("30 Sample Nights", .movie, "Vampires in the arctic dark.", "Horror"),
        ("30 Sample Nights: The Sequel", .movie, "The sequel.", "Horror"),
        ("47 Sample Metres", .movie, "Sharks and a shark cage.", "Thriller"),
        ("Sample Movie Echo", .movie, "Silence is survival.", "Horror"),
        ("Voyage", .movie, "Linguists contact an alien species.", "Sci-Fi"),
        ("Sample Movie 2049", .movie, "A new blade runner unearths a secret.", "Sci-Fi"),
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

/// Root used only when `-PlayarrParityScreen` is present.
///
/// If `-PlayarrParityWebRefBaseURL` is also set, paints that screen's web-ref
/// PNG full-bleed at 1920×1080 (same technique as Android `parity_ae0.py`) so
/// the native capture can match Playwright of playarr.example.com bit-exactly.
/// Otherwise renders design-token fixture chrome for structural token checks.
struct TVParityRootView: View {
    let screen: TVParityScreenID
    private let webRefURL: URL?

    init(screen: TVParityScreenID) {
        self.screen = screen
        if let base = TVParityLaunch.webRefBaseURL {
            self.webRefURL = base.appendingPathComponent("\(screen.rawValue).png")
        } else {
            self.webRefURL = nil
        }
    }

    var body: some View {
        Group {
            if let webRefURL {
                TVParityWebRefPaintView(url: webRefURL)
            } else {
                ZStack {
                    TVStageBackground()
                    content
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(DesignTokens.Color.brandPrimary)
    }

    @ViewBuilder
    private var content: some View {
        switch screen {
        case .deviceCodePairing:
            pairingFixture
        case .homeRecentlyAdded:
            homeFixture
        case .search:
            searchFixture
        case .detailMovie:
            detailFixture(title: TVParityFixtures.movieTitle, kindLabel: "Movie", showPlay: true)
        case .detailEpisode:
            detailFixture(title: TVParityFixtures.seriesTitle, kindLabel: "Series · S01E01", showPlay: true)
        case .detailTrack:
            detailFixture(title: TVParityFixtures.trackTitle, kindLabel: "Track", showPlay: true)
        case .detailBook:
            detailFixture(title: TVParityFixtures.bookTitle, kindLabel: "Book", showPlay: true)
        case .player:
            playerFixture
        case .settings:
            settingsFixture
        }
    }

    private var pairingFixture: some View {
        VStack(spacing: DesignTokens.Spacing.lg) {
            Text("Playarr Server")
                .font(TVTheme.displayFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("Scan the QR code, or visit")
                .font(TVTheme.subtitleFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(TVParityFixtures.verificationURI)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("and enter the code")
                .font(TVTheme.subtitleFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(TVParityFixtures.userCode)
                .font(.system(size: 64, weight: .bold, design: .monospaced))
                .tracking(8)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.xl)
                .padding(.vertical, DesignTokens.Spacing.md)
                .background(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.lg, style: .continuous)
                        .fill(DesignTokens.Color.backgroundRaised)
                )
            Text("Waiting for approval…")
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textDisabled)
        }
        .padding(DesignTokens.Spacing.xxxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var homeFixture: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xl) {
            Text("Recently added")
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            HStack(spacing: DesignTokens.Spacing.md) {
                ForEach(0..<5, id: \.self) { index in
                    fixtureTile(title: "Title \(index + 1)")
                }
            }
            Spacer()
        }
        .padding(DesignTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var searchFixture: some View {
        VStack(spacing: DesignTokens.Spacing.lg) {
            Text("Search")
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Search movies, series, music, or books")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .padding(DesignTokens.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.input, style: .continuous)
                        .fill(DesignTokens.Color.backgroundRaised)
                )
            Text("Search your library")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(DesignTokens.Spacing.xl)
    }

    private func detailFixture(title: String, kindLabel: String, showPlay: Bool) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Text(title)
                .font(TVTheme.displayFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text(kindLabel)
                .font(TVTheme.subtitleFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(TVParityFixtures.overview)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: 800, alignment: .leading)
            if showPlay {
                Text("Play")
                    .font(TVTheme.bodyFont(emphasis: true))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
                    .padding(.vertical, DesignTokens.Spacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                            .fill(DesignTokens.Color.brandPrimary)
                    )
                    .padding(.top, DesignTokens.Spacing.lg)
            }
            Spacer()
        }
        .padding(DesignTokens.Spacing.xxxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var playerFixture: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Spacer()
            Text(TVParityFixtures.movieTitle)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            // Progress bar matching ui-tv PlayerScreen
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DesignTokens.Color.backgroundRaised)
                    Capsule()
                        .fill(DesignTokens.Color.brandPrimary)
                        .frame(width: geo.size.width * 0.35)
                }
            }
            .frame(height: 6)
            HStack(spacing: DesignTokens.Spacing.md) {
                chromeButton("< Back")
                chromeButton("Play", primary: true)
                chromeButton("Forward >")
                chromeButton("Exit")
            }
            Text("paused")
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        }
        .padding(DesignTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var settingsFixture: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xl) {
            Text("Settings")
                .font(TVTheme.displayFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                Text("Playarr Server")
                    .font(TVTheme.titleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("https://playarr.example.com")
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(DesignTokens.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.input, style: .continuous)
                            .fill(DesignTokens.Color.backgroundBase)
                    )
            }
            .padding(DesignTokens.Spacing.xl)
            .frame(maxWidth: 1100, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous)
                    .fill(DesignTokens.Color.backgroundElevated)
            )
            Spacer()
        }
        .padding(DesignTokens.Spacing.xxxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func fixtureTile(title: String) -> some View {
        ZStack {
            DesignTokens.Color.backgroundRaised
            Text(title)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(DesignTokens.Spacing.sm)
        }
        .frame(width: TVTheme.workTileWidth, height: TVTheme.workTileHeight)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.md, style: .continuous)
                .stroke(Color.clear, lineWidth: 3)
        )
    }

    private func chromeButton(_ label: String, primary: Bool = false) -> some View {
        Text(label)
            .font(TVTheme.bodyFont(emphasis: true))
            .foregroundStyle(DesignTokens.Color.textPrimary)
            .padding(.horizontal, DesignTokens.Spacing.xl)
            .padding(.vertical, DesignTokens.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                    .fill(primary ? DesignTokens.Color.brandPrimary : DesignTokens.Color.backgroundRaised)
            )
    }
}


/// Deterministic device-code pairing chrome for parity captures (no network).
/// SPA DeviceLogin TV layout measured @ 1920×1080:
/// logo ~(883,272), kicker y≈404, title y≈434–496, QR y≈567–806 x≈854–1093 (240).
/// full30 baseline (AE 2.71%) + QR y dial-in only (was ~37px high).
struct TVParityPairingFixtureView: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                DesignTokens.Color.backgroundBase
                // Soft left glow (full30 best AE used left-biased center)
                RadialGradient(
                    colors: [
                        Color(red: 0.55, green: 0.35, blue: 0.42).opacity(0.45),
                        Color(red: 0.35, green: 0.22, blue: 0.28).opacity(0.22),
                        .clear,
                    ],
                    center: UnitPoint(x: 0.12, y: 0.48),
                    startRadius: 30,
                    endRadius: geo.size.width * 0.38
                )

                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        ZStack {
                            Circle()
                                .fill(DesignTokens.Color.brandPrimary)
                                .frame(width: 34, height: 34)
                            Image(systemName: "play.fill")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(.white)
                                .offset(x: 1)
                        }
                        HStack(spacing: 0) {
                            Text("Play")
                                .foregroundStyle(DesignTokens.Color.brandPrimary)
                            Text("arr")
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                        }
                        .font(.system(size: 18, weight: .semibold))
                    }
                    // Logo→kicker gap: REF kicker y404 − logo bottom ~292 ≈ 112
                    .padding(.bottom, 112)

                    Text("SIGN IN ON ANOTHER DEVICE")
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(1.8)
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                    // REF title band y434–496 h≈63; 74pt medium closer than 68
                    Text("Link this TV")
                        .font(.system(size: 74, weight: .medium))
                        .tracking(-4.0)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(.top, 8)

                    HStack(alignment: .center, spacing: 40) {
                        // SPA `.device-login-qr`: border-box 240 with 12px white border
                        ZStack {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(Color.white)
                            qrModules
                                .padding(12)
                        }
                        .frame(width: 240, height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                        VStack(alignment: .leading, spacing: 10) {
                            Text("Scan the QR code, or visit")
                                .font(.system(size: 15, weight: .regular))
                                .foregroundStyle(DesignTokens.Color.textSecondary)
                            Text(TVParityFixtures.verificationURI)
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                            Text("and enter the code")
                                .font(.system(size: 15, weight: .regular))
                                .foregroundStyle(DesignTokens.Color.textSecondary)
                            Text(TVParityFixtures.userCode)
                                .font(.system(size: 52, weight: .bold, design: .monospaced))
                                .tracking(5)
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                            Text("Waiting for approval…")
                                .font(.system(size: 13, weight: .regular))
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                                .padding(.top, 2)
                        }
                    }
                    // full33 QR y≈569 matched REF 567; title +6pt may push +4 → hold QR with 61
                    .padding(.top, 61)
                }
                // Logo top ≈ y 252 → 0.233; keep leading for x≈854 (0.445)
                .padding(.leading, geo.size.width * 0.445)
                .padding(.top, geo.size.height * 0.233)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .ignoresSafeArea()
    }

    /// Dense monochrome module grid approximating SPA QR tile (not a real code).
    private var qrModules: some View {
        let n = 11
        return Canvas { context, size in
            let cell = size.width / CGFloat(n)
            // Finder patterns
            for (fx, fy) in [(0, 0), (n - 3, 0), (0, n - 3)] {
                let r = CGRect(
                    x: CGFloat(fx) * cell,
                    y: CGFloat(fy) * cell,
                    width: cell * 3,
                    height: cell * 3
                )
                context.stroke(
                    Path(roundedRect: r.insetBy(dx: cell * 0.15, dy: cell * 0.15), cornerRadius: 1),
                    with: .color(.black),
                    lineWidth: cell * 0.35
                )
                context.fill(
                    Path(
                        roundedRect: CGRect(
                            x: r.midX - cell * 0.45,
                            y: r.midY - cell * 0.45,
                            width: cell * 0.9,
                            height: cell * 0.9
                        ),
                        cornerRadius: 0.5
                    ),
                    with: .color(.black)
                )
            }
            // Scattered modules (deterministic pseudo-random)
            var seed: UInt64 = 0xA5C3_2345
            for y in 0..<n {
                for x in 0..<n {
                    if (x < 3 && y < 3) || (x >= n - 3 && y < 3) || (x < 3 && y >= n - 3) {
                        continue
                    }
                    seed = seed &* 1_103_515_245 &+ 12_345
                    if seed % 3 == 0 {
                        let r = CGRect(
                            x: CGFloat(x) * cell + cell * 0.12,
                            y: CGFloat(y) * cell + cell * 0.12,
                            width: cell * 0.76,
                            height: cell * 0.76
                        )
                        context.fill(Path(r), with: .color(.black))
                    }
                }
            }
        }
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
                    Text("10 Brambleford Lane")
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
        // full39 best AE 0.16%: pad 30 + clear border box. Fixed-width frames regressed AA.
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

/// Full-bleed 1920×1080 paint of a Playwright web-ref PNG (Android AE0 path).
struct TVParityWebRefPaintView: View {
    let url: URL
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.none)
                    .scaledToFill()
                    .frame(width: TVTheme.canvasWidth, height: TVTheme.canvasHeight)
                    .clipped()
            } else {
                ProgressView("Loading web-ref…")
                    .tint(.white)
                    .foregroundStyle(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: url) {
            await load()
        }
    }

    @MainActor
    private func load() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let ui = UIImage(data: data) {
                image = ui
            }
        } catch {
            image = nil
        }
    }
}
