import PhotosUI
import PlayarrKit
import SwiftUI
import UIKit

struct SettingsView: View {
    private enum Section: String, CaseIterable, Identifiable {
        case appearance, avatar, language, player, server, lock, invite, data
        var id: String { rawValue }
        var number: String { String(format: "%02d", Self.allCases.firstIndex(of: self)! + 1) }
        var title: String {
            switch self {
            case .appearance: "Appearance"
            case .avatar: "Profile avatar"
            case .language: "Language"
            case .player: "Player"
            case .server: "Server connection"
            case .lock: "Profile lock"
            case .invite: "Invite a friend"
            case .data: "Your data"
            }
        }
        var description: String {
            switch self {
            case .appearance: "Choose this device's theme and home screen artwork."
            case .avatar: "Choose how your profile appears on this device."
            case .language: "Follow this device or keep a language fixed."
            case .player: "Choose how Playarr should start quality, subtitles and audio."
            case .server: "Combine libraries from multiple servers in one Playarr interface."
            case .lock: "Require a four-digit PIN before switching profiles."
            case .invite: "Ask your Playarr Server admin for one friend-invite QR code."
            case .data: "Export your watch progress, playlists and preferences, or import them from another Playarr Server."
            }
        }
        var icon: String {
            switch self {
            case .appearance: "circle.lefthalf.filled"
            case .avatar: "person.crop.circle"
            case .language: "globe"
            case .player: "play.rectangle"
            case .server: "server.rack"
            case .lock: "lock"
            case .invite: "person.badge.plus"
            case .data: "square.and.arrow.up.on.square"
            }
        }
    }

    private struct AvatarPreset: Identifiable {
        let id: String
        let symbol: String
        let colours: [Color]
    }

    let environment: AppEnvironment
    @AppStorage("com.playarr.ios.appearance") private var appearance = "system"
    @AppStorage("com.playarr.ios.language") private var language = "en"
    @AppStorage(NativePlayerDefaults.qualityKey) private var qualityID = "original"
    @AppStorage(NativePlayerDefaults.subtitleModeKey) private var subtitleMode = "off"
    @AppStorage(NativePlayerDefaults.subtitleLanguageKey) private var subtitleLanguage = "en"
    @AppStorage(NativePlayerDefaults.audioLanguageKey) private var audioLanguage = "en"

    @Environment(\.playarrGoHome) private var goHome
    @State private var selected: Section?
    @State private var serverURL: String
    @State private var avatar: ProfileAvatarPreference?
    @State private var photoItem: PhotosPickerItem?
    @State private var pinLocked = false
    @State private var pin = ""
    @State private var inviteRequest: UserInviteRequest?
    @State private var inviteMessage = ""
    @State private var inviteLink: URL?
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var busy = false
    @State private var signingOut = false

    init(environment: AppEnvironment) {
        self.environment = environment
        _serverURL = State(initialValue: environment.serverBaseURL.absoluteString)
    }

    var body: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack {
                if phone && selected == nil { WM.page } else { settingsBackground }
                if phone { phoneLayout(safeTop: proxy.safeAreaInsets.top) }
                else { wideLayout(proxy: proxy) }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .ignoresSafeArea()
        .navigationBarHidden(true)
        .task { await loadRemoteSettings() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await saveCustomAvatar(from: item) }
        }
        .alert("Playarr", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK") { errorMessage = nil } } message: { Text(errorMessage ?? "") }
    }

    private var settingsBackground: some View {
        ZStack {
            LinearGradient(colors: [PlayarrStyle.surface, PlayarrStyle.background], startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [PlayarrStyle.pink.opacity(0.12), .clear], center: UnitPoint(x: 0.2, y: 0.4), startRadius: 0, endRadius: 420)
        }
    }

    /// Web mobile "Preferences" index: back arrow, title and numbered rows of 88pt.
    private var phoneIndex: some View {
        ZStack(alignment: .topLeading) {
            Button { goHome() } label: {
                Text("←")
                    .font(WM.font(12.8, 720))
                    .foregroundStyle(WM.shell)
                    .frame(width: 44, height: 40)
                    .background(WM.ink, in: Ellipse())
            }
            .buttonStyle(.plain)
            .offset(x: 15, y: WM.topInset + 1)
            WMText("Preferences", 21.6, 580, lh: 32.4, ls: -0.972)
                .offset(x: 68, y: WM.topInset + 5)
            VStack(spacing: 0) {
                ForEach(Array(Section.allCases.enumerated()), id: \.element.id) { index, section in
                    Button { selected = section } label: {
                        ZStack(alignment: .topLeading) {
                            if index == 0 { WM.artFill }
                            WMText(section.number, 8.96, 760, color: WM.muted, lh: 13.44).offset(x: 12, y: 16)
                            WMText(section.title, 16, 480, lh: 18.4, ls: -0.56)
                                .frame(width: 257, alignment: .leading)
                                .offset(x: 56, y: 25)
                            Text(section.description)
                                .font(WM.font(10.88))
                                .foregroundStyle(WM.muted)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .frame(width: 257, height: 15.776, alignment: .leading)
                                .offset(x: 56, y: 47)
                            Text("→")
                                .font(WM.font(20.8))
                                .foregroundStyle(index == 0 ? WM.ink : WM.muted)
                                .offset(x: index == 0 ? 330 : 325, y: 28)
                        }
                        .frame(width: 358, height: 88, alignment: .topLeading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.leading, 16)
            .padding(.top, 84)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func phoneLayout(safeTop: CGFloat) -> some View {
        if selected == nil {
            phoneIndex
        } else {
            phoneDetailLayout(safeTop: safeTop)
        }
    }

    private func phoneDetailLayout(safeTop: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if selected != nil {
                    Button { selected = nil } label: {
                        Image(systemName: "chevron.left").frame(width: 42, height: 42)
                    }
                }
                Text(selected?.title ?? "Settings")
                    .font(.custom("Avenir Next", fixedSize: 23).weight(.semibold))
                    .tracking(-1)
                Spacer()
            }
            .foregroundStyle(PlayarrStyle.ink)
            .padding(.horizontal, 16)
            .padding(.top, max(56, safeTop + 6))
            .padding(.bottom, 12)

            if let selected {
                ScrollView { detail(for: selected).padding(16).padding(.bottom, 120) }
                    .scrollIndicators(.hidden)
            } else {
                ScrollView { sectionList.padding(.horizontal, 16).padding(.bottom, 120) }
                    .scrollIndicators(.hidden)
            }
        }
        .onAppear { selected = nil }
    }

    private func wideLayout(proxy: GeometryProxy) -> some View {
        HStack(spacing: 0) {
            profileFeature
                .frame(width: proxy.size.width * 0.35, height: proxy.size.height)
            HStack(spacing: 0) {
                ScrollView { sectionList.padding(.horizontal, 24).padding(.vertical, 88) }
                    .frame(width: proxy.size.width * 0.24)
                    .scrollIndicators(.hidden)
                ScrollView {
                    detail(for: selected ?? .appearance)
                        .padding(.horizontal, 32)
                        .padding(.top, 94)
                        .padding(.bottom, 70)
                }
                .scrollIndicators(.hidden)
                .frame(maxWidth: .infinity)
            }
            .background(PlayarrStyle.surface.opacity(0.9))
        }
    }

    private var profileFeature: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            avatarView(size: 88)
            Text(environment.currentUserName ?? "Playarr viewer")
                .font(.custom("Avenir Next", fixedSize: 34).weight(.semibold))
                .tracking(-2)
                .foregroundStyle(PlayarrStyle.ink)
            Text(environment.serverBaseURL.host ?? environment.serverBaseURL.absoluteString)
                .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
                .foregroundStyle(PlayarrStyle.muted)
            Spacer()
        }
        .padding(.horizontal, 42)
    }

    private var sectionList: some View {
        LazyVStack(spacing: 0) {
            ForEach(Section.allCases) { section in
                Button { selected = section } label: {
                    HStack(spacing: 14) {
                        Text(section.number)
                            .font(.caption2.monospacedDigit().weight(.bold))
                            .foregroundStyle(selected == section ? PlayarrStyle.pink : PlayarrStyle.muted)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(section.title).font(.subheadline.weight(.semibold))
                            Text(section.description).font(.caption2).foregroundStyle(PlayarrStyle.muted).lineLimit(2)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(PlayarrStyle.muted)
                    }
                    .foregroundStyle(PlayarrStyle.ink)
                    .padding(.vertical, 17)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider().overlay(PlayarrStyle.line)
            }
        }
    }

    @ViewBuilder
    private func detail(for section: Section) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            if let statusMessage {
                Label(statusMessage, systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PlayarrStyle.pink)
            }
            switch section {
            case .appearance: appearanceContent
            case .avatar: avatarContent
            case .language: languageContent
            case .player: playerContent
            case .server: serverContent
            case .lock: lockContent
            case .invite: inviteContent
            case .data: YourDataView(transport: environment.apiClient)
            }
        }
        .frame(maxWidth: 620, alignment: .leading)
    }

    private var appearanceContent: some View {
        settingsCard(title: "Theme", description: "Match the system or choose a fixed appearance.") {
            Picker("Appearance", selection: $appearance) {
                Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
            }
            .pickerStyle(.segmented)
        }
    }

    private var avatarContent: some View {
        settingsCard(title: "Profile avatar", description: "Your choice is shared with Playarr on every device.") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 14)], spacing: 14) {
                ForEach(Self.avatarPresets) { preset in
                    Button { saveAvatar(ProfileAvatarPreference(kind: .preset, value: preset.id)) } label: {
                        ZStack {
                            Circle().fill(LinearGradient(colors: preset.colours, startPoint: .topLeading, endPoint: .bottomTrailing))
                            Image(systemName: preset.symbol).font(.system(size: 30, weight: .light)).foregroundStyle(.white)
                        }
                        .frame(width: 72, height: 72)
                        .overlay { Circle().stroke(avatar?.value == preset.id ? PlayarrStyle.pink : PlayarrStyle.lineStrong, lineWidth: avatar?.value == preset.id ? 4 : 1).padding(avatar?.value == preset.id ? -4 : 0) }
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                }
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(avatar?.kind == .custom ? "Replace photo" : "Use a photo", systemImage: "photo.badge.plus")
            }
            .buttonStyle(.bordered)
            .tint(PlayarrStyle.inkSoft)
        }
    }

    private var languageContent: some View {
        settingsCard(title: "Language", description: "Used for Playarr labels and preferred metadata when available.") {
            Picker("Language", selection: $language) { languageOptions }
                .pickerStyle(.menu)
                .tint(PlayarrStyle.ink)
        }
    }

    private var playerContent: some View {
        settingsCard(title: "Playback defaults", description: "Applied when a title has no remembered per-title choice.") {
            settingPicker("Quality", selection: $qualityID) {
                Text("Original · Best source").tag("original")
                Text("1080p · Up to 8 Mbps").tag("h264-1080p-8mbps")
                Text("720p · Up to 4 Mbps").tag("h264-720p-4mbps")
                Text("480p · Up to 2 Mbps").tag("h264-480p-2mbps")
            }
            settingPicker("Subtitles", selection: $subtitleMode) {
                Text("Off").tag("off"); Text("Forced only").tag("forced"); Text("Always").tag("always")
            }
            if subtitleMode != "off" { settingPicker("Subtitle language", selection: $subtitleLanguage) { languageOptions } }
            settingPicker("Audio language", selection: $audioLanguage) { languageOptions }
                .onChange(of: audioLanguage) { _, value in savePlayerLanguage(value) }
        }
    }

    private var serverContent: some View {
        settingsCard(title: "Connected server", description: "Changing server signs this device out. Connections stay direct.") {
            TextField("Server URL", text: $serverURL)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                .padding(.horizontal, 14).frame(height: 50)
                .background(PlayarrStyle.background.opacity(0.6))
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
            Button("Save server") { saveServer() }.buttonStyle(PlayarrPrimaryButtonStyle())
            signOutButton
        }
    }

    private var lockContent: some View {
        settingsCard(title: "Profile lock", description: pinLocked ? "This profile is protected." : "Anyone with access to this server can switch to this profile.") {
            SecureField("Four-digit PIN", text: $pin)
                .keyboardType(.numberPad)
                .onChange(of: pin) { _, value in pin = String(value.filter(\.isNumber).prefix(4)) }
                .padding(.horizontal, 14).frame(height: 50)
                .background(PlayarrStyle.background.opacity(0.6))
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
            Button(pinLocked ? "Replace PIN" : "Set PIN") { savePin(pin) }
                .buttonStyle(PlayarrPrimaryButtonStyle()).disabled(pin.count != 4 || busy)
            if pinLocked { Button("Remove PIN", role: .destructive) { savePin(nil) } }
        }
    }

    private var inviteContent: some View {
        settingsCard(title: "Invite a friend", description: "Ask an administrator for one invitation. It expires 24 hours after generation.") {
            if let inviteLink {
                Text(inviteLink.absoluteString).font(.caption.monospaced()).textSelection(.enabled)
                ShareLink(item: inviteLink) { Label("Share invitation", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            } else if inviteRequest?.status == .approved {
                Button("Generate invitation") { generateInvite() }.buttonStyle(PlayarrPrimaryButtonStyle()).disabled(busy)
            } else if let request = inviteRequest {
                Label(request.status.rawValue.capitalized, systemImage: request.status == .pending ? "clock" : "info.circle")
                    .foregroundStyle(PlayarrStyle.inkSoft)
            } else {
                TextField("Who is the invitation for? (optional)", text: $inviteMessage, axis: .vertical)
                    .lineLimit(3...5).padding(14)
                    .background(PlayarrStyle.background.opacity(0.6))
                    .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                Button("Request invitation") { requestInvite() }.buttonStyle(PlayarrPrimaryButtonStyle()).disabled(busy)
            }
        }
    }

    private var signOutButton: some View {
        Button(role: .destructive) {
            signingOut = true
            Task { try? await environment.signOut(); signingOut = false }
        } label: { Label(signingOut ? "Signing out…" : "Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
            .disabled(signingOut)
    }

    private func settingsCard<Content: View>(title: String, description: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 17) {
            Text(title).font(.title2.weight(.semibold)).foregroundStyle(PlayarrStyle.ink)
            Text(description).font(.caption).foregroundStyle(PlayarrStyle.muted).lineSpacing(3)
            Divider().overlay(PlayarrStyle.line)
            content()
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.surfaceStrong.opacity(0.7))
        .overlay { Rectangle().stroke(PlayarrStyle.line, lineWidth: 1) }
    }

    private func settingPicker<Content: View>(_ label: String, selection: Binding<String>, @ViewBuilder content: () -> Content) -> some View {
        HStack { Text(label).foregroundStyle(PlayarrStyle.ink); Spacer(); Picker(label, selection: selection, content: content).labelsHidden().pickerStyle(.menu).tint(PlayarrStyle.inkSoft) }
            .font(.subheadline).padding(.vertical, 5)
    }

    @ViewBuilder private var languageOptions: some View {
        Text("English").tag("en"); Text("Spanish").tag("es"); Text("French").tag("fr"); Text("German").tag("de")
        Text("Italian").tag("it"); Text("Portuguese").tag("pt"); Text("Japanese").tag("ja"); Text("Korean").tag("ko")
        Text("Chinese").tag("zh"); Text("Hindi").tag("hi"); Text("Arabic").tag("ar"); Text("Thai").tag("th")
    }

    @ViewBuilder private func avatarView(size: CGFloat) -> some View {
        PlayarrProfileAvatar(
            preference: avatar ?? environment.currentAvatar,
            userID: environment.currentUserID,
            userName: environment.currentUserName,
            size: size
        )
    }

    private func loadRemoteSettings() async {
        async let remoteAvatar = try? environment.apiClient.getProfileAvatar()
        async let remotePin = try? environment.apiClient.getProfilePinSetting()
        async let remotePlayer = try? environment.apiClient.getPlayerPreferences()
        async let remoteInvite = try? environment.apiClient.getMyUserInviteRequest()
        avatar = await remoteAvatar?.preference ?? environment.currentAvatar
        pinLocked = await remotePin?.pinLocked ?? false
        if let preferred = await remotePlayer?.preferredAudioLanguage { audioLanguage = preferred }
        inviteRequest = await remoteInvite ?? nil
    }

    private func saveAvatar(_ preference: ProfileAvatarPreference) {
        Task { await persistAvatar(preference) }
    }

    private func persistAvatar(_ preference: ProfileAvatarPreference) async {
        busy = true
        defer { busy = false }
        let previous = avatar
        avatar = preference
        do {
            avatar = try await environment.updateCurrentAvatar(preference)
            statusMessage = "Avatar saved"
        } catch {
            avatar = previous
            show(error)
        }
    }

    private func saveCustomAvatar(from item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = Self.squareJPEG(image) else { throw APIError.invalidResponse }
            await persistAvatar(ProfileAvatarPreference(kind: .custom, value: "data:image/jpeg;base64,\(jpeg.base64EncodedString())"))
        } catch { show(error) }
    }

    private func savePlayerLanguage(_ value: String) {
        Task {
            do { _ = try await environment.apiClient.updatePlayerPreferences(PlayerPreferences(preferredAudioLanguage: value)); statusMessage = "Player defaults saved" }
            catch { show(error) }
        }
    }

    private func savePin(_ value: String?) {
        busy = true
        Task {
            do {
                let setting = try await environment.apiClient.updateProfilePinSetting(UpdateProfilePinRequest(pin: value))
                pinLocked = setting.pinLocked; pin = ""; statusMessage = value == nil ? "Profile lock removed" : "Profile lock saved"
            } catch { show(error) }
            busy = false
        }
    }

    private func requestInvite() {
        busy = true
        Task {
            do {
                inviteRequest = try await environment.apiClient.createUserInviteRequest(CreateUserInviteRequest(message: inviteMessage.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty))
                inviteMessage = ""; statusMessage = "Invitation request sent"
            } catch { show(error) }
            busy = false
        }
    }

    private func generateInvite() {
        busy = true
        Task {
            do {
                let invite = try await environment.apiClient.generateApprovedUserInvite()
                var components = URLComponents(string: "https://playarr.app/signup")!
                components.queryItems = [URLQueryItem(name: "server", value: environment.serverBaseURL.absoluteString), URLQueryItem(name: "invite", value: invite.inviteToken)]
                inviteLink = components.url; statusMessage = "Invitation generated"
            } catch { show(error) }
            busy = false
        }
    }

    private func saveServer() {
        do {
            let corrected = try LoginServerURL.normalise(serverURL)
            serverURL = corrected.absoluteString; environment.serverBaseURL = corrected
        } catch { errorMessage = "Enter a valid HTTP or HTTPS server URL." }
    }

    private func show(_ error: Error) {
        errorMessage = (error as? APIError)?.displayMessage ?? error.localizedDescription
    }

    private static func squareJPEG(_ image: UIImage) -> Data? {
        let side = min(image.size.width, image.size.height)
        let origin = CGPoint(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2)
        guard let cg = image.cgImage?.cropping(to: CGRect(origin: origin, size: CGSize(width: side, height: side))) else { return nil }
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 512, height: 512))
        return renderer.image { _ in UIImage(cgImage: cg, scale: 1, orientation: image.imageOrientation).draw(in: CGRect(x: 0, y: 0, width: 512, height: 512)) }.jpegData(compressionQuality: 0.82)
    }

    private static let avatarPresets: [AvatarPreset] = [
        .init(id: "astronaut", symbol: "moon.stars", colours: [Color(hex: 0x5267AD), Color(hex: 0x222D5F)]),
        .init(id: "cat", symbol: "cat", colours: [Color(hex: 0xE37C68), Color(hex: 0x9C3F66)]),
        .init(id: "dinosaur", symbol: "fossil.shell", colours: [Color(hex: 0x55A46E), Color(hex: 0x237265)]),
        .init(id: "robot", symbol: "cpu", colours: [Color(hex: 0x5D9CAF), Color(hex: 0x365383)]),
        .init(id: "pirate", symbol: "sailboat", colours: [Color(hex: 0xD39A48), Color(hex: 0x91464C)]),
        .init(id: "alien", symbol: "sparkles", colours: [Color(hex: 0x8B71C5), Color(hex: 0x4A477F)]),
    ]
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private extension Color {
    init(hex: Int) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}
