import PlayarrKit
import SwiftUI

/// Phone remote: pick a paired or pairable device, then drive it.
struct RemoteControllerView: View {
    @State private var viewModel: RemoteControllerViewModel
    @State private var text = ""

    init(apiClient: PlayarrAPIClient) {
        _viewModel = State(initialValue: RemoteControllerViewModel(apiClient: apiClient))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if case .failed(let message) = viewModel.phase {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.danger)
            }
            if let pairing = viewModel.activePairing, let target = viewModel.selectedTarget {
                controls(target: target, pairing: pairing)
            } else if let pending = viewModel.pendingPairing {
                pendingView(pending)
            } else {
                targetList
            }
        }
        .task { await viewModel.load() }
    }

    private var targetList: some View {
        VStack(alignment: .leading, spacing: 10) {
            if viewModel.controllableTargets.isEmpty {
                Text("No controllable devices found. Open Playarr on a TV signed in to the same account.")
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.inkSoft)
            }
            ForEach(viewModel.controllableTargets) { target in
                Button {
                    Task { await viewModel.select(target) }
                } label: {
                    HStack {
                        Image(systemName: "tv")
                        VStack(alignment: .leading) {
                            Text(target.name).font(.headline)
                            Text(target.online ? "Online" : "Offline")
                                .font(.caption)
                                .foregroundStyle(PlayarrStyle.muted)
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(PlayarrStyle.background.opacity(0.6))
                    .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                .disabled(!target.online)
            }
            Button("Refresh") { Task { await viewModel.load() } }
                .buttonStyle(.bordered)
        }
    }

    private func pendingView(_ pairing: RemotePairing) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Approve on your TV")
                .font(.headline)
                .foregroundStyle(PlayarrStyle.ink)
            if let code = pairing.verificationCode {
                Text(code)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .foregroundStyle(PlayarrStyle.ink)
            }
            Text("Check that this code matches the one on the screen, then choose Approve there.")
                .font(.footnote)
                .foregroundStyle(PlayarrStyle.inkSoft)
            Button("Cancel") { Task { await viewModel.disconnect() } }
                .buttonStyle(.bordered)
        }
    }

    private func controls(target: RemoteTarget, pairing: RemotePairing) -> some View {
        VStack(spacing: 16) {
            Text("Controlling \(target.name)")
                .font(.headline)
                .foregroundStyle(PlayarrStyle.ink)
            if viewModel.has(RemoteCapability.navigate) {
                dpad
            }
            if viewModel.has(RemoteCapability.playback) {
                HStack(spacing: 18) {
                    control("gobackward.10", "Back 10 seconds") { RemoteCommand.seekBy(milliseconds: -10_000) }
                    control("playpause.fill", "Play or pause") { RemoteCommand.playback("toggle") }
                    control("goforward.10", "Forward 10 seconds") { RemoteCommand.seekBy(milliseconds: 10_000) }
                }
            }
            if viewModel.has(RemoteCapability.text) {
                HStack {
                    TextField("Type on the TV", text: $text)
                        .textFieldStyle(.roundedBorder)
                    Button("Send") {
                        let value = text
                        text = ""
                        Task { await viewModel.send(RemoteCommand.text(value, submit: true)) }
                    }
                    .disabled(text.isEmpty)
                }
            }
            if let message = viewModel.lastCommandMessage {
                Text(message).font(.footnote).foregroundStyle(PlayarrStyle.danger)
            }
            Button("Disconnect", role: .destructive) { Task { await viewModel.disconnect() } }
                .buttonStyle(.bordered)
        }
    }

    private var dpad: some View {
        VStack(spacing: 8) {
            control("chevron.up", "Up") { RemoteCommand.navigate("up") }
            HStack(spacing: 8) {
                control("chevron.left", "Left") { RemoteCommand.navigate("left") }
                control("circle.fill", "Select") { RemoteCommand.navigate("select") }
                control("chevron.right", "Right") { RemoteCommand.navigate("right") }
            }
            control("chevron.down", "Down") { RemoteCommand.navigate("down") }
            HStack(spacing: 8) {
                control("arrow.uturn.backward", "Back") { RemoteCommand.navigate("back") }
                control("house", "Home") { RemoteCommand.navigate("home") }
            }
        }
    }

    private func control(_ symbol: String, _ label: String, _ command: @escaping () -> RemoteCommand.Request) -> some View {
        Button {
            Task { await viewModel.send(command()) }
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 56, height: 56)
                .background(PlayarrStyle.surfaceStrong, in: Circle())
                .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .foregroundStyle(PlayarrStyle.ink)
        .accessibilityLabel(label)
    }
}
