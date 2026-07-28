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
        let titles = [
            ("Test Series Y", WorkKind.series, "A serial killer stalks the Scottish wilderness."),
            ("Test Series R", WorkKind.series, "Crime drama set in Aberdeen."),
            ("10,000 Sample", WorkKind.movie, "A prehistoric adventure."),
            ("2001: A Sample Voyage", WorkKind.movie, "A voyage to Jupiter."),
            ("Sample Film 2012", WorkKind.movie, "The end of the world."),
            ("28 Sample Years", WorkKind.movie, "The rage virus returns."),
            ("28 Sample Years: The Sequel", WorkKind.movie, "The next chapter."),
            ("30 Sample Nights", WorkKind.movie, "Vampires in the arctic dark."),
            ("30 Sample Nights: The Sequel", WorkKind.movie, "The sequel."),
            ("47 Sample Metres", WorkKind.movie, "Sharks and a shark cage."),
        ]
        return titles.enumerated().map { index, item in
            Work(
                id: UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", index + 1))!,
                kind: item.1,
                title: item.0,
                sortTitle: item.0.lowercased(),
                overview: item.2,
                images: [],
                genres: ["Drama"],
                tags: [],
                addedAt: Date(timeIntervalSince1970: 1_700_000_000 + Double(index)),
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
