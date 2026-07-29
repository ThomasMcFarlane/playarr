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
                qr: AnyView(TVParityQRModules())
            ),
            onRetry: nil
        )
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


