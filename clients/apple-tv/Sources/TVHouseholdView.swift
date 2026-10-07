import PlayarrKit
import SwiftUI

/// Full-stage state shown instead of the app while the household blocks the profile
/// (web `HouseholdBlockedScreen`): the profile cannot watch outside its schedule or past its budget.
struct TVHouseholdBlockedView: View {
    @Environment(TVAppEnvironment.self) private var environment

    var body: some View {
        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundBase.ignoresSafeArea()
            // `.tv-empty-state-art`: a 164 disc with the "details" graphic.
            Circle()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.54))
                .overlay(Circle().stroke(DesignTokens.Color.borderDefault.opacity(0.5), lineWidth: 1))
                .placed(x: 736.1, y: 129.6, w: 164, h: 164)
            TVDetailsGraphic()
                .stroke(DesignTokens.Color.brandPrimary, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
                .frame(width: 70, height: 46.7)
                .placed(x: 783.1, y: 188.3, w: 70, h: 46.7)
            Text("Not available right now")
                .font(TVTheme.font(size: 22.08, weight: .semibold))
                .tracking(-0.44)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .placed(x: 942.1, y: 183.4, w: 300, h: 33.1)
            Text("This profile can\u{2019}t watch at this time.")
                .font(TVTheme.font(size: 10.75, weight: .regular))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 942.1, y: 223.7, w: 300, h: 16.1)
            actionButton("Ask a guardian for more time", x: 721.1, width: 300.7)
            actionButton("Switch profile", x: 1033.8, width: 165.2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
    }

    private func actionButton(_ label: String, x: CGFloat, width: CGFloat) -> some View {
        Text(label)
            .font(TVTheme.font(size: 19.2, weight: .regular))
            .foregroundStyle(DesignTokens.Color.textPrimary)
            .frame(width: width, height: 50)
            .overlay(Capsule().stroke(DesignTokens.Color.textPrimary, lineWidth: 1.5))
            .placed(x: x, y: 313.6, w: width, h: 50)
    }
}

/// Web `TvEmptyState` "details" graphic (48 x 32 view box): a card with text lines and a dot.
struct TVDetailsGraphic: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 48
        let sy = rect.height / 32
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        var path = Path()
        path.addRoundedRect(
            in: CGRect(x: rect.minX + 7 * sx, y: rect.minY + 5 * sy, width: 34 * sx, height: 22 * sy),
            cornerSize: CGSize(width: 3 * sx, height: 3 * sy)
        )
        path.move(to: p(13, 12)); path.addLine(to: p(27, 12))
        path.move(to: p(13, 17)); path.addLine(to: p(33, 17))
        path.move(to: p(13, 22)); path.addLine(to: p(25, 22))
        path.addEllipse(in: CGRect(x: rect.minX + 33 * sx, y: rect.minY + 9 * sy, width: 4 * sx, height: 4 * sy))
        return path
    }
}
