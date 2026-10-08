import PhotosUI
import PlayarrKit
import SwiftUI
import UIKit

struct SettingsView: View {
    fileprivate enum Section: String, CaseIterable, Identifiable {
        case appearance, avatar, language, player, server, lock, invite, requestLatency, remote, data, home
        var id: String { rawValue }
        var number: String { String(format: "%02d", Self.allCases.firstIndex(of: self)! + 1) }
        var title: String {
            switch self {
            case .appearance: "Appearance"
            case .avatar: "Profile avatar"
            case .language: "Language"
            case .player: "Player"
            case .remote: "Phone remote"
            case .server: "Server connection"
            case .lock: "Profile lock"
            case .invite: "Invite a friend"
            case .requestLatency: "Request latency"
            case .data: "Your data"
            case .home: "Customise Home"
            }
        }
        var description: String {
            switch self {
            case .appearance: "Choose this device's theme and home screen artwork."
            case .avatar: "Choose how your profile appears on this device."
            case .language: "Follow this device or keep a language fixed."
            case .player: "Choose how Playarr should start quality, subtitles and audio."
            case .remote: "Control this device from your phone, or control another device."
            case .server: "Combine libraries from multiple servers in one Playarr interface."
            case .lock: "Require a four-digit PIN before switching profiles."
            case .invite: "Ask your Playarr Server admin for one friend-invite QR code."
            case .requestLatency: "Per-route HTTP request latency for admins."
            case .data: "Export your watch progress, playlists and preferences, or import them from another Playarr Server."
            case .home: "Show, hide and reorder the rails on Home."
            }
        }
        var icon: String {
            switch self {
            case .appearance: "circle.lefthalf.filled"
            case .avatar: "person.crop.circle"
            case .language: "globe"
            case .player: "play.rectangle"
            case .remote: "av.remote"
            case .server: "server.rack"
            case .lock: "lock"
            case .invite: "person.badge.plus"
            case .requestLatency: "speedometer"
            case .data: "square.and.arrow.up.on.square"
            case .home: "house"
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
    @AppStorage("com.playarr.ios.language") private var language = "system"
    @AppStorage(NativePlayerDefaults.qualityKey) private var qualityID = "original"
    @AppStorage(NativePlayerDefaults.subtitleModeKey) private var subtitleMode = "off"
    @AppStorage(NativePlayerDefaults.subtitleLanguageKey) private var subtitleLanguage = "en"
    @AppStorage(NativePlayerDefaults.audioLanguageKey) private var audioLanguage = "en"

    @Environment(\.playarrGoHome) private var goHome
    @State private var selected: Section? = SettingsView.initialSection
    @State private var serverURL: String
    @State private var avatar: ProfileAvatarPreference?
    @State private var photoItem: PhotosPickerItem?
    @State private var pinLocked = false
    @State private var pin = ""
    @State private var serverPassword = ""
    @State private var serverAddress = ""
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
            ScrollView(.vertical) {
                VStack(spacing: 0) {
                    ForEach(Array(Section.allCases.enumerated()), id: \.element.id) { index, section in
                        Button { selected = section } label: {
                            ZStack(alignment: .topLeading) {
                                if index == 0 { WM.artFill }
                                WMText(section.number, 8.96, 760, color: WM.muted, lh: 13.44).offset(x: 12, y: 15.4)
                                WMText(section.title, 16, 480, lh: 18.4, ls: -0.56)
                                    .frame(width: 257, alignment: .leading)
                                    .offset(x: 56, y: 24.4)
                                Text(section.description)
                                    .font(WM.font(10.88))
                                    .foregroundStyle(WM.muted)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                    .frame(width: 257, height: 15.776, alignment: .leading)
                                    .offset(x: 56, y: 46.4)
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
                .padding(.bottom, 130)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.hidden)
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

    @ViewBuilder
    private func phoneDetailLayout(safeTop: CGFloat) -> some View {
        if let selected {
            phonePanel(selected)
        }
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
            case .remote: remoteContent
            case .server: serverContent
            case .lock: lockContent
            case .invite: inviteContent
            case .requestLatency: RequestLatencyView(transport: environment.apiClient)
            case .data: YourDataView(transport: environment.apiClient)
            case .home: HomeCustomiseView(apiClient: environment.apiClient)
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

    private var remoteContent: some View {
        settingsCard(title: "Phone remote", description: "Control this device from your phone, or control another device.") {
            RemoteControllerView(apiClient: environment.apiClient)
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

    /// Adding a second server needs the multi-server list; until then the address field only
    /// replaces the connected server when it holds a valid address.
    private func connectServer() {
        guard !serverAddress.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        serverURL = serverAddress
        saveServer()
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

// MARK: - Web mobile panels

extension SettingsView {
    /// Debug-only deep link used by the parity capture (`settings:<panel>`).
    fileprivate static var initialSection: Section? {
        #if DEBUG
        switch ParityLaunch.panel {
        case "avatar": return .avatar
        case "language": return .language
        case "player": return .player
        case "server": return .server
        case "lock": return .lock
        case "invite": return .invite
        case "remote": return .remote
        case "latency": return .requestLatency
        case "your-data": return .data
        case "home": return .home
        default: return nil
        }
        #else
        return nil
        #endif
    }

    @ViewBuilder
    fileprivate func phonePanel(_ section: Section) -> some View {
        switch section {
        case .avatar: avatarPanel(section)
        case .language: languagePanel(section)
        case .player: playerPanel(section)
        case .server: serverPanel(section)
        case .lock: lockPanel(section)
        case .invite: invitePanel(section)
        case .remote: remotePanel(section)
        case .requestLatency:
            WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
                RequestLatencyView(transport: environment.apiClient, webStyle: true)
                    .offset(x: 36, y: 108)
            }
        case .data:
            WMPanelPage(kicker: section.title, subtitle: section.description, height: 1000, onBack: { selected = nil }) {
                YourDataView(transport: environment.apiClient, webStyle: true)
                    .offset(x: 36, y: 108)
            }
        case .home:
            HomeCustomiseView(apiClient: environment.apiClient)
        case .appearance:
            WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
                detail(for: section).padding(.horizontal, 36).padding(.top, 108)
            }
        }
    }

    private func panelH3(_ text: String, size: CGFloat = 18.72, weight: Int = 700, lh: CGFloat = 28, ls: CGFloat = 0) -> some View {
        WMText(text, size, weight, lh: lh, ls: ls).frame(width: 318, alignment: .leading)
    }

    private func panelLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(WM.font(11.2, 720))
            .tracking(0.896)
            .foregroundStyle(WM.muted)
            .lineLimit(1)
            .frame(width: 318, height: 17, alignment: .leading)
    }

    // Profile avatar

    private func avatarPanel(_ section: Section) -> some View {
        let current = (avatar ?? environment.currentAvatar)
        let selectedID = current?.kind == .custom ? nil : (current?.value ?? "astronaut")
        let columns: [CGFloat] = [36, 201]
        let rows: [CGFloat] = [108, 273, 438]
        return WMPanelPage(kicker: section.title, subtitle: section.description, height: 800, onBack: { selected = nil }) {
            ForEach(Array(Self.avatarPresets.enumerated()), id: \.element.id) { index, preset in
                let x = columns[index % 2], y = rows[index / 2]
                let isSelected = selectedID == preset.id
                Button { saveAvatar(ProfileAvatarPreference(kind: .preset, value: preset.id)) } label: {
                    ZStack {
                        if isSelected { Circle().stroke(WM.pink, lineWidth: 1).frame(width: 162, height: 162) }
                        WMAvatarPresetView(presetID: preset.id, size: isSelected ? 143 : 135)
                    }
                    .frame(width: isSelected ? 162 : 153, height: isSelected ? 162 : 153)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .offset(x: isSelected ? x - 4.6 : x, y: isSelected ? y - 4.6 : y)
            }
            ZStack {
                WMPanelButton(label: "Upload custom photo", primary: false, width: 158, height: 44)
                PhotosPicker(selection: $photoItem, matching: .images) { Color.clear.frame(width: 158, height: 44) }
            }
            .offset(x: 36, y: 611)
            WMPara(
                text: "JPEG, PNG or WebP up to 10 MB. Photos are cropped square and synced to your profile.",
                size: 16, weight: 400, lh: 24, width: 318, height: 72
            )
            .offset(x: 36, y: 669)
        }
    }

    // Language

    private func languagePanel(_ section: Section) -> some View {
        let detected = Locale(identifier: "en").localizedString(
            forLanguageCode: Locale.current.language.languageCode?.identifier ?? "en"
        ) ?? "English"
        let names: [(String, String)] = [
            ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"), ("it", "Italian"),
            ("pt", "Portuguese"), ("ja", "Japanese"), ("ko", "Korean"), ("zh", "Chinese"), ("hi", "Hindi"),
            ("ar", "Arabic"), ("th", "Thai"),
        ]
        let label = language == "system" ? "Auto" : (names.first { $0.0 == language }?.1 ?? "Auto")
        return WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
            Menu {
                Button("Auto") { language = "system" }
                ForEach(names, id: \.0) { code, name in Button(name) { language = code } }
            } label: {
                ZStack(alignment: .topLeading) {
                    Rectangle().fill(WM.shell)
                    Image(systemName: "globe").font(.system(size: 14)).foregroundStyle(WM.inkSoft).offset(x: 19, y: 15)
                    WMText(label, 11.52, 720, lh: 17).frame(width: 232, alignment: .leading).offset(x: 45, y: 15)
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(WM.muted)
                        .offset(x: 288, y: 18)
                }
                .frame(width: 318, height: 48, alignment: .topLeading)
                .overlay(Rectangle().stroke(WM.line.opacity(0.28), lineWidth: 1))
            }
            .offset(x: 36, y: 108)
            WMPara(
                text: "Playarr detected \(detected) from this device. Choose a language above to override it.",
                size: 12.48, weight: 400, lh: 18.5, width: 318, height: 37
            )
            .offset(x: 36, y: 176)
        }
    }

    // Player

    private func playerPanel(_ section: Section) -> some View {
        let resolutions: [(String, String, String, [Int])] = [
            ("UHD", "2160p", "2160p", [12, 20, 35]),
            ("FHD", "1080p", "1080p", [4, 8, 12]),
            ("HD", "720p", "720p", [2, 4, 6]),
            ("SD", "480p", "480p", [1, 2, 3]),
        ]
        let tiers = ["Low", "Medium", "High"]
        let columnX: [CGFloat] = [100, 187, 273]
        let subtitleModes: [(String, String)] = [("off", "Off"), ("forced", "Forced only"), ("always", "Always on")]
        return WMPanelPage(kicker: section.title, subtitle: section.description, height: 1000, onBack: { selected = nil }) {
            panelH3("Default quality", size: 16.8, weight: 560, lh: 25, ls: -0.588).offset(x: 36, y: 108)
            WMText("Start playback at this quality when the server can provide it.", 10.56, 400, color: WM.muted, lh: 16)
                .frame(width: 318, alignment: .leading).offset(x: 36, y: 139)
            Button { qualityID = "original" } label: {
                WMQualityCell(width: 318, selected: qualityID == "original") {
                    WMText("Original", 9.28, 700, lh: 14).offset(x: 11, y: 11)
                    WMText("Best available source", 7.04, 400, color: WM.muted, lh: 11).offset(x: 11, y: 27)
                    Text("\u{2713}").font(WM.font(11.84, 400)).foregroundStyle(WM.pink).offset(x: 291, y: 15)
                }
            }
            .buttonStyle(.plain)
            .offset(x: 36, y: 170)
            ForEach(0..<3, id: \.self) { column in
                Text(tiers[column].uppercased())
                    .font(WM.font(7.68, 760)).tracking(0.6144).foregroundStyle(WM.muted)
                    .frame(width: 81, height: 24)
                    .offset(x: columnX[column], y: 226)
            }
            ForEach(Array(resolutions.enumerated()), id: \.offset) { row, resolution in
                let y = 256 + CGFloat(row) * 54
                WMText(resolution.0, 8.96, 760, lh: 13).offset(x: 40, y: y + 11)
                WMText(resolution.1, 7.04, 400, color: WM.muted, lh: 11).offset(x: 40, y: y + 26)
                ForEach(0..<3, id: \.self) { column in
                    let id = "h264-\(resolution.2)-\(resolution.3[column])mbps"
                    Button { qualityID = id } label: {
                        WMQualityCell(width: 81, selected: qualityID == id) {
                            WMText("\(resolution.3[column]) Mbps", 9.28, 700, color: WM.inkSoft, lh: 14).frame(width: 37, alignment: .leading).offset(x: 11, y: 11)
                            WMText(tiers[column], 7.04, 400, color: WM.muted, lh: 11).offset(x: 11, y: 27)
                        }
                    }
                    .buttonStyle(.plain)
                    .offset(x: columnX[column], y: y)
                }
            }
            panelH3("Default subtitles", size: 16.8, weight: 560, lh: 25, ls: -0.588).offset(x: 36, y: 511)
            WMPara(
                text: "Keep subtitles off, show forced dialogue only, or turn them on automatically.",
                size: 10.56, weight: 400, lh: 16.5, width: 318, height: 33
            )
            .offset(x: 36, y: 541)
            ForEach(Array(subtitleModes.enumerated()), id: \.offset) { index, mode in
                Button { subtitleMode = mode.0 } label: {
                    WMQualityCell(width: 318, height: 54, selected: subtitleMode == mode.0, bar: true) {
                        WMText(mode.1, 11.2, 700, color: subtitleMode == mode.0 ? WM.ink : WM.inkSoft, lh: 17).offset(x: 15, y: 19)
                    }
                }
                .buttonStyle(.plain)
                .offset(x: 36, y: 589 + CGFloat(index) * 62)
            }
            panelH3("Default audio track", size: 16.8, weight: 560, lh: 25, ls: -0.588).offset(x: 36, y: 812)
            WMText("Prefer this audio language whenever a matching track exists.", 10.56, 400, color: WM.muted, lh: 16)
                .frame(width: 318, alignment: .leading).offset(x: 36, y: 843)
            settingPicker("Audio language", selection: $audioLanguage) { languageOptions }
                .onChange(of: audioLanguage) { _, value in savePlayerLanguage(value) }
                .frame(width: 318)
                .offset(x: 36, y: 875)
        }
    }

    // Server connection

    private func serverPanel(_ section: Section) -> some View {
        WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
            ZStack(alignment: .topLeading) {
                Rectangle().fill(WM.line.opacity(0.14))
                Rectangle().fill(WM.page).frame(width: 316, height: 94).offset(x: 1, y: 1)
                WMText("Playarr Server", 16, 700, lh: 24).offset(x: 19, y: 17)
                WMText(environment.currentUserName ?? "Playarr viewer", 10.56, 400, color: WM.muted, lh: 16).offset(x: 19, y: 44)
                WMText(environment.serverBaseURL.absoluteString, 10.56, 400, color: WM.muted, lh: 16).offset(x: 19, y: 63)
                Text("PRIMARY")
                    .font(WM.mono(10.56, 400)).foregroundStyle(WM.muted)
                    .frame(width: 67, height: 31)
                    .overlay(Rectangle().stroke(WM.line.opacity(0.14), lineWidth: 1))
                    .offset(x: 232, y: 32)
            }
            .frame(width: 318, height: 96, alignment: .topLeading)
            .offset(x: 36, y: 108)
            panelLabel("Add another server").offset(x: 36, y: 224)
            WMFieldGroup(height: 191) {
                ZStack(alignment: .topLeading) {
                    WMFieldBox { TextField("", text: $serverAddress, prompt: Text.wmPlaceholder("Server address or URL"))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL) }
                    WMFieldBox { Text(environment.currentUserName ?? "Playarr viewer").foregroundStyle(WM.ink) }.offset(y: 49)
                    WMFieldBox { SecureField("", text: $serverPassword, prompt: Text.wmPlaceholder("Password")) }.offset(y: 98)
                    WMPanelButton(label: "Connect", width: 318, height: 44, action: connectServer).offset(y: 147)
                }
            }
            .offset(x: 36, y: 248)
            WMPara(
                text: "Credentials and requests go directly from this app to that server.",
                size: 12.48, weight: 400, lh: 18.5, width: 318, height: 37
            )
            .offset(x: 36, y: 439)
            WMPanelButton(label: "Test connection", primary: false, width: 115, height: 38).offset(x: 36, y: 496)
            WMPara(
                text: "\(environment.serverBaseURL.absoluteString) remains the primary server for profile and player preferences.",
                size: 12.48, weight: 400, lh: 18.5, width: 318, height: 37
            )
            .offset(x: 36, y: 554)
            WMText("\u{25B8} TV app connection details", 11.52, 720, color: WM.inkSoft, lh: 17)
                .frame(width: 318, alignment: .leading).offset(x: 36, y: 629)
        }
    }

    // Profile lock

    private func lockPanel(_ section: Section) -> some View {
        WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
            panelLabel("New PIN").offset(x: 36, y: 108)
            WMFieldGroup(height: pinLocked ? 142 : 93) {
                ZStack(alignment: .topLeading) {
                    WMFieldBox {
                        SecureField("", text: $pin, prompt: Text.wmPlaceholder("\u{2022}\u{2022}\u{2022}\u{2022}"))
                            .keyboardType(.numberPad)
                            .onChange(of: pin) { _, value in pin = String(value.filter(\.isNumber).prefix(4)) }
                    }
                    WMPanelButton(
                        label: pinLocked ? "Replace PIN" : "Set PIN",
                        enabled: pin.count == 4 && !busy,
                        width: 318, height: 44,
                        action: { savePin(pin) }
                    )
                    .offset(y: 49)
                    if pinLocked {
                        WMPanelButton(label: "Remove PIN", primary: false, width: 318, height: 44, action: { savePin(nil) })
                            .offset(y: 98)
                    }
                }
            }
            .offset(x: 36, y: 132)
            WMText(pinLocked ? "PIN lock is on." : "PIN lock is off.", 16, 400, color: WM.muted, lh: 24)
                .offset(x: 36, y: pinLocked ? 300 : 251)
        }
    }

    // Invite a friend

    private func invitePanel(_ section: Section) -> some View {
        WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
            if let inviteLink {
                WMText("Your invitation is ready.", 16, 400, color: WM.muted, lh: 24).offset(x: 36, y: 108)
                WMPara(text: inviteLink.absoluteString, size: 12.48, weight: 400, lh: 18.5, width: 318, height: 74)
                    .offset(x: 36, y: 152)
                ShareLink(item: inviteLink) { WMPanelButton(label: "Share invitation", width: 318, height: 44).allowsHitTesting(false) }
                    .offset(x: 36, y: 240)
            } else if inviteRequest?.status == .approved {
                WMText("Your request was approved.", 16, 400, color: WM.muted, lh: 24).offset(x: 36, y: 108)
                WMPanelButton(label: "Generate invitation", enabled: !busy, width: 318, height: 44, action: generateInvite)
                    .offset(x: 36, y: 152)
            } else if let request = inviteRequest {
                WMText("Your invite request is \(request.status.rawValue).", 16, 400, color: WM.muted, lh: 24).offset(x: 36, y: 108)
            } else {
                WMText("You have not requested an invite yet.", 16, 400, color: WM.muted, lh: 24).offset(x: 36, y: 108)
                Text("WHO IS THIS FOR, AND WHAT SHOULD THEY HAVE ACCESS TO? (OPTIONAL)")
                    .font(WM.font(11.2, 720)).tracking(0.896).foregroundStyle(WM.muted)
                    .lineSpacing(17 - 11.2 * 1.364)
                    .frame(width: 318, height: 34, alignment: .topLeading)
                    .offset(x: 36, y: 152)
                TextField(
                    "", text: $inviteMessage,
                    prompt: Text.wmPlaceholder("For example: For Sam \u{2014} films and television series, please."),
                    axis: .vertical
                )
                .font(WM.font(9.3, 400))
                .foregroundStyle(WM.ink)
                .padding(.horizontal, 8).padding(.vertical, 6)
                .frame(width: 318, height: 48, alignment: .topLeading)
                .overlay(Rectangle().stroke(WM.line.opacity(0.28), lineWidth: 1))
                .offset(x: 36, y: 186)
                WMPanelButton(label: "Request invite QR", enabled: !busy, width: 318, height: 44, action: requestInvite)
                    .offset(x: 36, y: 267)
            }
            WMPanelButton(label: "Enable approval notifications", primary: false, width: 187, height: 38)
                .offset(x: 36, y: 331)
        }
    }

    // Phone remote

    private func remotePanel(_ section: Section) -> some View {
        WMPanelPage(kicker: section.title, subtitle: section.description, height: 844, onBack: { selected = nil }) {
            panelH3("This device").offset(x: 36, y: 108)
            RoundedRectangle(cornerRadius: 2.5)
                .stroke(WM.inkSoft.opacity(0.8), lineWidth: 1.2)
                .frame(width: 13, height: 13)
                .offset(x: 40, y: 174.5)
            WMPara(
                text: "Allow my other devices to control this one",
                size: 16, weight: 400, color: WM.ink, lh: 24, width: 292, height: 48
            )
            .offset(x: 68, y: 156)
            WMPara(
                text: "Devices must be signed in to your account, and you approve every pairing on this screen.",
                size: 12.48, weight: 400, lh: 18.5, width: 318, height: 37
            )
            .offset(x: 36, y: 224)
            RemoteControllerView(apiClient: environment.apiClient, webStyle: true)
                .frame(width: 318, alignment: .topLeading)
                .offset(x: 36, y: 310)
        }
    }
}

/// A `quality-matrix-choice` / `player-default-button` cell: rounded, outlined, tinted when selected.
private struct WMQualityCell<Content: View>: View {
    let width: CGFloat
    var height: CGFloat = 48
    let selected: Bool
    var bar = false
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: bar ? 0 : 10, style: .continuous)
        ZStack(alignment: .topLeading) {
            shape.fill(selected ? WM.pink.opacity(0.12) : WM.page)
            content()
            if selected && bar {
                Rectangle().fill(WM.pink).frame(width: 3, height: height)
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .overlay(shape.stroke(selected && !bar ? WM.pink : WM.line.opacity(scheme == .dark ? 0.2 : 0.14), lineWidth: 1))
        .contentShape(Rectangle())
    }
}
