import PlayarrKit
import SwiftUI

/// Full-screen "not available right now" state shown while the server
/// reports the profile outside its schedule or out of daily watch time.
struct HouseholdBlockedView: View {
    let block: HouseholdBlockState
    let requestState: HouseholdViewModel.RequestState
    let onAskGuardian: () -> Void
    let onSwitchProfile: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "moon.zzz")
                .font(.system(size: 40))
                .foregroundStyle(PlayarrStyle.muted)
            Text(HouseholdCopy.title(for: block))
                .font(.title2.weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
                .multilineTextAlignment(.center)
            Text(HouseholdCopy.description(for: block, formattedUntil: HouseholdFormat.instant(block.until)))
                .font(.body)
                .foregroundStyle(PlayarrStyle.inkSoft)
                .multilineTextAlignment(.center)
            Button(action: onAskGuardian) {
                Text(HouseholdCopy.askGuardian)
                    .font(.headline)
                    .frame(maxWidth: 320)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(PlayarrStyle.pink)
            .disabled(requestState == .sending || requestState == .sent)
            Button(HouseholdCopy.switchProfile, action: onSwitchProfile)
                .buttonStyle(.bordered)
            switch requestState {
            case .sent:
                Text(HouseholdCopy.requestSent)
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .multilineTextAlignment(.center)
            case .failed:
                Text(HouseholdCopy.requestFailed)
                    .font(.footnote)
                    .foregroundStyle(PlayarrStyle.danger)
                    .multilineTextAlignment(.center)
            case .idle, .sending:
                EmptyView()
            }
            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PlayarrStyle.background.ignoresSafeArea())
        .accessibilityElement(children: .contain)
    }
}

/// "N min left" pill for the last hour of a budget or schedule window.
struct HouseholdRemainingBadge: View {
    let minutes: Int

    var body: some View {
        Text(HouseholdCopy.remaining(minutes: minutes))
            .font(.caption.weight(.semibold))
            .foregroundStyle(PlayarrStyle.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(PlayarrStyle.surfaceStrong.opacity(0.92), in: Capsule())
            .overlay { Capsule().stroke(PlayarrStyle.line, lineWidth: 1) }
            .padding(.top, 8)
    }
}
