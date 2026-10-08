import PlayarrKit
import SwiftUI

/// Full-screen "not available right now" state shown while the server
/// reports the profile outside its schedule or out of daily watch time.
struct HouseholdBlockedView: View {
    let block: HouseholdBlockState
    let requestState: HouseholdViewModel.RequestState
    let onAskGuardian: () -> Void
    let onSwitchProfile: () -> Void

    /// Web mobile "not available" empty state: icon medallion with the copy to
    /// its right, then two outlined pill buttons (numbers from the web layout).
    var body: some View {
        ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            WMEmptyStateRow(
                title: HouseholdCopy.title(for: block),
                description: HouseholdCopy.description(for: block, formattedUntil: HouseholdFormat.instant(block.until)),
                lines: 1
            )
            .offset(x: 52, y: 101)
            outlinedButton(HouseholdCopy.askGuardian, width: 254, action: onAskGuardian)
                .disabled(requestState == .sending || requestState == .sent)
                .offset(x: 68, y: 237)
            outlinedButton(HouseholdCopy.switchProfile, width: 146, action: onSwitchProfile)
                .offset(x: 122, y: 297)
            switch requestState {
            case .sent:
                note(HouseholdCopy.requestSent, color: WM.inkSoft).offset(x: 66, y: 357)
            case .failed:
                note(HouseholdCopy.requestFailed, color: PlayarrStyle.danger).offset(x: 66, y: 357)
            case .idle, .sending:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(alignment: .topLeading) {
            // Behind the content so its 660 pt size never widens the layout.
            RadialGradient(
                colors: [WM.pink.opacity(0.05), WM.pink.opacity(0)],
                center: .center, startRadius: 0, endRadius: 330
            )
            .frame(width: 660, height: 660)
            .offset(x: -35, y: 20)
            .allowsHitTesting(false)
        }
        .background(WM.page.ignoresSafeArea())
        .accessibilityElement(children: .contain)
    }

    private func outlinedButton(_ title: String, width: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(WM.font(16))
                .foregroundStyle(WM.ink)
                .frame(width: width, height: 48)
                .overlay(Capsule().strokeBorder(WM.ink.opacity(0.9), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func note(_ text: String, color: Color) -> some View {
        Text(text)
            .font(WM.font(9))
            .foregroundStyle(color)
            .multilineTextAlignment(.leading)
            .frame(width: 258, alignment: .leading)
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
