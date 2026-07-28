import SwiftUI

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
}

/// Root used only when `-PlayarrParityScreen` is present: pure chrome, no network.
struct TVParityRootView: View {
    let screen: TVParityScreenID

    var body: some View {
        ZStack {
            TVStageBackground()
            content
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
