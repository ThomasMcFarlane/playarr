import StreamarrKit
import SwiftUI
import UIKit

struct LoginView: View {
    let environment: AppEnvironment
    var onBack: () -> Void = {}

    @State private var serverURL = ""
    @State private var username = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var languageMenuOpen = false
    @AppStorage("com.streamarr.ios.language") private var language = "system"
    @FocusState private var focusedField: Field?

    private enum Field { case server, username, password }

    var body: some View {
        GeometryReader { proxy in
            let phone = proxy.size.width <= 760
            let topPadding = phone
                ? max(14, proxy.safeAreaInsets.top) + 124
                : min(188, max(128, proxy.size.height * 0.18))
            let bottomPadding = phone
                ? 30 + proxy.safeAreaInsets.bottom
                : min(84, max(42, proxy.size.height * 0.07))

            ZStack(alignment: .topLeading) {
                PlayarrAuthBackground()

                ScrollView {
                    VStack {
                        Spacer(minLength: 0)
                        authPanel(width: proxy.size.width, phone: phone)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: max(0, proxy.size.height - topPadding - bottomPadding))
                    .padding(.top, topPadding)
                    .padding(.bottom, bottomPadding)
                    .padding(.horizontal, phone ? 22 : 24)
                }
                .scrollDismissesKeyboard(.interactively)

                stageChrome(proxy: proxy, phone: phone)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .tint(PlayarrStyle.accent)
    }

    private func authPanel(width: CGFloat, phone: Bool) -> some View {
        let titleSize = phone
            ? min(64, max(40, width * 0.13))
            : min(88, max(36.8, width * 0.042))
        let bodySize: CGFloat = phone ? 16 : 15
        let inputHeight: CGFloat = phone ? 52 : 48

        return VStack(spacing: 0) {
            Text("WELCOME HOME")
                .font(.custom("Avenir Next", fixedSize: 9.28).weight(.heavy))
                .tracking(1.6704)
                .foregroundStyle(PlayarrStyle.muted)
                .frame(height: 13.92)

            Text("Sign in to Playarr")
                .font(.custom("Avenir Next", fixedSize: titleSize).weight(.medium))
                .tracking(titleSize * -0.072)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.94)
                .frame(height: titleSize * 0.95)
                .padding(.top, 7.2)

            Text("Choose your Streamarr server, then save this profile on the current browser.")
                .font(.custom("Avenir Next", fixedSize: bodySize))
                .foregroundStyle(PlayarrStyle.muted)
                .multilineTextAlignment(.center)
                .lineSpacing(bodySize * 0.5)
                .frame(maxWidth: phone ? .infinity : 400)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 16)
                .padding(.bottom, 32)

            VStack(alignment: .leading, spacing: 0) {
                authLabel("Server URL")
                loginField(
                    placeholder: "Server address or URL",
                    text: $serverURL,
                    field: .server,
                    contentType: .URL,
                    height: inputHeight,
                    fontSize: bodySize
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)

                Text("Your browser connects directly to this server. Playarr does not proxy your login.")
                    .font(.custom("Avenir Next", fixedSize: 10.88))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineSpacing(5.44)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8.8)

                authLabel("Username")
                    .padding(.top, 19.2)
                loginField(
                    placeholder: "",
                    text: $username,
                    field: .username,
                    contentType: .username,
                    height: inputHeight,
                    fontSize: bodySize
                )
                .textInputAutocapitalization(.never)

                authLabel("Password")
                    .padding(.top, 19.2)
                SecureField("", text: $password)
                    .font(.custom("Avenir Next", fixedSize: bodySize))
                    .textContentType(.password)
                    .focused($focusedField, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .playarrWebInputStyle(
                        height: inputHeight,
                        focused: focusedField == .password,
                        error: errorMessage != nil
                    )

                if let errorMessage {
                    Text(errorMessage)
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                }

                Button(action: submit) {
                    HStack(spacing: 8) {
                        if isSubmitting {
                            ProgressView().tint(PlayarrStyle.onAccent).controlSize(.small)
                        }
                        Text(isSubmitting ? "Signing in…" : "Sign in")
                    }
                    .font(.custom("Avenir Next", fixedSize: 11.52).weight(.heavy))
                    .foregroundStyle(PlayarrStyle.onAccent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(PlayarrStyle.accent, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isSubmitting)
                .opacity(isSubmitting ? 0.45 : 1)
                .padding(.top, 24)
            }
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: 560)
        .multilineTextAlignment(.center)
    }

    private func authLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.custom("Avenir Next", fixedSize: 11.2).weight(.heavy))
            .tracking(0.896)
            .foregroundStyle(PlayarrStyle.muted)
            .frame(height: 16.8)
            .padding(.bottom, 7.2)
    }

    private func loginField(
        placeholder: String,
        text: Binding<String>,
        field: Field,
        contentType: UITextContentType?,
        height: CGFloat,
        fontSize: CGFloat
    ) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundStyle(PlayarrStyle.muted))
            .font(.custom("Avenir Next", fixedSize: fontSize))
            .multilineTextAlignment(.leading)
            .textContentType(contentType)
            .focused($focusedField, equals: field)
            .submitLabel(field == .server ? .next : .next)
            .onSubmit { focusedField = field == .server ? .username : .password }
            .playarrWebInputStyle(
                height: height,
                focused: focusedField == field || (field == .server && focusedField == nil),
                error: false
            )
    }

    private func stageChrome(proxy: GeometryProxy, phone: Bool) -> some View {
        let topInset = max(14, proxy.safeAreaInsets.top)
        let logoTop = phone ? topInset : min(66, max(34, proxy.size.height * 0.052))
        let languageTop = max(
            phone ? topInset : 0,
            min(58, max(30, proxy.size.height * 0.046))
        )
        let languageRight = phone ? 14 : min(44, max(18, proxy.size.width * 0.022))

        return ZStack(alignment: .topLeading) {
            Image("PlayarrLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 30, height: phone ? 42 : 38)
                .offset(x: phone ? 21 : 42.73, y: logoTop)
                .accessibilityHidden(true)

            Button(action: onBack) {
                Image(systemName: "arrow.left")
                    .font(.system(size: 12.8, weight: .regular))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .frame(width: phone ? 42 : 38, height: phone ? 42 : 38)
                    .background(PlayarrStyle.surfaceStrong.opacity(0.7), in: Circle())
                    .overlay { Circle().stroke(PlayarrStyle.line.opacity(1.3), lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .offset(x: phone ? 74 : 62.55, y: logoTop)
            .accessibilityLabel("Back")

            languagePicker
                .frame(width: 168)
                .offset(
                    x: proxy.size.width - languageRight - 168,
                    y: languageTop
                )
        }
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
    }

    private var languagePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { languageMenuOpen.toggle() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "globe")
                        .font(.system(size: 16, weight: .regular))
                        .foregroundStyle(PlayarrStyle.muted)
                    Text(languageLabel)
                        .font(.custom("Avenir Next", fixedSize: 11.52).weight(.heavy))
                        .foregroundStyle(PlayarrStyle.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(PlayarrStyle.muted)
                        .rotationEffect(.degrees(languageMenuOpen ? 180 : 0))
                }
                .padding(.horizontal, 18.4)
                .frame(width: 168, height: 48)
                .background(PlayarrStyle.background)
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
            }
            .buttonStyle(.plain)

            if languageMenuOpen {
                VStack(spacing: 0) {
                    languageOption("system", "Auto")
                    languageOption("en", "English")
                    languageOption("th", "ไทย")
                    languageOption("ja", "日本語")
                }
                .frame(width: 168)
                .background(PlayarrStyle.surfaceStrong)
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                .shadow(color: .black.opacity(0.18), radius: 24, y: 12)
            }
        }
    }

    private func languageOption(_ value: String, _ label: String) -> some View {
        Button {
            language = value
            languageMenuOpen = false
        } label: {
            HStack {
                Text(label)
                Spacer()
                if language == value { Image(systemName: "checkmark") }
            }
            .font(.custom("Avenir Next", fixedSize: 11.52).weight(.semibold))
            .foregroundStyle(PlayarrStyle.ink)
            .padding(.horizontal, 14)
            .frame(height: 42)
        }
        .buttonStyle(.plain)
    }

    private var languageLabel: String {
        switch language {
        case "en": "English"
        case "th": "ไทย"
        case "ja": "日本語"
        default: "Auto"
        }
    }

    private func submit() {
        guard !isSubmitting else { return }
        guard !serverURL.isEmpty, !username.isEmpty, !password.isEmpty else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                let correctedURL = try LoginServerURL.normalise(serverURL)
                serverURL = correctedURL.absoluteString
                try await environment.signIn(
                    serverURL: correctedURL.absoluteString,
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

private struct PlayarrAuthBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [PlayarrStyle.surface, PlayarrStyle.background],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [PlayarrStyle.pink.opacity(0.13), .clear],
                center: UnitPoint(x: 0.5, y: 0.48),
                startRadius: 0,
                endRadius: 290
            )
        }
        .ignoresSafeArea()
    }
}

private extension View {
    func playarrWebInputStyle(height: CGFloat, focused: Bool, error: Bool) -> some View {
        self
            .textFieldStyle(.plain)
            .foregroundStyle(PlayarrStyle.ink)
            .padding(.horizontal, 16)
            .frame(height: height)
            .background(focused ? PlayarrStyle.surfaceStrong : .clear)
            .overlay {
                Rectangle().stroke(
                    error ? PlayarrStyle.danger : focused ? PlayarrStyle.accent : PlayarrStyle.lineStrong,
                    lineWidth: 1
                )
            }
            .overlay {
                if focused {
                    Rectangle()
                        .stroke(PlayarrStyle.accent, lineWidth: 3)
                        .padding(-7)
                }
            }
            .scaleEffect(focused ? 1.015 : 1)
            .animation(.easeOut(duration: 0.18), value: focused)
    }
}
