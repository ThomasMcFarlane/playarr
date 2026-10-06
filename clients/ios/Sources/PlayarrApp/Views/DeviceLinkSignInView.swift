import PlayarrKit
import SwiftUI

/// Sheet shown from the login screen: a QR code, the short code and the link
/// to open on another device, with retry and cancel.
struct DeviceLinkSignInView: View {
    let environment: AppEnvironment
    @Binding var isPresented: Bool
    @State private var model: DeviceLinkSignInViewModel

    init(environment: AppEnvironment, isPresented: Binding<Bool>) {
        self.environment = environment
        _isPresented = isPresented
        _model = State(initialValue: DeviceLinkSignInViewModel(environment: environment))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    content
                }
                .frame(maxWidth: 420)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .background(PlayarrStyle.background.ignoresSafeArea())
            .navigationTitle("Sign in with a QR code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        model.cancel()
                        isPresented = false
                    }
                }
            }
        }
        .tint(PlayarrStyle.accent)
        .task { model.start() }
        .onDisappear { model.cancel() }
        .onChange(of: model.isComplete) { _, done in
            if done { isPresented = false }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .requestingCode:
            ProgressView("Requesting a code…")
                .padding(.top, 60)
        case .awaitingApproval(let prompt):
            Text("On another device, scan this code or open the link and approve the sign-in.")
                .font(.callout)
                .foregroundStyle(PlayarrStyle.inkSoft)
                .multilineTextAlignment(.center)
            QRCodeImage(text: prompt.verificationURIComplete)
                .frame(width: 240, height: 240)
            VStack(spacing: 6) {
                Text("Code").font(.caption.weight(.heavy)).foregroundStyle(PlayarrStyle.muted)
                Text(prompt.userCode)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced))
                    .foregroundStyle(PlayarrStyle.ink)
                    .textSelection(.enabled)
                Text(prompt.verificationURI)
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .textSelection(.enabled)
            }
            if let url = URL(string: prompt.verificationURIComplete) {
                ShareLink(item: url) {
                    Label("Share link", systemImage: "square.and.arrow.up")
                }
            }
            ProgressView("Waiting for approval…")
                .font(.footnote)
        case .finishing:
            ProgressView("Signing you in…")
                .padding(.top, 60)
        case .failed(let failure):
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundStyle(PlayarrStyle.danger)
            Text(failure.message)
                .font(.callout)
                .foregroundStyle(PlayarrStyle.danger)
                .multilineTextAlignment(.center)
            Button("Try again") { model.retry() }
                .buttonStyle(.borderedProminent)
        }
    }
}
