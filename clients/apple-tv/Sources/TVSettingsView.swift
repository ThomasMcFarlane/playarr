import SwiftUI

struct TVSettingsView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var serverError: String?
    @State private var pairingTask: Task<Void, Never>?

    var body: some View {
        @Bindable var environment = environment

        Form {
            Section("Streamarr server") {
                TextField("Server address", text: $environment.serverAddress)
                    .textContentType(.URL)
                    .autocorrectionDisabled()

                Button("Save server") {
                    serverError = environment.saveServerAddress()
                        ? nil
                        : "Enter a valid HTTP or HTTPS server address."
                }

                if let serverError {
                    Label(serverError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            Section("Account") {
                pairingContent
            }

            Section("About") {
                LabeledContent("App", value: "Playarr for Apple TV")
                LabeledContent("Server", value: environment.serverURL.absoluteString)
            }
        }
        .navigationTitle("Settings")
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
        }
    }

    @ViewBuilder
    private var pairingContent: some View {
        switch environment.pairingState {
        case .signedOut:
            Button("Pair this Apple TV") { beginPairing() }
        case .requestingCode:
            ProgressView("Requesting a pairing code…")
        case .awaitingApproval(let pending):
            VStack(alignment: .leading, spacing: 18) {
                Text("On your phone or computer, open")
                    .foregroundStyle(.secondary)
                Text(pending.verificationUri)
                    .font(.title2.bold())
                Text(pending.userCode)
                    .font(.system(size: 58, weight: .bold, design: .monospaced))
                    .accessibilityLabel("Pairing code \(pending.userCode)")
                ProgressView("Waiting for approval…")
                Button("Cancel pairing", role: .cancel) {
                    pairingTask?.cancel()
                    pairingTask = nil
                    environment.signOut()
                }
            }
            .padding(.vertical, 18)
        case .signedIn:
            Label("Paired", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
            Button("Sign out", role: .destructive) { environment.signOut() }
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
            Button("Try pairing again") { beginPairing() }
        }
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}
