import SwiftUI

struct SettingsView: View {
    let environment: AppEnvironment

    @AppStorage("com.streamarr.ios.appearance") private var appearance = "system"
    @State private var serverURL: String
    @State private var errorMessage: String?
    @State private var signingOut = false

    init(environment: AppEnvironment) {
        self.environment = environment
        _serverURL = State(initialValue: environment.serverBaseURL.absoluteString)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                profileHeader
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
                        .background(PlayarrStyle.surface.opacity(0.82), in: RoundedRectangle(cornerRadius: 14))

                    Button("Save server") {
                        guard let url = URL(string: serverURL), url.scheme != nil, url.host != nil else {
                            errorMessage = "Enter a valid HTTP or HTTPS server URL."
                            return
                        }
                        errorMessage = nil
                        environment.serverBaseURL = url
                    }
                    .buttonStyle(PlayarrPrimaryButtonStyle())

                    Text("Changing server returns you to sign-in. The connection remains direct from this device to your Streamarr server.")
                        .font(.caption)
                        .foregroundStyle(PlayarrStyle.muted)
                }

                settingsCard(title: "Playback", icon: "play.rectangle") {
                    settingRow("Quality", value: "Automatic")
                    settingRow("Direct play", value: "Preferred")
                    settingRow("Audio language", value: "Server default")
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(PlayarrStyle.pink)
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
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
            .frame(maxWidth: 760)
            .padding(.horizontal, 18)
            .padding(.top, 74)
            .padding(.bottom, 112)
            .frame(maxWidth: .infinity)
        }
        .background(PlayarrStyle.background)
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
                    .font(.title2.weight(.bold))
                    .foregroundStyle(PlayarrStyle.ink)
                Text(environment.serverBaseURL.host ?? environment.serverBaseURL.absoluteString)
                    .font(.caption)
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
                .font(.headline)
                .foregroundStyle(PlayarrStyle.ink)
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.surface.opacity(0.78), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func settingRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(PlayarrStyle.ink)
            Spacer()
            Text(value).foregroundStyle(PlayarrStyle.muted)
        }
        .font(.subheadline)
    }
}
