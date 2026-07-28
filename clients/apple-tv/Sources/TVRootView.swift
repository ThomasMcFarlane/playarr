import SwiftUI

struct TVRootView: View {
    @Environment(TVAppEnvironment.self) private var environment

    var body: some View {
        ZStack {
            TVStageBackground()

            // Device-code pairing is the first-run gate (RFC 8628), matching
            // ui-tv `TvApp` which shows `PairingScreen` until authenticated.
            switch environment.pairingState {
            case .signedIn:
                signedInTabs
            default:
                NavigationStack {
                    TVPairingGateView()
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(DesignTokens.Color.brandPrimary)
    }

    private var signedInTabs: some View {
        TabView {
            NavigationStack {
                TVHomeView()
            }
            .tabItem { Label("Home", systemImage: "house") }

            NavigationStack {
                TVSearchView()
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }

            NavigationStack {
                TVSettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

/// Full-screen pairing gate aligned with ui-tv `PairingScreen`.
struct TVPairingGateView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var pairingTask: Task<Void, Never>?
    @State private var serverError: String?

    var body: some View {
        @Bindable var environment = environment

        ZStack {
            TVStageBackground()

            VStack(spacing: DesignTokens.Spacing.lg) {
                Text("Playarr Server")
                    .font(TVTheme.displayFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)

                pairingBody

                serverAddressEditor
            }
            .padding(DesignTokens.Spacing.xxxl)
            .frame(maxWidth: 1200)
        }
        .onAppear {
            if case .signedOut = environment.pairingState {
                beginPairing()
            }
        }
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
        }
    }

    @ViewBuilder
    private var pairingBody: some View {
        switch environment.pairingState {
        case .signedOut, .requestingCode:
            Text("Requesting a pairing code...")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            ProgressView()
                .tint(DesignTokens.Color.brandPrimary)
        case .awaitingApproval(let pending):
            VStack(spacing: DesignTokens.Spacing.md) {
                Text("Scan the QR code, or visit")
                    .font(TVTheme.subtitleFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Text(pending.verificationUri)
                    .font(TVTheme.titleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .multilineTextAlignment(.center)
                Text("and enter the code")
                    .font(TVTheme.subtitleFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Text(pending.userCode)
                    .font(.system(size: 64, weight: .bold, design: .monospaced))
                    .tracking(8)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
                    .padding(.vertical, DesignTokens.Spacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.lg, style: .continuous)
                            .fill(DesignTokens.Color.backgroundRaised)
                    )
                    .accessibilityLabel("Pairing code \(pending.userCode)")
                ProgressView("Waiting for approval…")
                    .tint(DesignTokens.Color.brandPrimary)
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Button("Cancel pairing", role: .cancel) {
                    pairingTask?.cancel()
                    pairingTask = nil
                    environment.signOut()
                }
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        case .signedIn:
            EmptyView()
        case .failed(let message):
            Text(message)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.stateError)
                .multilineTextAlignment(.center)
            TVPrimaryButton(label: "Try again") { beginPairing() }
        }
    }

    private var serverAddressEditor: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            Text("Server address")
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            TextField(
                "https://playarr.example",
                text: Bindable(environment).serverAddress
            )
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(DesignTokens.Spacing.md)
                .frame(maxWidth: 720)
                .background(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.input, style: .continuous)
                        .fill(DesignTokens.Color.backgroundRaised)
                )
                .textContentType(.URL)
                .autocorrectionDisabled()
            Button("Save server") {
                serverError = environment.saveServerAddress()
                    ? nil
                    : "Enter a valid HTTP or HTTPS server address."
                if serverError == nil { beginPairing() }
            }
            .font(TVTheme.bodyFont(emphasis: true))
            .foregroundStyle(DesignTokens.Color.brandPrimary)
            if let serverError {
                Text(serverError)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.stateError)
            }
        }
        .padding(.top, DesignTokens.Spacing.xl)
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}
