import Foundation
import Observation
import PlayarrKit

/// Phone-remote controller: lists the account's controllable devices, pairs
/// with one (the person at the screen approves), sends commands and manages
/// the paired remotes. Mirrors the web `Settings > Phone remote` page.
@MainActor
@Observable
public final class RemoteControllerViewModel {
    public private(set) var targets: [RemoteTarget] = []
    public private(set) var pairings: [RemotePairing] = []
    public private(set) var activePairing: RemotePairing?
    public private(set) var pendingPairing: RemotePairing?
    public private(set) var selectedTarget: RemoteTarget?
    public private(set) var errorMessage: String?
    public private(set) var commandMessage: String?

    private let client: RemoteClient
    private let controllerName: String
    private var approvalTask: Task<Void, Never>?

    public init(apiClient: PlayarrAPIClient, controllerName: String = "Playarr iOS") {
        self.client = RemoteClient(transport: apiClient)
        self.controllerName = controllerName
    }

    /// Other devices on the account (the web page lists every non-self target).
    public var otherTargets: [RemoteTarget] { targets.filter { !$0.isSelf } }

    /// Pairings that are pending or active, as the web "Paired remotes" list shows.
    public var livePairings: [RemotePairing] {
        pairings.filter { $0.status == "active" || $0.status == "pending" }
    }

    public func has(_ capability: String) -> Bool {
        activePairing?.scopes.contains(capability) ?? false
    }

    public func activePairing(for target: RemoteTarget) -> RemotePairing? {
        pairings.first { $0.targetDeviceID == target.deviceID && $0.status == "active" && $0.isController }
    }

    public func deviceName(_ deviceID: String) -> String {
        targets.first { $0.deviceID == deviceID }?.name ?? "Unknown device"
    }

    /// The other end of a pairing from this device's point of view.
    public func label(for pairing: RemotePairing) -> String {
        pairing.isTarget ? pairing.controllerName : deviceName(pairing.targetDeviceID)
    }

    public func load() async {
        do {
            async let loadedTargets = client.targets()
            async let loadedPairings = client.pairings()
            targets = try await loadedTargets
            pairings = try await loadedPairings
        } catch {
            errorMessage = "Could not load remote devices."
        }
    }

    public func select(_ target: RemoteTarget) async {
        errorMessage = nil
        commandMessage = nil
        if let existing = activePairing(for: target) {
            selectedTarget = target
            activePairing = existing
            return
        }
        do {
            let pairing = try await client.createPairing(
                targetDeviceID: target.deviceID,
                scopes: nil,
                controllerName: controllerName
            )
            selectedTarget = target
            if pairing.status == "active" {
                activePairing = pairing
            } else {
                pendingPairing = pairing
                startWaitingForApproval(pairing)
            }
        } catch {
            errorMessage = "Could not start pairing."
        }
    }

    /// Polls the pending pairing until the target approves, denies or it expires.
    private func startWaitingForApproval(_ pairing: RemotePairing) {
        approvalTask?.cancel()
        approvalTask = Task { [weak self] in
            var current = pairing
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard let self, !Task.isCancelled else { return }
                if Date().timeIntervalSince1970 * 1000 >= Double(current.expiresMs) {
                    self.finishWaiting(error: "The pairing was not approved.")
                    return
                }
                // A transient network error keeps waiting until the pairing expires.
                guard let next = try? await self.client.pairing(id: current.id) else { continue }
                current = next
                switch next.status {
                case "pending":
                    continue
                case "active":
                    self.activePairing = next
                    self.pendingPairing = nil
                    await self.load()
                    return
                default:
                    self.finishWaiting(error: "The pairing was not approved.")
                    return
                }
            }
        }
    }

    private func finishWaiting(error: String) {
        pendingPairing = nil
        selectedTarget = nil
        errorMessage = error
    }

    /// Leaves the remote pad without revoking the pairing; cancels a pending request.
    public func closePad() async {
        approvalTask?.cancel()
        if let pending = pendingPairing {
            try? await client.revokePairing(id: pending.id)
        }
        pendingPairing = nil
        activePairing = nil
        selectedTarget = nil
        await load()
    }

    public func revoke(_ pairing: RemotePairing) async {
        do {
            try await client.revokePairing(id: pairing.id)
            if activePairing?.id == pairing.id { activePairing = nil; selectedTarget = nil }
            await load()
        } catch {
            errorMessage = "Could not revoke the pairing."
        }
    }

    public func rename(_ pairing: RemotePairing, to name: String) async -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        do {
            _ = try await client.renamePairing(id: pairing.id, name: String(trimmed.prefix(60)))
            await load()
            return true
        } catch {
            errorMessage = "Could not rename the remote."
            return false
        }
    }

    /// Sends a command, then checks its delivery outcome for a short while so a
    /// failed execution (nothing focused, no text field) is surfaced.
    public func send(_ command: RemoteCommand.Request) async {
        guard let pairing = activePairing else { return }
        commandMessage = nil
        do {
            let accepted = try await client.send(command, pairingID: pairing.id)
            for _ in 0..<6 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                let status = try await client.commandStatus(id: accepted.commandID)
                if status.status == "ok" { return }
                if ["failed", "unsupported", "revoked", "expired"].contains(status.status) {
                    commandMessage = status.detail ?? "That did not work on the device."
                    return
                }
            }
        } catch APIError.http(let status, _, _) where status == 409 {
            commandMessage = "The device is not connected."
        } catch {
            commandMessage = "That did not work on the device."
        }
    }
}
