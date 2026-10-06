import Foundation
import Observation

/// Main-actor hub between the live stream and the screens that show data.
/// Each `LiveArea` has a generation counter that increases when something
/// shown in that area may have changed; views observe it and refetch in place.
/// While the stream is down or unsupported it also ticks every `pollInterval`
/// seconds (fallback polling), and once on reconnect or resync.
@MainActor
@Observable
public final class LiveEventsHub {
    public private(set) var state: LiveConnectionState = .idle
    public private(set) var generations: [LiveArea: Int] = [:]

    @ObservationIgnored private var connection: LiveEventsConnection?
    @ObservationIgnored private var connectionKey: String?

    public init() {}

    public func generation(of area: LiveArea) -> Int {
        generations[area, default: 0]
    }

    /// Sum of the generations of `areas`: changes whenever any of them is invalidated.
    public func signature(of areas: [LiveArea]) -> Int {
        areas.reduce(0) { $0 + generation(of: $1) }
    }

    public func apply(_ invalidation: LiveInvalidation) {
        for area in invalidation.affectedAreas {
            generations[area, default: 0] += 1
        }
    }

    /// Runs until the calling task is cancelled (background, sign-out). `resetKey`
    /// identifies the server and account: a different key drops the cursor.
    public func run(
        transport: any PlayarrRequestTransport,
        resetKey: String,
        pollInterval: Double = 30
    ) async {
        let existing = connection
        let active: LiveEventsConnection
        if let existing, connectionKey == resetKey {
            active = existing
        } else {
            active = LiveEventsConnection(transport: transport)
            connection = active
            connectionKey = resetKey
        }
        let poller = Task { [weak self] in
            await self?.pollLoop(interval: pollInterval)
        }
        await active.run(
            onState: { [weak self] newState in await self?.setState(newState) },
            onEvent: { [weak self] event in await self?.handle(event) }
        )
        if state == .unsupported {
            await withTaskCancellationHandler(
                operation: { await poller.value },
                onCancel: { poller.cancel() }
            )
        } else {
            poller.cancel()
        }
    }

    public func setState(_ newState: LiveConnectionState) {
        let previous = state
        state = newState
        if newState == .connected && (previous == .reconnecting) {
            apply(LiveInvalidation(poll: true))
        }
    }

    public func handle(_ event: LiveEvent) {
        if let invalidation = LiveEventMapper.invalidation(for: event) {
            apply(invalidation)
        }
    }

    private func pollLoop(interval: Double) async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            } catch {
                return
            }
            if state != .connected && state != .idle {
                apply(LiveInvalidation(poll: true))
            }
        }
    }
}
