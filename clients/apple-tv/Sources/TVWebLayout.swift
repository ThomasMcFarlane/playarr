import SwiftUI

/// Building blocks for screens laid out on the web TV grid (1920x1080 stage, CSS pixels
/// measured from the web client's layout). Elements are placed by their CSS box (x, y, w, h);
/// text is centred vertically in its box, as a CSS line box does.
extension View {
    /// Places the view's box at (x, y) inside a top-leading ZStack.
    func placed(
        x: CGFloat,
        y: CGFloat,
        w: CGFloat? = nil,
        h: CGFloat? = nil,
        alignment: Alignment = .leading
    ) -> some View {
        frame(width: w, height: h, alignment: alignment).offset(x: x, y: y)
    }
}

/// Web `.tv-rail-panel` / `.tv-rail-surface`: frosted gradient across the right of the stage.
struct TVRailPanelGradient: View {
    var width: CGFloat

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.35), location: 0.12),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.55), location: 0.34),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.72), location: 0.62),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.78), location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(width: width)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Web page header: round back button, h1 and an optional detail after a hairline divider.
struct TVPageHeader: View {
    var title: String
    var detail: String? = nil
    /// Settings shows the back button focused (white disc, dark arrow).
    var backFocused = false
    /// Gap between the title and the detail text (23 on lists, 47 on detail pages).
    var detailGap: CGFloat = 23
    var showsDivider = true

    var body: some View {
        ZStack(alignment: .topLeading) {
            let size: CGFloat = backFocused ? 52.8 : 50
            let origin: CGFloat = backFocused ? 152.2 : 153.6
            Circle()
                .fill(backFocused ? DesignTokens.Color.textPrimary : DesignTokens.Color.backgroundElevated.opacity(0.7))
                .overlay(
                    Circle().stroke(
                        DesignTokens.Color.borderDefault.opacity(backFocused ? 0 : 0.35),
                        lineWidth: 1
                    )
                )
                .overlay(
                    Text("\u{2190}")
                        .font(TVTheme.font(size: 17.3, weight: .semibold))
                        .foregroundStyle(backFocused ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textSecondary)
                )
                .placed(x: origin, y: backFocused ? 54.8 : 56.2, w: size, h: size)
            HStack(spacing: 0) {
                Text(title)
                    .font(TVTheme.font(size: 33.6, weight: .medium))
                    .tracking(-1.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .fixedSize()
                if let detail {
                    if showsDivider {
                        Rectangle()
                            .fill(DesignTokens.Color.borderDefault.opacity(0.55))
                            .frame(width: 1, height: 14)
                            .padding(.horizontal, (detailGap - 1) / 2)
                    } else {
                        Spacer().frame(width: detailGap)
                    }
                    Text(detail.uppercased())
                        .font(TVTheme.font(size: 11.1, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .fixedSize()
                }
            }
            .placed(x: 226.6, y: 56.2, h: 50.4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
