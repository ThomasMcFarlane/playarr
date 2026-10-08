import PlayarrKit
import SwiftUI

/// Phone remote settings content (web `Settings > Phone remote`): control
/// another device, the on-screen pad and the paired remotes list.
struct RemoteControllerView: View {
    @State private var viewModel: RemoteControllerViewModel
    @State private var text = ""
    @State private var renaming: (id: String, name: String)?
    /// Web mobile typography and spacing (the Phone remote panel of the parity screens).
    var webStyle = false

    init(apiClient: PlayarrAPIClient, webStyle: Bool = false) {
        self.webStyle = webStyle
        _viewModel = State(initialValue: RemoteControllerViewModel(apiClient: apiClient))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: webStyle ? 0 : 18) {
            targetsSection
            if let pairing = viewModel.activePairing, let target = viewModel.selectedTarget {
                pad(target: target, pairing: pairing)
            }
            pairingsSection
        }
        .task {
            // Same 5 second refresh as the web page.
            while !Task.isCancelled {
                await viewModel.load()
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    private var targetsSection: some View {
        VStack(alignment: .leading, spacing: webStyle ? 0 : 10) {
            if webStyle {
                WMText("Control another device", 18.72, 700, lh: 28)
            } else {
                Text("Control another device").font(.headline).foregroundStyle(PlayarrStyle.ink)
            }
            if viewModel.otherTargets.isEmpty {
                if webStyle {
                    WMPara(
                        text: "No other devices are available. Turn on remote control on the other device first.",
                        size: 16, weight: 400, lh: 24, width: 318, height: 48
                    )
                    .padding(.top, 20)
                } else {
                    Text("No other devices are available. Turn on remote control on the other device first.")
                        .font(.footnote)
                        .foregroundStyle(PlayarrStyle.inkSoft)
                }
            }
            ForEach(viewModel.otherTargets) { target in
                let existing = viewModel.activePairing(for: target)
                Button {
                    Task { await viewModel.select(target) }
                } label: {
                    HStack {
                        Text(target.name).font(.headline)
                        Spacer()
                        Text(!target.online ? "Offline" : existing != nil ? "Control" : "Pair")
                            .font(.caption)
                            .foregroundStyle(PlayarrStyle.muted)
                    }
                    .padding(12)
                    .background(PlayarrStyle.background.opacity(0.6))
                    .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                .foregroundStyle(PlayarrStyle.ink)
                .disabled(!target.online || viewModel.pendingPairing != nil)
            }
            if let pending = viewModel.pendingPairing {
                Text("Waiting for approval on \(viewModel.deviceName(pending.targetDeviceID)). Code \(pending.verificationCode ?? "")")
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.inkSoft)
            }
            if let message = viewModel.errorMessage {
                Text(message).font(.footnote).foregroundStyle(PlayarrStyle.danger)
            }
        }
    }

    private func pad(target: RemoteTarget, pairing: RemotePairing) -> some View {
        VStack(spacing: 16) {
            Text("Controlling \(target.name)")
                .font(.headline)
                .foregroundStyle(PlayarrStyle.ink)
            if viewModel.has(RemoteCapability.navigate) {
                dpad
            }
            if viewModel.has(RemoteCapability.playback) {
                HStack(spacing: 14) {
                    control("gobackward.10", "-10 s") { RemoteCommand.seekBy(milliseconds: -10_000) }
                    control("playpause.fill", "Play / pause") { RemoteCommand.playback("toggle") }
                    control("goforward.10", "+10 s") { RemoteCommand.seekBy(milliseconds: 10_000) }
                    control("stop.fill", "Stop") { RemoteCommand.stop() }
                }
            }
            if viewModel.has(RemoteCapability.text) {
                HStack {
                    TextField("Type on the device", text: $text)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onChange(of: text) { _, value in
                            // Mirror typing live so the device field tracks the phone keyboard.
                            Task { await viewModel.send(RemoteCommand.text(value, mode: "replace")) }
                        }
                    Button("Enter") {
                        let value = text
                        text = ""
                        Task { await viewModel.send(RemoteCommand.text(value, mode: "replace", submit: true)) }
                    }
                }
            }
            if let message = viewModel.commandMessage {
                Text(message).font(.footnote).foregroundStyle(PlayarrStyle.danger)
            }
            Button("Close") { Task { await viewModel.closePad() } }
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
    }

    private var dpad: some View {
        VStack(spacing: 8) {
            control("chevron.up", "Up") { RemoteCommand.navigate("up") }
            HStack(spacing: 8) {
                control("chevron.left", "Left") { RemoteCommand.navigate("left") }
                control("circle.fill", "OK") { RemoteCommand.navigate("select") }
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

    private var pairingsSection: some View {
        VStack(alignment: .leading, spacing: webStyle ? 8 : 10) {
            if webStyle {
                WMText("Paired remotes", 18.72, 700, lh: 28).padding(.top, 60)
            } else {
                Text("Paired remotes").font(.headline).foregroundStyle(PlayarrStyle.ink)
            }
            if viewModel.livePairings.isEmpty {
                if webStyle {
                    WMText("No remotes are paired.", 16, 400, color: WM.muted, lh: 24).padding(.top, 12)
                } else {
                    Text("No remotes are paired.").font(.footnote).foregroundStyle(PlayarrStyle.inkSoft)
                }
            }
            ForEach(viewModel.livePairings) { pairing in
                VStack(alignment: .leading, spacing: 6) {
                    if let current = renaming, current.id == pairing.id {
                        TextField("Name for this remote", text: Binding(
                            get: { renaming?.name ?? "" },
                            set: { renaming = (pairing.id, String($0.prefix(60))) }
                        ))
                        .textFieldStyle(.roundedBorder)
                        HStack {
                            Button("Save") {
                                let name = current.name
                                Task {
                                    if await viewModel.rename(pairing, to: name) { renaming = nil }
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            Button("Cancel") { renaming = nil }.buttonStyle(.bordered)
                        }
                    } else {
                        Text(viewModel.label(for: pairing)).font(.headline).foregroundStyle(PlayarrStyle.ink)
                        Text((pairing.isTarget ? "" : "\(pairing.controllerName) · ") + pairing.scopes.joined(separator: ", "))
                            .font(.caption)
                            .foregroundStyle(PlayarrStyle.muted)
                        Text(pairing.status == "pending"
                            ? "Waiting for approval"
                            : "Paired \(Self.date(pairing.createdMs)), expires \(Self.date(pairing.expiresMs))")
                            .font(.caption)
                            .foregroundStyle(PlayarrStyle.muted)
                        HStack {
                            Button("Rename") { renaming = (pairing.id, pairing.controllerName) }
                                .buttonStyle(.bordered)
                            Button("Revoke") { Task { await viewModel.revoke(pairing) } }
                                .buttonStyle(.bordered)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
            }
        }
    }

    private static func date(_ milliseconds: Int64) -> String {
        Date(timeIntervalSince1970: Double(milliseconds) / 1000).formatted(date: .numeric, time: .omitted)
    }
}
