import StreamarrKit
import SwiftUI
import UIKit

struct LoginView: View {
    let environment: AppEnvironment

    @State private var serverURL: String
    @State private var username = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case server, username, password }

    init(environment: AppEnvironment) {
        self.environment = environment
        _serverURL = State(initialValue: environment.serverBaseURL.absoluteString)
    }

    var body: some View {
        ZStack {
            PlayarrStyle.background.ignoresSafeArea()

            Circle()
                .fill(PlayarrStyle.pink.opacity(0.13))
                .frame(width: 440, height: 440)
                .blur(radius: 70)
                .offset(x: 170, y: -310)

            ScrollView {
                VStack(spacing: 0) {
                    PlayarrLogo(size: 48)
                        .padding(.top, 18)

                    Spacer(minLength: 56)

                    VStack(spacing: 12) {
                        Text("Welcome back")
                            .font(.system(size: 48, weight: .medium, design: .rounded))
                            .tracking(-2.4)
                            .foregroundStyle(PlayarrStyle.ink)
                            .multilineTextAlignment(.center)

                        Text("Connect directly to your Streamarr server and continue watching.")
                            .font(.subheadline)
                            .foregroundStyle(PlayarrStyle.inkSoft)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 390)
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        loginField(
                            title: "Server URL",
                            placeholder: "http://192.168.1.20:8484",
                            text: $serverURL,
                            field: .server,
                            contentType: .URL,
                            submitLabel: .next
                        )
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                        loginField(
                            title: "Username",
                            placeholder: "Your username",
                            text: $username,
                            field: .username,
                            contentType: .username,
                            submitLabel: .next
                        )
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Password")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(PlayarrStyle.inkSoft)
                            SecureField("Your password", text: $password)
                                .textContentType(.password)
                                .focused($focusedField, equals: .password)
                                .submitLabel(.go)
                                .onSubmit { submit() }
                                .playarrInputStyle(hasError: errorMessage != nil)
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(PlayarrStyle.pink)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Button(action: submit) {
                            HStack(spacing: 10) {
                                if isSubmitting { ProgressView().tint(.white) }
                                Text(isSubmitting ? "Signing in…" : "Sign in")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PlayarrPrimaryButtonStyle())
                        .disabled(isSubmitting || serverURL.isEmpty || username.isEmpty || password.isEmpty)
                        .opacity(serverURL.isEmpty || username.isEmpty || password.isEmpty ? 0.48 : 1)

                        Text("Your Streamarr server stays on your network. Playarr connects to the address above directly.")
                            .font(.caption)
                            .foregroundStyle(PlayarrStyle.muted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(24)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 30, style: .continuous)
                            .stroke(.white.opacity(0.7), lineWidth: 1)
                    }
                    .shadow(color: PlayarrStyle.ink.opacity(0.08), radius: 36, y: 18)
                    .frame(maxWidth: 520)
                    .padding(.top, 34)

                    Spacer(minLength: 50)
                }
                .frame(maxWidth: .infinity, minHeight: UIScreen.main.bounds.height - 40)
                .padding(.horizontal, 18)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .tint(PlayarrStyle.pink)
    }

    private func loginField(
        title: String,
        placeholder: String,
        text: Binding<String>,
        field: Field,
        contentType: UITextContentType?,
        submitLabel: SubmitLabel
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(PlayarrStyle.inkSoft)
            TextField(placeholder, text: text)
                .textContentType(contentType)
                .focused($focusedField, equals: field)
                .submitLabel(submitLabel)
                .onSubmit {
                    focusedField = field == .server ? .username : .password
                }
                .playarrInputStyle()
        }
    }

    private func submit() {
        guard !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                try await environment.signIn(
                    serverURL: serverURL,
                    username: username,
                    password: password
                )
            } catch let error as APIError {
                errorMessage = error.displayMessage
            } catch {
                errorMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}

private extension View {
    func playarrInputStyle(hasError: Bool = false) -> some View {
        self
            .font(.body)
            .foregroundStyle(PlayarrStyle.ink)
            .padding(.horizontal, 16)
            .frame(height: 54)
            .background(PlayarrStyle.surface.opacity(0.82), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(hasError ? PlayarrStyle.pink : PlayarrStyle.ink.opacity(0.12), lineWidth: 1)
            }
    }
}
