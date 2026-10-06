import Foundation
import Observation
import PlayarrKit

/// Phone-remote controller: lists the account's controllable devices, pairs
/// with one (the person at the screen approves) and sends commands.
@MainActor
@Observable
public final class RemoteControllerViewModel {
    public enum Phase: Equatable {
        case idle
        case loading
        case failed(String)
    }

    public private(set) var phase: Phase = .idle
    public private(set) var targets: [RemoteTarget] = []
    public private(set) var activePairing: RemotePairing?
    public private(set) var pendingPairing: RemotePairing?
    public private(set) var selectedTarget: RemoteTarget?
    public private(set) var lastCommandMessage: String?

    private let client: RemoteClient
    private let controllerName: String

    public init(apiClient: PlayarrAPIClient, controllerName: String = "Playarr iOS") {
        self.client = RemoteClient(transport: apiClient)
        self.controllerName = controllerName
    }

    /// Targets this phone can pair with, with at least one remote capability.
    public var controllableTargets: [RemoteTarget] {
        targets.filter { !$0.isSelf && !$0.capabilities.isEmpty }
    }

    public func has(_ capability: String) -> Bool {
        activePairing?.scopes.contains(capability) ?? false
    }

    public func load() async {
        phase = .loading
        do {
            targets = try await client.targets()
            phase = .idle
        } catch {
            phase = .failed(Self.message(for: error))
        }
    }

    public func select(_ target: RemoteTarget) async {
        selectedTarget = target
        activePairing = nil
        pendingPairing = nil
        lastCommandMessage = nil
        do {
            let existing = try await client.pairings().first {
                $0.isController && $0.targetDeviceID == target.deviceID && $0.status == "active"
            }
            if let existing {
                activePairing = existing
                return
            }
            pendingPairing = try await client.createPairing(
                targetDeviceID: target.deviceID,
                scopes: target.capabilities,
                controllerName: controllerName
            )
            await waitForApproval()
        } catch {
            phase = .failed(Self.message(for: error))
        }
    }

    /// Polls the pending pairing until the target approves, denies or it expires.
    private func waitForApproval() async {
        while let pending = pendingPairing, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let refreshed = try? await client.pairing(id: pending.id) else { continue }
            switch refreshed.status {
            case "active":
                activePairing = refreshed
                pendingPairing = nil
            case "pending":
                pendingPairing = refreshed
            default:
                pendingPairing = nil
                phase = .failed(refreshed.status == "denied" ? "The device denied the pairing." : "The pairing expired.")
            }
        }
    }

    public func disconnect() async {
        if let pairing = activePairing ?? pendingPairing {
            try? await client.revokePairing(id: pairing.id)
        }
        activePairing = nil
        pendingPairing = nil
        selectedTarget = nil
    }

    public func send(_ command: RemoteCommand.Request) async {
        guard let pairing = activePairing else { return }
        do {
            _ = try await client.send(command, pairingID: pairing.id)
            lastCommandMessage = nil
        } catch APIError.http(let status, let body, _) where status == 409 {
            lastCommandMessage = body?.message ?? "That device is offline."
        } catch {
            lastCommandMessage = Self.message(for: error)
        }
    }

    private static func message(for error: Error) -> String {
        if let api = error as? APIError { return api.displayMessage }
        return error.localizedDescription
    }
}
