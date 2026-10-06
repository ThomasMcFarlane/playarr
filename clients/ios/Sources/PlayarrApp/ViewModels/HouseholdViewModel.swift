import Foundation
import Observation
import PlayarrKit

/// Tracks the signed-in profile's household state so the shell can show the
/// blocked screen and the "N min left" badge. The server remains the
/// authority; this only mirrors `GET /api/v1/household/status`.
@MainActor
@Observable
public final class HouseholdViewModel {
    public enum RequestState: Equatable {
        case idle
        case sending
        case sent
        case failed
    }

    public private(set) var status: HouseholdStatus?
    public private(set) var requestState: RequestState = .idle
    public private(set) var now = Date()

    private let client: HouseholdClient

    public init(apiClient: PlayarrAPIClient) {
        self.client = HouseholdClient(transport: apiClient)
    }

    public var block: HouseholdBlockState? { HouseholdBlockState(status: status) }

    public var remainingMinutes: Int? {
        HouseholdFormat.remainingMinutes(status: status, now: now)
    }

    public func refresh() async {
        do {
            status = try await client.status()
            now = Date()
            if block == nil { requestState = .idle }
        } catch {
            // A server without household support, or a transient failure,
            // leaves the last known state in place rather than blocking.
            if case APIError.notFound = error { status = nil }
        }
    }

    /// A playback or catalogue request came back `403 household_blocked`.
    public func noteBlocked(by error: Error) {
        guard let blocked = HouseholdBlock.parse(error: error) else { return }
        switch blocked {
        case .outsideSchedule(let next):
            status = HouseholdStatus(restricted: true, state: "outside_schedule", nextStartAt: next)
        case .budgetExhausted(let reset):
            status = HouseholdStatus(restricted: true, state: "budget_exhausted", resetsAt: reset)
        case .content:
            break
        }
    }

    public func askGuardian() async {
        guard let block, requestState != .sending else { return }
        requestState = .sending
        do {
            _ = try await client.requestApproval(subject: block.approvalSubject)
            requestState = .sent
        } catch {
            requestState = .failed
        }
    }

    /// Re-checks every minute while the view is on screen.
    public func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: 60_000_000_000)
        }
    }
}
