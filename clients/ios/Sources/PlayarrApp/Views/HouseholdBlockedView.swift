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
            Circle()
                .fill(WM.chip.opacity(0.66))
                .overlay(Circle().stroke(WM.line.opacity(0.14), lineWidth: 1))
                .overlay {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 34, weight: .light))
                        .foregroundStyle(WM.pink)
                }
                .frame(width: 116, height: 116)
                .offset(x: 47, y: 101)
            WMText(HouseholdCopy.title(for: block), 14.4, 650, lh: 21.6, ls: -0.288)
                .frame(width: 158, alignment: .leading)
                .offset(x: 185, y: 139)
            Text(HouseholdCopy.description(for: block, formattedUntil: HouseholdFormat.instant(block.until)))
                .font(WM.font(7.68))
                .foregroundStyle(WM.muted)
                .lineLimit(2)
                .frame(width: 151, alignment: .leading)
                .offset(x: 185, y: 168)
            outlinedButton(HouseholdCopy.askGuardian, width: 258, action: onAskGuardian)
                .disabled(requestState == .sending || requestState == .sent)
                .offset(x: 66, y: 237)
            outlinedButton(HouseholdCopy.switchProfile, width: 145, action: onSwitchProfile)
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
        .background(WM.page.ignoresSafeArea())
        .accessibilityElement(children: .contain)
    }

    private func outlinedButton(_ title: String, width: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(WM.font(16))
                .foregroundStyle(WM.ink)
                .frame(width: width, height: 48)
                .overlay(Capsule().stroke(WM.ink.opacity(0.9), lineWidth: 1))
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
