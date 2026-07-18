import Observation
import StreamarrKit
import SwiftUI

@MainActor
@Observable
private final class ProfilesViewModel {
    enum State { case idle, loading, loaded, failed(String) }
    var state: State = .idle
    var profiles: [AvailableProfile] = []
    var switching = false
    var errorMessage: String?
    let environment: AppEnvironment

    init(environment: AppEnvironment) { self.environment = environment }

    func load() async {
        state = .loading
        do {
            profiles = try await environment.apiClient.listProfiles()
            state = .loaded
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
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 7) {
                    Text("WHO’S WATCHING?")
                        .font(.caption2.weight(.black))
                        .tracking(1.6)
                        .foregroundStyle(PlayarrStyle.pink)
                    Text("Choose a profile")
                        .font(.system(size: 42, weight: .medium, design: .rounded))
                        .tracking(-1.8)
                        .foregroundStyle(PlayarrStyle.ink)
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 138), spacing: 20)], spacing: 24) {
                    ForEach(viewModel.profiles) { profile in
                        Button { choose(profile) } label: {
                            VStack(spacing: 10) {
                                ZStack {
                                    Circle()
                                        .fill(profile.isCurrent ? PlayarrStyle.pink.gradient : PlayarrStyle.inkSoft.gradient)
                                    Text(String(profile.displayName.prefix(1)).uppercased())
                                        .font(.system(size: 42, weight: .medium, design: .rounded))
                                        .foregroundStyle(.white)
                                    if profile.pinLocked {
                                        Image(systemName: "lock.fill")
                                            .font(.caption)
                                            .foregroundStyle(.white)
                                            .padding(8)
                                            .background(PlayarrStyle.ink, in: Circle())
                                            .offset(x: 47, y: 47)
                                    }
                                }
                                .aspectRatio(1, contentMode: .fit)
                                .overlay {
                                    if profile.isCurrent {
                                        Circle().stroke(PlayarrStyle.pink.opacity(0.42), lineWidth: 5)
                                            .padding(-7)
                                    }
                                }
                                Text(profile.displayName)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(PlayarrStyle.ink)
                                    .lineLimit(1)
                                Text(profile.isCurrent ? "Current profile" : profile.username)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(PlayarrStyle.muted)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(viewModel.switching)
                    }
                }
                .frame(maxWidth: 680)

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(PlayarrStyle.pink)
                }

                HStack(spacing: 12) {
                    Button("Settings", action: onOpenSettings)
                        .buttonStyle(.bordered)
                        .tint(PlayarrStyle.inkSoft)
                    Button("Sign out", role: .destructive) {
                        Task { try? await viewModel.environment.signOut() }
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 104)
            .padding(.bottom, 112)
            .frame(maxWidth: .infinity)
        }
        .background(PlayarrStyle.background)
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
