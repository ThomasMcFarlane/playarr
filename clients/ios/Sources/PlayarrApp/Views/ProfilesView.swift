import Observation
import PlayarrKit
import SwiftUI
import UIKit

@MainActor
@Observable
private final class ProfilesViewModel {
    enum State { case idle, loading, loaded, failed(String) }
    var state: State = .idle
    var profiles: [AvailableProfile] = []
    var currentAvatar: ProfileAvatarPreference?
    var switching = false
    var errorMessage: String?
    let environment: AppEnvironment

    init(environment: AppEnvironment) { self.environment = environment }

    func load() async {
        state = .loading
        do {
            profiles = try await environment.apiClient.listProfiles()
            state = .loaded
            currentAvatar = (try? await environment.apiClient.getProfileAvatar())?.preference
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func switchTo(_ profile: AvailableProfile, pin: String?) async -> Bool {
        switching = true
        errorMessage = nil
        defer { switching = false }
        do {
            try await environment.switchProfile(profile, pin: pin)
            return true
        } catch let error as APIError {
            errorMessage = error.displayMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        return false
    }
}

struct ProfilesView: View {
    @State private var viewModel: ProfilesViewModel
    @State private var pinProfile: AvailableProfile?
    @State private var pin = ""
    @State private var selectedProfileID: UUID?
    @AppStorage("com.playarr.ios.appearance") private var appearance = "system"
    @AppStorage("com.playarr.ios.language") private var language = "system"
    let onOpenSettings: () -> Void
    let onHome: () -> Void

    init(environment: AppEnvironment, onOpenSettings: @escaping () -> Void, onHome: @escaping () -> Void) {
        _viewModel = State(initialValue: ProfilesViewModel(environment: environment))
        self.onOpenSettings = onOpenSettings
        self.onHome = onHome
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading:
                PlayarrLoadingView(title: "Loading profiles…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load profiles", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                content
            }
        }
        .task {
            if case .idle = viewModel.state { await viewModel.load() }
        }
        .alert("Enter profile PIN", isPresented: Binding(
            get: { pinProfile != nil },
            set: { if !$0 { pinProfile = nil; pin = "" } }
        )) {
            SecureField("4-digit PIN", text: $pin)
                .keyboardType(.numberPad)
            Button("Cancel", role: .cancel) { pinProfile = nil; pin = "" }
            Button("Continue") {
                guard let profile = pinProfile else { return }
                Task {
                    if await viewModel.switchTo(profile, pin: pin) { onHome() }
                    pinProfile = nil
                    pin = ""
                }
            }
            .disabled(pin.count != 4)
        } message: {
            Text("This profile is protected.")
        }
        .navigationBarHidden(true)
    }

    private var content: some View {
        GeometryReader { proxy in
            if PlayarrLayout.isPhone(proxy.size) {
                phoneContent
            } else {
                stageContent(proxy: proxy)
            }
        }
        .ignoresSafeArea()
    }

    private func dropdown<Items: View>(
        x: CGFloat, icon: String, label: String, @ViewBuilder items: () -> Items
    ) -> some View {
        Menu {
            items()
        } label: {
            ZStack {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(WM.muted)
                    .offset(x: -39)
                WMText(label, 11.52, 720, lh: 17.28)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(WM.muted)
                    .offset(x: 42)
            }
            .frame(width: 115, height: 48)
            .background(WM.shell)
            .overlay(Rectangle().stroke(WM.line.opacity(0.28), lineWidth: 1))
        }
        .offset(x: x, y: 39)
    }

    private var themeLabel: String {
        switch appearance {
        case "light": "Light"
        case "dark": "Dark"
        default: "System"
        }
    }

    private var languageLabel: String {
        Self.languages.first(where: { $0.0 == language })?.1 ?? "Auto"
    }

    private static let languages: [(String, String)] = [
        ("system", "Auto"), ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"),
        ("it", "Italian"), ("pt", "Portuguese"), ("ja", "Japanese"), ("ko", "Korean"), ("zh", "Chinese"),
        ("hi", "Hindi"), ("ar", "Arabic"), ("th", "Thai"),
    ]

    /// Web mobile profile picker (numbers from the web layout): theme and language dropdowns,
    /// a centred heading and the profile avatars with the "Sign in" tile.
    private var phoneContent: some View {
        ZStack(alignment: .topLeading) {
            WM.shell.ignoresSafeArea()
            RadialGradient(
                colors: [WM.pink.opacity(0.1), WM.pink.opacity(0)],
                center: UnitPoint(x: 0.5, y: 0.5),
                startRadius: 0,
                endRadius: 300
            )
            .frame(width: 600, height: 600)
            .offset(x: -105, y: 120)
            .allowsHitTesting(false)

            PlayarrLogo(size: 30).offset(x: 21, y: 20)
            dropdown(x: 138, icon: "sun.max", label: themeLabel) {
                Button("System") { appearance = "system" }
                Button("Light") { appearance = "light" }
                Button("Dark") { appearance = "dark" }
            }
            dropdown(x: 261, icon: "globe", label: languageLabel) {
                ForEach(Self.languages, id: \.0) { entry in
                    Button(entry.1) { language = entry.0 }
                }
            }
            WMText("PROFILES", 7.36, 820, color: WM.pink, lh: 11.04, ls: 0.9568)
                .frame(width: 358).offset(x: 16, y: 72)
            WMText("Who\u{2019}s watching?", 42.9, 500, lh: 40.755, ls: -3.0888)
                .frame(width: 358).offset(x: 16, y: 90)

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 19) {
                    ForEach(Array(viewModel.profiles.enumerated()), id: \.element.id) { index, profile in
                        phoneProfile(profile)
                    }
                    phoneSignIn
                }
                .padding(.leading, 24)
                .padding(.trailing, 24)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .frame(width: 390, height: 300, alignment: .topLeading)
            .offset(x: 0, y: 169)

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(WM.font(11, 650)).foregroundStyle(PlayarrStyle.danger)
                    .offset(x: 24, y: 470)
            }

            Button {
                if let url = URL(string: "/clients", relativeTo: viewModel.environment.serverBaseURL)?.absoluteURL {
                    UIApplication.shared.open(url)
                }
            } label: {
                HStack(spacing: 8) {
                    WMText("Clients", 7.68, 720, color: WM.inkSoft, lh: 11.52).fixedSize()
                    WMText("\u{2192}", 7.68, 720, color: WM.inkSoft, lh: 11.52).fixedSize()
                }
                .frame(width: 78, height: 44)
                .background(WM.chip.opacity(0.66), in: Capsule())
                .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .offset(x: 290, y: 775)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func phoneProfile(_ profile: AvailableProfile) -> some View {
        let selected = profile.isCurrent
        return VStack(spacing: 0) {
            Button { choose(profile) } label: {
                ZStack {
                    PlayarrProfileAvatar(
                        preference: profile.isCurrent ? viewModel.currentAvatar : nil,
                        userID: profile.isCurrent ? viewModel.environment.currentUserID : profile.id,
                        userName: profile.displayName,
                        size: selected ? 169 : 163
                    )
                    .overlay {
                        if selected {
                            Circle().stroke(WM.pink.opacity(0.42), lineWidth: 4).padding(-2)
                        }
                    }
                }
                .frame(width: 163, height: 163)
            }
            .buttonStyle(.plain)
            .disabled(viewModel.switching)
            WMText(profile.displayName, 13.12, 680, lh: 19.68)
                .frame(width: 163).padding(.top, 10)
            WMText(
                profile.isCurrent ? "WATCHING NOW" : profile.pinLocked ? "PIN REQUIRED" : "READY",
                6.72, 690, color: WM.muted, lh: 10.08, ls: 0.3024
            )
            .frame(width: 163).padding(.top, 9)
            if selected {
                HStack(spacing: 9) {
                    Button(action: onOpenSettings) {
                        Image(systemName: "gearshape")
                            .font(.system(size: 14))
                            .foregroundStyle(WM.pink)
                            .frame(width: 44, height: 44)
                            .background(WM.chip.opacity(0.66), in: Circle())
                            .overlay(Circle().stroke(WM.line.opacity(0.14), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    Button {
                        Task { try? await viewModel.environment.signOut() }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .font(.system(size: 9)).foregroundStyle(WM.inkSoft)
                            WMText("Sign out", 7.68, 720, color: WM.inkSoft, lh: 11.52).fixedSize()
                        }
                        .frame(width: 92, height: 44)
                        .background(WM.chip.opacity(0.66), in: Capsule())
                        .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 20).padding(.leading, 9)
                .frame(width: 163, alignment: .leading)
            }
        }
        .frame(width: 163, alignment: .top)
    }

    private var phoneSignIn: some View {
        Button {
            Task { try? await viewModel.environment.signOut() }
        } label: {
            VStack(spacing: 0) {
                ZStack {
                    Circle().fill(
                        LinearGradient(
                            colors: [
                                WM.adaptive(light: (233, 185, 196), dark: (140, 56, 86)),
                                WM.adaptive(light: (190, 85, 115), dark: (90, 30, 58)),
                            ],
                            startPoint: UnitPoint(x: 0.2, y: 0.06),
                            endPoint: UnitPoint(x: 0.8, y: 0.94)
                        )
                    )
                    Circle().stroke(WM.line.opacity(0.28), style: StrokeStyle(lineWidth: 1, dash: [3, 3])).padding(5)
                    WMText("+", 38.4, 300, color: WM.inkSoft, lh: 57.6)
                }
                .frame(width: 156, height: 156)
                WMText("Sign in", 13.12, 680, color: WM.inkSoft, lh: 19.68).frame(width: 156).padding(.top, 9)
                WMText("ADD ANOTHER PROFILE", 6.72, 690, color: WM.muted, lh: 10.08, ls: 0.3024)
                    .frame(width: 156).padding(.top, 8)
            }
            .frame(width: 156, alignment: .top)
        }
        .buttonStyle(.plain)
        .padding(.top, 13)
    }

    private func stageContent(proxy: GeometryProxy) -> some View {
        Group {
            let phone = false
            let avatarSize = phone
                ? min(160, max(122, proxy.size.width * 0.38))
                : min(244, max(160, proxy.size.width * 0.13))

            ZStack(alignment: .top) {
                profileBackground
                profileChrome(phone: phone, safeTop: proxy.safeAreaInsets.top)

                VStack(spacing: 7) {
                    Text("PROFILES")
                        .font(.custom("Avenir Next", fixedSize: phone ? 9 : 10).weight(.heavy))
                        .tracking(1.3)
                        .foregroundStyle(PlayarrStyle.pink)
                    Text("Who’s watching?")
                        .font(.custom("Avenir Next", fixedSize: phone ? 38 : min(72, proxy.size.width * 0.042)).weight(.medium))
                        .tracking(phone ? -2.7 : -4.6)
                        .foregroundStyle(PlayarrStyle.ink)
                }
                .padding(.top, phone ? max(118, proxy.safeAreaInsets.top + 78) : min(164, proxy.size.height * 0.15))

                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: phone ? 22 : min(44, proxy.size.width * 0.022)) {
                        ForEach(Array(viewModel.profiles.enumerated()), id: \.element.id) { index, profile in
                            profileChoice(profile, index: index, size: avatarSize)
                        }
                    }
                    .padding(.horizontal, phone ? max(20, (proxy.size.width - avatarSize) / 2) : max(72, proxy.size.width * 0.1))
                    .padding(.top, 18)
                    .padding(.bottom, 110)
                }
                .scrollIndicators(.hidden)
                .frame(height: avatarSize + 190)
                .padding(.top, phone ? 205 : min(350, proxy.size.height * 0.33))

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.danger)
                        .padding(.horizontal, 24)
                        .padding(.top, proxy.size.height - 80)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .onAppear {
                selectedProfileID = viewModel.profiles.first(where: \.isCurrent)?.id ?? viewModel.profiles.first?.id
            }
        }
    }

    private var profileBackground: some View {
        ZStack {
            LinearGradient(
                colors: [PlayarrStyle.surface, PlayarrStyle.background],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [PlayarrStyle.pink.opacity(0.13), .clear],
                center: .center,
                startRadius: 0,
                endRadius: 360
            )
            LinearGradient(
                colors: [PlayarrStyle.background.opacity(0.9), .clear, PlayarrStyle.background.opacity(0.82)],
                startPoint: .bottomLeading,
                endPoint: .topTrailing
            )
        }
        .ignoresSafeArea()
    }

    private func profileChrome(phone: Bool, safeTop: CGFloat) -> some View {
        HStack {
            PlayarrLogo(size: 30)
            Spacer()
            HStack(spacing: 11) {
                Image(systemName: "globe")
                Text("Auto").font(.custom("Avenir Next", fixedSize: 12).weight(.heavy))
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(PlayarrStyle.inkSoft)
            .frame(width: phone ? 168 : 150, height: 48)
            .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
        }
        .padding(.horizontal, phone ? 22 : 42)
        .padding(.top, max(phone ? 54 : 34, safeTop + 8))
    }

    private func profileChoice(_ profile: AvailableProfile, index: Int, size: CGFloat) -> some View {
        let selected = selectedProfileID == profile.id
        return VStack(spacing: 9) {
            Button {
                selectedProfileID = profile.id
                choose(profile)
            } label: {
                ZStack {
                    if profile.isCurrent, let preference = viewModel.currentAvatar {
                        savedAvatar(preference, size: size)
                    } else {
                        Circle().fill(LinearGradient(colors: avatarColours(index), startPoint: .topLeading, endPoint: .bottomTrailing))
                        Circle().fill(RadialGradient(colors: [.white.opacity(0.3), .clear], center: UnitPoint(x: 0.34, y: 0.26), startRadius: 0, endRadius: size * 0.36))
                        Image(systemName: avatarSymbol(index))
                            .font(.system(size: size * 0.4, weight: .ultraLight))
                            .foregroundStyle(.white.opacity(0.94))
                    }
                    if profile.pinLocked {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(PlayarrStyle.ink.opacity(0.9), in: Circle())
                            .offset(x: size * 0.34, y: size * 0.34)
                    }
                }
                .frame(width: size, height: size)
                .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                .shadow(color: selected ? PlayarrStyle.pink.opacity(0.42) : .clear, radius: 0, x: 0, y: 0)
                .overlay { selected ? Circle().stroke(PlayarrStyle.pink.opacity(0.42), lineWidth: 4).padding(-7) : nil }
                .scaleEffect(selected ? 1.035 : 1)
            }
            .buttonStyle(.plain)
            .disabled(viewModel.switching)

            Text(profile.displayName)
                .font(.custom("Avenir Next", fixedSize: size > 180 ? 16 : 14).weight(.bold))
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            Text(profile.isCurrent ? "CURRENT PROFILE" : profile.pinLocked ? "PIN REQUIRED" : "READY")
                .font(.custom("Avenir Next", fixedSize: 8.5).weight(.bold))
                .tracking(0.4)
                .foregroundStyle(PlayarrStyle.muted)

            if selected {
                HStack(spacing: 9) {
                    Button(action: onOpenSettings) {
                        Image(systemName: "gearshape")
                            .foregroundStyle(PlayarrStyle.pink)
                            .frame(width: 44, height: 44)
                            .background(PlayarrStyle.surfaceStrong.opacity(0.64), in: Circle())
                            .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                    }
                    .buttonStyle(.plain)

                    Button {
                        Task { try? await viewModel.environment.signOut() }
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                            .font(.custom("Avenir Next", fixedSize: 10).weight(.bold))
                            .foregroundStyle(PlayarrStyle.inkSoft)
                            .padding(.horizontal, 14)
                            .frame(height: 44)
                            .background(PlayarrStyle.surfaceStrong.opacity(0.64), in: Capsule())
                            .overlay { Capsule().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 7)
            }
        }
        .frame(width: size)
        .offset(y: selected ? -8 : 0)
        .onTapGesture { selectedProfileID = profile.id }
    }

    @ViewBuilder
    private func savedAvatar(_ preference: ProfileAvatarPreference, size: CGFloat) -> some View {
        PlayarrProfileAvatar(
            preference: preference,
            userID: viewModel.environment.currentUserID,
            userName: viewModel.environment.currentUserName,
            size: size
        )
    }

    private func avatarColours(_ index: Int) -> [Color] {
        let choices: [[Color]] = [
            [Color(red: 0.91, green: 0.46, blue: 0.57), Color(red: 0.66, green: 0.15, blue: 0.33)],
            [Color(red: 0.43, green: 0.69, blue: 0.75), Color(red: 0.18, green: 0.34, blue: 0.54)],
            [Color(red: 0.76, green: 0.64, blue: 0.40), Color(red: 0.43, green: 0.27, blue: 0.18)],
            [Color(red: 0.52, green: 0.72, blue: 0.55), Color(red: 0.18, green: 0.43, blue: 0.30)],
        ]
        return choices[index % choices.count]
    }

    private func avatarSymbol(_ index: Int) -> String {
        ["sparkles", "moon.stars", "bolt", "leaf"][index % 4]
    }

    private func choose(_ profile: AvailableProfile) {
        if profile.isCurrent {
            onHome()
        } else if profile.pinLocked {
            pinProfile = profile
        } else {
            Task {
                if await viewModel.switchTo(profile, pin: nil) { onHome() }
            }
        }
    }
}
