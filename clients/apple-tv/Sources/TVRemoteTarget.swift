import Observation
import PlayarrKit
import SwiftUI

/// Apple TV as a remote-control target (`docs/architecture/remote-control.md`).
///
/// Registers with the capabilities this app can really honour (playback
/// transport while a player is on screen), long-polls the inbox, asks the
/// person at the screen to approve or deny pairing requests, and executes
/// playback commands against the active `PlayerEngine`. Navigation and text
/// are not advertised: SwiftUI offers no supported way to synthesise focus
/// moves, so those controls stay hidden on the phone instead of pretending.
@MainActor
@Observable
final class TVRemoteTarget {
    struct PairingRequest: Identifiable, Equatable {
        let id: String
        let controllerName: String
        let verificationCode: String
    }

    private(set) var requests: [PairingRequest] = []

    /// Set by the player screen while it is on screen.
    @ObservationIgnored weak var engine: AnyObject?
    @ObservationIgnored private var playerEngine: PlayerEngine? { engine as? PlayerEngine }

    @ObservationIgnored private var client: RemoteClient?
    @ObservationIgnored private var after: Int64 = 0

    static let capabilities = RemoteCapabilityAdvertiser.advertised(
        canNavigate: false, canText: false, canControlPlayback: true, canHandOff: false
    )

    func attach(engine: PlayerEngine) { self.engine = engine as AnyObject }

    func detach(engine: PlayerEngine) {
        if self.engine === (engine as AnyObject) { self.engine = nil }
    }

    func run(apiClient: PlayarrAPIClient) async {
        let client = RemoteClient(transport: apiClient)
        self.client = client
        after = 0
        var registered = false
        while !Task.isCancelled {
            do {
                if !registered {
                    _ = try await client.registerTarget(
                        name: "Apple TV",
                        platform: "tvos",
                        capabilities: Self.capabilities
                    )
                    registered = true
                }
                let inbox = try await client.inbox(after: after, wait: 25)
                for event in inbox.events { await handle(event, client: client) }
                after = max(after, inbox.next)
            } catch {
                if case APIError.notFound = error { return }
                registered = false
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    func decide(_ request: PairingRequest, approve: Bool) async {
        requests.removeAll { $0.id == request.id }
        guard let client else { return }
        if approve {
            _ = try? await client.approvePairing(id: request.id)
        } else {
            _ = try? await client.denyPairing(id: request.id)
        }
    }

    private func handle(_ event: RemoteInboxEvent, client: RemoteClient) async {
        switch event.kind {
        case "pairing_request":
            let payload = event.payload
            let id = payload?["pairing_id"]?.stringValue ?? event.pairingID ?? ""
            if !id.isEmpty, !requests.contains(where: { $0.id == id }) {
                requests.append(PairingRequest(
                    id: id,
                    controllerName: payload?["controller_name"]?.stringValue ?? "A device",
                    verificationCode: payload?["verification_code"]?.stringValue ?? ""
                ))
            }
            try? await client.ack(eventID: event.id, status: "ok")
        case "pairing_revoked":
            if let id = event.pairingID { requests.removeAll { $0.id == id } }
            try? await client.ack(eventID: event.id, status: "ok")
        case "command":
            let outcome = await execute(RemoteIncomingCommand(event: event))
            try? await client.ack(eventID: event.id, status: outcome.status, detail: outcome.detail)
        default:
            try? await client.ack(eventID: event.id, status: "unsupported")
        }
    }

    private func execute(_ command: RemoteIncomingCommand) async -> (status: String, detail: String?) {
        guard case .playback(let action, let positionMs, let deltaMs, _, _) = command else {
            return ("unsupported", nil)
        }
        guard let engine = playerEngine else { return ("failed", "Nothing is playing") }
        switch action {
        case "play": engine.play()
        case "pause": engine.pause()
        case "toggle":
            if engine.state == .playing { engine.pause() } else { engine.play() }
        case "stop": engine.stop()
        case "seek":
            guard let positionMs else { return ("failed", "Missing position") }
            await engine.seek(to: Double(positionMs) / 1000)
        case "seek_by":
            guard let deltaMs else { return ("failed", "Missing offset") }
            await engine.seek(to: max(0, engine.currentTime + Double(deltaMs) / 1000))
        default:
            return ("unsupported", nil)
        }
        return ("ok", nil)
    }
}

/// Environment hook so the player screen can attach its engine.
private struct TVRemoteTargetKey: EnvironmentKey {
    static let defaultValue: TVRemoteTarget? = nil
}

extension EnvironmentValues {
    var tvRemoteTarget: TVRemoteTarget? {
        get { self[TVRemoteTargetKey.self] }
        set { self[TVRemoteTargetKey.self] = newValue }
    }
}

/// Runs the target loop and shows pairing approval prompts over the app.
struct TVRemoteTargetOverlay: View {
    let apiClient: PlayarrAPIClient
    let target: TVRemoteTarget

    var body: some View {
        ZStack {
            if let request = target.requests.first {
                VStack(spacing: 24) {
                    Text("Allow \(request.controllerName) to control this TV?")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .multilineTextAlignment(.center)
                    Text(request.verificationCode)
                        .font(.system(size: 72, weight: .bold, design: .monospaced))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("Approve only if this code matches the one on the phone.")
                        .font(.callout)
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    HStack(spacing: 32) {
                        Button("Approve") { Task { await target.decide(request, approve: true) } }
                        Button("Deny") { Task { await target.decide(request, approve: false) } }
                    }
                }
                .padding(64)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DesignTokens.Color.backgroundOverlay.ignoresSafeArea())
            }
        }
        .task { await target.run(apiClient: apiClient) }
    }
}
