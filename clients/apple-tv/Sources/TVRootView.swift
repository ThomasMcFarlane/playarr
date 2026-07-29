import PlayarrKit
import SwiftUI

struct TVRootView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var selectedTab: TVNavTab = .home

    /// When `-PlayarrParityScreen` is set, force that tab so simctl captures
    /// hit production SwiftUI (never WebView / web-ref paint).
    ///
    /// Suite `webPath` maps:
    ///   detail-episode → /series (library)
    ///   detail-track → /music (library)
    ///   detail-book → /library → /series (library)
    ///   detail-movie → SPA capture shows work-detail chrome (chapters/cast)
    private var parityForcedTab: TVNavTab? {
        guard let screen = TVParityLaunch.requestedScreen else { return nil }
        switch screen {
        case .search: return .search
        case .homeRecentlyAdded: return .home
        case .settings: return .settings
        case .detailEpisode, .detailBook: return .series
        case .detailTrack: return .music
        case .detailMovie: return .movies // shell chrome; detail overlay below
        case .deviceCodePairing: return nil
        case .player: return nil
        }
    }

    /// Work-detail fixture for screens whose SPA reference is a title page
    /// (detail-movie / player), not a library directory.
    private var parityWorkDetail: Work? {
        guard let screen = TVParityLaunch.requestedScreen else { return nil }
        switch screen {
        case .detailMovie:
            return TVParityFixtures.libraryWorks(kind: .movie).first
        case .player:
            return TVParityFixtures.libraryWorks(kind: .movie).first
                ?? TVParityFixtures.sampleWorks().first
        default:
            return nil
        }
    }

    var body: some View {
        ZStack {
            TVStageBackground()

            if TVParityLaunch.requestedScreen == .deviceCodePairing {
                // Fixture device-code chrome (do not hit live ATS / network).
                TVParityPairingFixtureView()
            } else if TVParityLaunch.requestedScreen == .player {
                // Fixture player chrome (SPA suite maps /login when media is unavailable).
                TVParityPlayerFixtureView()
            } else if TVParityLaunch.requestedScreen == .detailMovie, let work = parityWorkDetail {
                // SPA movie ref is work-detail with shell (nav/logo/profile).
                signedInShell(forcedSelection: .movies, detailWork: work)
            } else {
                switch environment.pairingState {
                case .signedIn:
                    signedInShell
                default:
                    if let forced = parityForcedTab {
                        signedInShell(forcedSelection: forced)
                    } else if TVParityLaunch.requestedScreen == nil {
                        TVPairingGateView()
                    } else {
                        signedInShell
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(DesignTokens.Color.brandPrimary)
        .onAppear {
            if let forced = parityForcedTab {
                selectedTab = forced
            }
        }
    }

    private var signedInShell: some View {
        signedInShell(forcedSelection: nil, detailWork: nil)
    }

    private func signedInShell(forcedSelection: TVNavTab?, detailWork: Work? = nil) -> some View {
        let tab = forcedSelection ?? selectedTab
        return ZStack(alignment: .topLeading) {
            // Floating left nav first in the tree so the focus engine can reach
            // it when moving left from stage content (sibling focusSection).
            TVFloatingNav(
                selection: Binding(
                    get: { forcedSelection ?? selectedTab },
                    set: { if forcedSelection == nil { selectedTab = $0 } }
                ),
                suppressFocusChrome: TVParityLaunch.requestedScreen != nil,
                // SPA never shows the settings gear in the floating nav on
                // library/home/search/settings frames (settings is reached
                // via other chrome). Keep gear only for live non-parity.
                showSettings: TVParityLaunch.requestedScreen == nil
            )
            .padding(.leading, DesignTokens.Shell.navEdge)
            .frame(maxHeight: .infinity, alignment: .center)
            .focusSection()
            .zIndex(50)

            // Main content fills the stage
            NavigationStack {
                Group {
                    if let detailWork {
                        TVWorkDetailView(work: detailWork, apiClient: environment.apiClient)
                    } else {
                        switch tab {
                        case .home:
                            TVHomeView()
                        case .search:
                            TVSearchView()
                        case .settings:
                            TVSettingsView()
                        case .series:
                            TVLibraryKindView(
                                kindLabel: "Series",
                                emptyMessage: "No series in your library yet.",
                                workKind: .series,
                                collectionNoun: "TITLES"
                            )
                        case .movies:
                            TVLibraryKindView(
                                kindLabel: "Movies",
                                emptyMessage: "No movies in your library yet.",
                                workKind: .movie,
                                collectionNoun: "TITLES"
                            )
                        case .music:
                            TVLibraryKindView(
                                kindLabel: "Music",
                                emptyMessage: "No music in your library yet.",
                                workKind: .artist,
                                collectionNoun: "ARTISTS"
                            )
                        case .playlists:
                            TVLibraryKindView(
                                kindLabel: "Playlists",
                                emptyMessage: "No playlists yet.",
                                workKind: nil,
                                collectionNoun: "PLAYLISTS"
                            )
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .toolbar(.hidden, for: .navigationBar)
                .navigationBarBackButtonHidden(true)
                .focusSection()
            }
            .zIndex(10)

            // Logo / clock — never steals remote focus.
            TVShellHeader(frozenClock: TVParityLaunch.requestedScreen != nil)
                .frame(maxWidth: .infinity, alignment: .top)
                .allowsHitTesting(false)
                .zIndex(80)

            // Profile chip (live SPA shows signed-in user under the nav).
            VStack {
                Spacer()
                HStack {
                    TVProfileChip(
                        name: TVParityLaunch.requestedScreen != nil ? "Test User A" : "Viewer",
                        version: TVParityLaunch.requestedScreen != nil ? "v0.1.0" : nil
                    )
                    .padding(.leading, DesignTokens.Shell.navEdge - 4)
                    .padding(.bottom, 36)
                    Spacer()
                }
            }
            .allowsHitTesting(false)
            .zIndex(50)
        }
        // Shell chrome is authored for the full 1920×1080 stage, matching web
        // CSS viewport units. Safe-area inset would shift logo/nav/header.
        .ignoresSafeArea()
    }
}

/// Full-screen pairing gate: SPA DeviceLogin chrome 1:1 via
/// `TVDeviceLoginChrome`. Server URL is not typed here; playarr.app hosted
/// link supplies it from the phone claim.
struct TVPairingGateView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var pairingTask: Task<Void, Never>?

    var body: some View {
        chrome
            .onAppear {
                // Recover from cold launch and from URLSession "cancelled"
                // failures without needing a remote click on Try again.
                switch environment.pairingState {
                case .signedOut, .failed:
                    beginPairing()
                default:
                    break
                }
            }
            .onDisappear {
                if case .signedIn = environment.pairingState { return }
                pairingTask?.cancel()
                pairingTask = nil
            }
    }

    @ViewBuilder
    private var chrome: some View {
        switch environment.pairingState {
        case .signedOut, .requestingCode:
            TVDeviceLoginChrome(phase: .requesting, onRetry: nil)
        case .awaitingApproval(let pending):
            TVDeviceLoginChrome(
                phase: .awaitingApproval(
                    userCode: pending.userCode,
                    verificationURI: pending.verificationUri,
                    qr: AnyView(
                        TVHostedLinkQRImage(
                            verificationURIComplete: pending.verificationUriComplete
                        )
                    )
                ),
                onRetry: nil
            )
        case .signedIn:
            EmptyView()
        case .failed(let message):
            TVDeviceLoginChrome(
                phase: .failed(message),
                onRetry: { beginPairing() }
            )
        }
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}

/// SPA DeviceLogin chrome measured @ 1920×1080 (same geometry as the parity
/// fixture). Live pairing and parity fixture both mount this so product UI
/// cannot diverge from the reference layout.
///
/// Geometry notes (from full30/full33 dial-in):
/// - logo ~(883,272), kicker y≈404, title y≈434–496
/// - QR y≈567–806 x≈854–1093 (240 border-box, 12pt white edge, r=18)
/// - content leading = width×0.445, top = height×0.233
struct TVDeviceLoginChrome: View {
    enum Phase {
        case requesting
        case awaitingApproval(userCode: String, verificationURI: String, qr: AnyView)
        case failed(String)
    }

    let phase: Phase
    var onRetry: (() -> Void)?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                DesignTokens.Color.backgroundBase
                // SPA left wash is cool/neutral (sampled mean ~35,31,34) — not pink.
                RadialGradient(
                    colors: [
                        Color(red: 0.28, green: 0.26, blue: 0.28).opacity(0.38),
                        Color(red: 0.18, green: 0.16, blue: 0.18).opacity(0.18),
                        .clear,
                    ],
                    center: UnitPoint(x: 0.12, y: 0.48),
                    startRadius: 30,
                    endRadius: geo.size.width * 0.38
                )

                VStack(alignment: .leading, spacing: 0) {
                    playarrWordmark
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

                    phaseBody
                        // full33 QR y≈569 matched REF 567
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

    private var playarrWordmark: some View {
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
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch phase {
        case .requesting:
            Text("Creating a secure sign-in code…")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .awaitingApproval(let userCode, let verificationURI, let qr):
            HStack(alignment: .center, spacing: 40) {
                // SPA `.device-login-qr`: border-box 240 with 12px white border
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.white)
                    qr
                        .frame(width: 216, height: 216)
                }
                .frame(width: 240, height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 10) {
                    Text("Scan the QR code, or visit")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    Text(verificationURI)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("and enter the code")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    Text(userCode)
                        .font(.system(size: 52, weight: .bold, design: .monospaced))
                        .tracking(5)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("Waiting for approval…")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .padding(.top, 2)
                }
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 16) {
                Text(message)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.stateError)
                    .fixedSize(horizontal: false, vertical: true)
                if let onRetry {
                    Button("Try again", action: onRetry)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.Color.brandPrimary)
                }
            }
        }
    }
}

/// Live hosted-link QR image (playarr.app `/api/link/qr`).
struct TVHostedLinkQRImage: View {
    let verificationURIComplete: String

    var body: some View {
        if let url = HostedDeviceLinkClient.qrImageURL(for: verificationURIComplete) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                case .failure:
                    Color.black.opacity(0.08)
                case .empty:
                    ProgressView()
                        .tint(.black.opacity(0.4))
                @unknown default:
                    Color.black.opacity(0.08)
                }
            }
        } else {
            Color.black.opacity(0.08)
        }
    }
}

/// Deterministic monochrome QR stand-in for parity freezes (no network).
struct TVParityQRModules: View {
    var body: some View {
        let n = 11
        return Canvas { context, size in
            let cell = size.width / CGFloat(n)
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
