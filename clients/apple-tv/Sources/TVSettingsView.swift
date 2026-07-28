import SwiftUI

struct TVSettingsView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var serverError: String?
    @State private var pairingTask: Task<Void, Never>?

    var body: some View {
        @Bindable var environment = environment

        ZStack {
            TVStageBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xl) {
                    Text("Settings")
                        .font(TVTheme.displayFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)

                    settingsCard(title: "Playarr Server") {
                        TextField("Server address", text: $environment.serverAddress)
                            .font(TVTheme.bodyFont())
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .padding(DesignTokens.Spacing.md)
                            .background(
                                RoundedRectangle(cornerRadius: DesignTokens.Radius.input, style: .continuous)
                                    .fill(DesignTokens.Color.backgroundBase)
                            )
                            .textContentType(.URL)
                            .autocorrectionDisabled()

                        Button("Save server") {
                            serverError = environment.saveServerAddress()
                                ? nil
                                : "Enter a valid HTTP or HTTPS server address."
                        }
                        .font(TVTheme.bodyFont(emphasis: true))
                        .foregroundStyle(DesignTokens.Color.brandPrimary)

                        if let serverError {
                            Label(serverError, systemImage: "exclamationmark.triangle")
                                .font(TVTheme.captionFont())
                                .foregroundStyle(DesignTokens.Color.stateError)
                        }
                    }

                    settingsCard(title: "Account") {
                        pairingContent
                    }

                    settingsCard(title: "About") {
                        labeledRow("App", value: "Playarr for Apple TV")
                        labeledRow("Server", value: environment.serverURL.absoluteString)
                        labeledRow("Theme base", value: DesignTokens.Hex.backgroundBase)
                        labeledRow("Brand primary", value: DesignTokens.Hex.brandPrimary)
                    }
                }
                .padding(DesignTokens.Spacing.xxxl)
                .frame(maxWidth: 1100, alignment: .leading)
            }
        }
        .navigationTitle("Settings")
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
        }
    }

    private func settingsCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Text(title)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            content()
        }
        .padding(DesignTokens.Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card, style: .continuous)
                .fill(DesignTokens.Color.backgroundElevated)
        )
    }

    private func labeledRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Spacer()
            Text(value)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
        }
    }

    @ViewBuilder
    private var pairingContent: some View {
        switch environment.pairingState {
        case .signedOut:
            TVPrimaryButton(label: "Pair this Apple TV") { beginPairing() }
        case .requestingCode:
            ProgressView("Requesting a pairing code…")
                .tint(DesignTokens.Color.brandPrimary)
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .awaitingApproval(let pending):
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                Text("On your phone or computer, open")
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Text(pending.verificationUri)
                    .font(TVTheme.titleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(pending.userCode)
                    .font(.system(size: 58, weight: .bold, design: .monospaced))
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
                Button("Cancel pairing", role: .cancel) {
                    pairingTask?.cancel()
                    pairingTask = nil
                    environment.signOut()
                }
                .foregroundStyle(DesignTokens.Color.textSecondary)
            }
            .padding(.vertical, DesignTokens.Spacing.md)
        case .signedIn:
            Label("Paired", systemImage: "checkmark.circle.fill")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.stateSuccess)
            Button("Sign out", role: .destructive) { environment.signOut() }
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.stateError)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.stateError)
            TVPrimaryButton(label: "Try pairing again") { beginPairing() }
        }
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}
