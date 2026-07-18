import SwiftUI

struct SettingsView: View {
    let environment: AppEnvironment

    @AppStorage("com.streamarr.ios.appearance") private var appearance = "dark"
    @AppStorage(NativePlayerDefaults.qualityKey) private var qualityID = "original"
    @AppStorage(NativePlayerDefaults.subtitleModeKey) private var subtitleMode = "off"
    @AppStorage(NativePlayerDefaults.subtitleLanguageKey) private var subtitleLanguage = "en"
    @AppStorage(NativePlayerDefaults.audioLanguageKey) private var audioLanguage = "en"
    @State private var serverURL: String
    @State private var errorMessage: String?
    @State private var signingOut = false

    init(environment: AppEnvironment) {
        self.environment = environment
        _serverURL = State(initialValue: environment.serverBaseURL.absoluteString)
    }

    var body: some View {
        GeometryReader { proxy in
            let phone = proxy.size.width <= 760
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    colors: [PlayarrStyle.surface, PlayarrStyle.background],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [PlayarrStyle.pink.opacity(0.1), .clear],
                    center: UnitPoint(x: phone ? 0.5 : 0.25, y: 0.38),
                    startRadius: 0,
                    endRadius: 360
                )

                if !phone {
                    profileHeader
                        .padding(.leading, max(102, proxy.size.width * 0.08))
                        .padding(.top, proxy.size.height * 0.25)
                        .zIndex(2)
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: phone ? 22 : 30) {
                        if phone { profileHeader }

                        settingsCard(title: "Appearance", icon: "circle.lefthalf.filled") {
                            Picker("Appearance", selection: $appearance) {
                                Text("System").tag("system")
                                Text("Light").tag("light")
                                Text("Dark").tag("dark")
                            }
                            .pickerStyle(.segmented)
                        }

                        settingsCard(title: "Server", icon: "server.rack") {
                            TextField("Server URL", text: $serverURL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .padding(.horizontal, 14)
                                .frame(height: 50)
                                .background(PlayarrStyle.surfaceStrong.opacity(0.64))
                                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }

                            Button("Save server") { saveServer() }
                                .buttonStyle(PlayarrPrimaryButtonStyle())

                            Text("Changing server returns you to sign-in. The connection remains direct from this device to your Streamarr server.")
                                .font(.custom("Avenir Next", fixedSize: 10.5))
                                .foregroundStyle(PlayarrStyle.muted)
                                .lineSpacing(4)
                        }

                        settingsCard(title: "Playback", icon: "play.rectangle") {
                            settingPicker("Quality", selection: $qualityID) {
                                Text("Original · Best available source").tag("original")
                                Text("1080p · Up to 8 Mbps").tag("h264-1080p-8mbps")
                                Text("720p · Up to 4 Mbps").tag("h264-720p-4mbps")
                                Text("480p · Up to 2 Mbps").tag("h264-480p-2mbps")
                            }

                            settingPicker("Subtitles", selection: $subtitleMode) {
                                Text("Off").tag("off")
                                Text("Forced only").tag("forced")
                                Text("Always").tag("always")
                            }

                            if subtitleMode != "off" {
                                settingPicker("Subtitle language", selection: $subtitleLanguage) {
                                    languageOptions
                                }
                            }

                            settingPicker("Audio language", selection: $audioLanguage) {
                                languageOptions
                            }

                            Text("These defaults are applied to the next title you play.")
                                .font(.custom("Avenir Next", fixedSize: 10.5))
                                .foregroundStyle(PlayarrStyle.muted)
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
                                .foregroundStyle(PlayarrStyle.danger)
                        }

                        Button(role: .destructive) {
                            signingOut = true
                            Task {
                                try? await environment.signOut()
                                signingOut = false
                            }
                        } label: {
                            HStack {
                                if signingOut { ProgressView() }
                                Text("Sign out")
                            }
                            .font(.custom("Avenir Next", fixedSize: 12).weight(.bold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(PlayarrStyle.danger)
                        .overlay { Capsule().stroke(PlayarrStyle.danger.opacity(0.52), lineWidth: 1) }
                    }
                    .padding(.horizontal, phone ? 16 : max(28, proxy.size.width * 0.028))
                    .padding(.top, phone ? 92 : max(128, proxy.size.height * 0.15))
                    .padding(.bottom, phone ? 118 : 70)
                }
                .frame(width: phone ? proxy.size.width : proxy.size.width * 0.65, height: proxy.size.height)
                .offset(x: phone ? 0 : proxy.size.width * 0.35)
                .scrollIndicators(.hidden)
                .background {
                    if !phone {
                        LinearGradient(
                            colors: [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                }
                .zIndex(1)

                Text("Profile")
                    .font(.custom("Avenir Next", fixedSize: phone ? 22 : min(34, proxy.size.width * 0.0175)).weight(.medium))
                    .tracking(phone ? -1 : -1.5)
                    .foregroundStyle(PlayarrStyle.ink)
                    .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                    .padding(.top, phone ? max(56, proxy.safeAreaInsets.top + 6) : min(66, max(34, proxy.size.height * 0.052)))
                    .zIndex(3)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea()
        .navigationBarHidden(true)
    }

    private var profileHeader: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(PlayarrStyle.pink.gradient)
                Text(String((environment.currentUserName ?? "P").prefix(1)).uppercased())
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 64, height: 64)

            VStack(alignment: .leading, spacing: 4) {
                Text(environment.currentUserName ?? "Playarr viewer")
                    .font(.custom("Avenir Next", fixedSize: 24).weight(.semibold))
                    .tracking(-1)
                    .foregroundStyle(PlayarrStyle.ink)
                Text(environment.serverBaseURL.host ?? environment.serverBaseURL.absoluteString)
                    .font(.custom("Avenir Next", fixedSize: 10.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
            }
        }
    }

    private func settingsCard<Content: View>(
        title: String,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: icon)
                .font(.custom("Avenir Next", fixedSize: 14).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
            content()
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.surfaceStrong.opacity(0.68))
        .overlay { Rectangle().stroke(PlayarrStyle.line.opacity(0.72), lineWidth: 1) }
    }

    private func settingPicker<Content: View>(
        _ label: String,
        selection: Binding<String>,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .foregroundStyle(PlayarrStyle.ink)
            Spacer(minLength: 18)
            Picker(label, selection: selection, content: content)
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(PlayarrStyle.inkSoft)
        }
        .font(.custom("Avenir Next", fixedSize: 12))
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var languageOptions: some View {
        Text("English").tag("en")
        Text("Spanish").tag("es")
        Text("French").tag("fr")
        Text("German").tag("de")
        Text("Italian").tag("it")
        Text("Portuguese").tag("pt")
        Text("Japanese").tag("ja")
        Text("Korean").tag("ko")
        Text("Chinese").tag("zh")
        Text("Hindi").tag("hi")
        Text("Arabic").tag("ar")
        Text("Thai").tag("th")
    }

    private func saveServer() {
        do {
            let corrected = try LoginServerURL.normalise(serverURL)
            serverURL = corrected.absoluteString
            errorMessage = nil
            environment.serverBaseURL = corrected
        } catch {
            errorMessage = "Enter a valid HTTP or HTTPS server URL."
        }
    }
}
