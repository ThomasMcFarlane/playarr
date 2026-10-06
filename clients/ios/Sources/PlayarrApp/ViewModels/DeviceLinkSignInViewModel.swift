import Foundation
import Observation
import PlayarrKit

/// Drives the "Sign in with a QR code" sheet: starts the hosted link flow,
/// mirrors its state for the view, and hands the result to `AppEnvironment`.
@MainActor
@Observable
final class DeviceLinkSignInViewModel {
    private(set) var state: DeviceLinkSignInState = .idle
    private(set) var isComplete = false

    @ObservationIgnored private let environment: AppEnvironment
    @ObservationIgnored private var task: Task<Void, Never>?

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    func start() {
        guard task == nil else { return }
        state = .requestingCode
        task = Task { [weak self] in
            await self?.runFlow()
        }
    }

    /// Cancels any running flow (sheet dismissed or the user chose cancel).
    func cancel() {
        task?.cancel()
        task = nil
        if !isComplete { state = .idle }
    }

    func retry() {
        task?.cancel()
        task = nil
        start()
    }

    private func runFlow() async {
        let box = StateBox(self)
        do {
            let result = try await DeviceLinkSignIn.run(
                broker: HostedDeviceLinkClient(configuration: HostedDeviceLinkConfiguration(clientPlatform: .ios)),
                makeAuthorizer: { url in
                    DeviceFlowClient(configuration: DeviceFlowConfiguration(baseURL: url, clientPlatform: .ios))
                },
                normaliseServerURL: { raw in try? LoginServerURL.normalise(raw) },
                onState: { newState in box.publish(newState) }
            )
            try await environment.completeDeviceLinkSignIn(result)
            isComplete = true
            state = .idle
        } catch is CancellationError {
            return
        } catch let failure as DeviceLinkFailure {
            state = .failed(failure)
        } catch {
            state = .failed(.network(error.localizedDescription))
        }
        task = nil
    }

    /// Bridges the `@Sendable` state callback back onto the main actor.
    private final class StateBox: @unchecked Sendable {
        private weak var model: DeviceLinkSignInViewModel?
        init(_ model: DeviceLinkSignInViewModel) { self.model = model }
        func publish(_ state: DeviceLinkSignInState) {
            Task { @MainActor [weak model] in
                guard let model, !model.isComplete else { return }
                if case .failed = model.state { return }
                model.state = state
            }
        }
    }
}
