import SwiftUI

struct TVSettingsView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var serverError: String?
    @State private var pairingTask: Task<Void, Never>?
    @State private var selectedSection = 0

    private let sections: [(number: String, title: String, description: String)] = [
        ("01", "Appearance", "Choose this device’s theme and home screen artwork."),
        ("02", "Profile avatar", "Pick the face this device uses on the home rail."),
        ("03", "Language", "Interface language for this device."),
        ("04", "Player", "Playback preferences for this Apple TV."),
        ("05", "Server connection", "Playarr Server address and pairing."),
        ("06", "Profile lock", "PIN gate for this profile."),
        ("07", "Invite a friend", "Share access to this server."),
        ("08", "Request latency", "Diagnostics for API round-trips."),
    ]

    var body: some View {
        @Bindable var environment = environment

        ZStack {
            TVStageBackground()
            HStack(alignment: .top, spacing: 0) {
                // Left: SPA `.settings-options-panel` (35fr) + `.settings-options-list`
                // padding-top: --library-rail-top (15vh≈162), left clamp 8vw→154.
                VStack(alignment: .leading, spacing: 0) {
                    // SPA settings heading: white filled back + Preferences + kicker.
                    HStack(alignment: .center, spacing: 14) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.backgroundBase)
                            .frame(width: 48, height: 48)
                            .background(Circle().fill(DesignTokens.Color.textPrimary))
                        Text("Preferences")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(sections[selectedSection].title.uppercased())
                                .font(.system(size: 10, weight: .heavy))
                                .tracking(1.4)
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                            Text(sections[selectedSection].description)
                                .font(TVTheme.captionFont())
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                                .lineLimit(2)
                        }
                        .padding(.leading, 4)
                    }
                    .padding(.bottom, 28)

                    // SPA `.settings-option`: min-height 88, title clamp ~1.6vw≈31,
                    // weight 480; active only changes background (not title size).
                    VStack(spacing: 0) {
                        ForEach(Array(sections.enumerated()), id: \.offset) { index, section in
                            let selected = selectedSection == index
                            Button {
                                selectedSection = index
                            } label: {
                                HStack(spacing: 18) {
                                    Text(section.number)
                                        .font(.system(size: 10, weight: .heavy))
                                        .foregroundStyle(DesignTokens.Color.textDisabled)
                                        .frame(width: 32, alignment: .leading)
                                    Text(section.title)
                                        .font(.system(size: 30, weight: .medium))
                                        .tracking(-1.0)
                                        .foregroundStyle(DesignTokens.Color.textPrimary)
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                    Image(systemName: "arrow.right")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(
                                            selected
                                                ? DesignTokens.Color.textPrimary
                                                : DesignTokens.Color.textDisabled
                                        )
                                }
                                .padding(.horizontal, 28)
                                .frame(minHeight: 88, alignment: .center)
                                .background(
                                    RoundedRectangle(cornerRadius: 0, style: .continuous)
                                        .fill(
                                            selected
                                                ? DesignTokens.Color.backgroundRaised.opacity(0.9)
                                                : Color.clear
                                        )
                                )
                            }
                            .buttonStyle(.plain)
                            .focusable(TVParityLaunch.requestedScreen == nil)
                            .focusEffectDisabled(TVParityLaunch.requestedScreen != nil)
                        }
                    }
                    .frame(width: 465, alignment: .leading)
                    Spacer(minLength: 0)
                }
                // SPA list padding-top 15vh≈162; heading sits in shell header band.
                .padding(.leading, 154)
                .padding(.top, 56)
                .frame(width: 1920 * 0.35, alignment: .topLeading)
                .ignoresSafeArea()

                // Right: SPA `.settings-detail-panel` (65fr)
                VStack(alignment: .leading, spacing: 22) {
                    sectionDetail
                    Spacer()
                }
                .padding(.leading, 40)
                .padding(.top, 162)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
        }
    }

    @ViewBuilder
    private var sectionDetail: some View {
        @Bindable var environment = environment
        switch selectedSection {
        case 0:
            Text("Colour theme")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            HStack(spacing: 0) {
                themeChip("System", selected: false)
                themeChip("Light", selected: false)
                themeChip("Dark", selected: true)
            }
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DesignTokens.Color.backgroundElevated)
            )

            Divider()
                .background(DesignTokens.Color.borderDefault.opacity(0.35))
                .padding(.vertical, 8)

            Text("Home screen artwork")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("Show portrait covers instead of wide media thumbnails on the home screen.")
                .font(.system(size: 14))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(maxWidth: 420, alignment: .leading)
            HStack(spacing: 0) {
                themeChip("Thumbnails", selected: true)
                themeChip("Covers", selected: false)
            }
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DesignTokens.Color.backgroundElevated)
            )
        case 4:
            Text("Playarr Server")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            TextField("Server address", text: $environment.serverAddress)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(DesignTokens.Spacing.md)
                .frame(maxWidth: 520)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(DesignTokens.Color.backgroundElevated)
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
                Text(serverError)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.stateError)
            }
            pairingContent
        default:
            Text(sections[selectedSection].title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text(sections[selectedSection].description)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: 480, alignment: .leading)
        }
    }

    private func themeChip(_ label: String, selected: Bool) -> some View {
        // SPA segmented chips: compact, selected = white fill / dark label.
        Text(label)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(selected ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textSecondary)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(selected ? DesignTokens.Color.textPrimary : Color.clear)
            )
    }

    @ViewBuilder
    private var pairingContent: some View {
        switch environment.pairingState {
        case .signedOut:
            TVPrimaryButton(label: "Pair this Apple TV") { beginPairing() }
        case .requestingCode:
            ProgressView("Requesting a pairing code…")
                .tint(DesignTokens.Color.brandPrimary)
        case .awaitingApproval(let pending):
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                Text(pending.verificationUri)
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(pending.userCode)
                    .font(.system(size: 42, weight: .bold, design: .monospaced))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Button("Cancel pairing", role: .cancel) {
                    pairingTask?.cancel()
                    pairingTask = nil
                    environment.signOut()
                }
                .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        case .signedIn:
            Label("Paired", systemImage: "checkmark.circle.fill")
                .foregroundStyle(DesignTokens.Color.stateSuccess)
            Button("Sign out", role: .destructive) { environment.signOut() }
                .foregroundStyle(DesignTokens.Color.stateError)
        case .failed(let message):
            Text(message).foregroundStyle(DesignTokens.Color.stateError)
            TVPrimaryButton(label: "Try pairing again") { beginPairing() }
        }
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}
