import Observation
import PlayarrKit
import SwiftUI

/// Mirrors the signed-in profile's household state on Apple TV: a full-screen
/// blocked state outside the schedule or once the daily budget is used up, and
/// an "N min left" pill in the last hour. The server stays the authority.
@MainActor
@Observable
final class TVHouseholdModel {
    enum RequestState: Equatable {
        case idle
        case sending
        case sent
        case failed
    }

    private(set) var status: HouseholdStatus?
    private(set) var requestState: RequestState = .idle
    private(set) var now = Date()

    private let client: HouseholdClient

    init(apiClient: PlayarrAPIClient) {
        self.client = HouseholdClient(transport: apiClient)
    }

    var block: HouseholdBlockState? { HouseholdBlockState(status: status) }

    var remainingMinutes: Int? {
        HouseholdFormat.remainingMinutes(status: status, now: now)
    }

    func refresh() async {
        do {
            status = try await client.status()
            now = Date()
            if block == nil { requestState = .idle }
        } catch {
            if case APIError.notFound = error { status = nil }
        }
    }

    func askGuardian() async {
        guard let block, requestState != .sending else { return }
        requestState = .sending
        do {
            _ = try await client.requestApproval(subject: block.approvalSubject)
            requestState = .sent
        } catch {
            requestState = .failed
        }
    }

    func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: 60_000_000_000)
        }
    }
}

struct TVHouseholdOverlay: View {
    @State private var model: TVHouseholdModel

    init(apiClient: PlayarrAPIClient) {
        _model = State(initialValue: TVHouseholdModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            if let block = model.block {
                blocked(block)
            } else if let minutes = model.remainingMinutes {
                VStack {
                    Text(HouseholdCopy.remaining(minutes: minutes))
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 10)
                        .background(DesignTokens.Color.backgroundRaised, in: Capsule())
                        .padding(.top, 40)
                    Spacer()
                }
                .allowsHitTesting(false)
            }
        }
        .task { await model.poll() }
    }

    private func blocked(_ block: HouseholdBlockState) -> some View {
        VStack(spacing: 28) {
            Text(HouseholdCopy.title(for: block))
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text(HouseholdCopy.description(for: block, formattedUntil: HouseholdFormat.instant(block.until)))
                .font(.title3)
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .multilineTextAlignment(.center)
            Button(HouseholdCopy.askGuardian) {
                Task { await model.askGuardian() }
            }
            .disabled(model.requestState == .sending || model.requestState == .sent)
            Button("Check again") {
                Task { await model.refresh() }
            }
            switch model.requestState {
            case .sent:
                Text(HouseholdCopy.requestSent)
                    .font(.callout)
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            case .failed:
                Text(HouseholdCopy.requestFailed)
                    .font(.callout)
                    .foregroundStyle(DesignTokens.Color.stateError)
            case .idle, .sending:
                EmptyView()
            }
        }
        .padding(80)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.Color.backgroundBase.ignoresSafeArea())
    }
}
