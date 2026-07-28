import SwiftUI

/// Shared chrome helpers for the Apple TV surface. Layout numbers come from
/// `DesignTokens` (mirror of `@playarr-tv/design-tokens`).
enum TVTheme {
    static let canvasWidth: CGFloat = 1920
    static let canvasHeight: CGFloat = 1080

    /// Poster / work tile size used by `BrowseScreen` work tiles (240×135 landscape
    /// thumbs in ui-tv) and the larger portrait posters on the native home shelf.
    static let workTileWidth: CGFloat = 240
    static let workTileHeight: CGFloat = 135
    static let posterCardWidth: CGFloat = 250
    static let posterCardHeight: CGFloat = 360

    static let pagePadding = DesignTokens.Spacing.xxxl
    static let sectionGap = DesignTokens.Spacing.xl
    static let tileGap = DesignTokens.Spacing.md

    static func displayFont() -> Font {
        .system(size: DesignTokens.TypeScale.displaySize, weight: DesignTokens.TypeScale.displayWeight)
    }

    static func titleFont() -> Font {
        .system(size: DesignTokens.TypeScale.titleSize, weight: DesignTokens.TypeScale.titleWeight)
    }

    static func subtitleFont() -> Font {
        .system(size: DesignTokens.TypeScale.subtitleSize, weight: DesignTokens.TypeScale.subtitleWeight)
    }

    static func bodyFont(emphasis: Bool = false) -> Font {
        .system(
            size: DesignTokens.TypeScale.bodySize,
            weight: emphasis ? DesignTokens.TypeScale.bodyEmphasisWeight : DesignTokens.TypeScale.bodyWeight
        )
    }

    static func captionFont() -> Font {
        .system(size: DesignTokens.TypeScale.captionSize, weight: DesignTokens.TypeScale.captionWeight)
    }
}

/// Full-bleed dark stage background matching `color.background.base`.
struct TVStageBackground: View {
    var body: some View {
        DesignTokens.Color.backgroundBase.ignoresSafeArea()
    }
}

/// Primary action button styled like ui-tv `ActionButton` (brand primary fill).
struct TVPrimaryButton: View {
    let label: String
    var isFocused: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.xl)
                .padding(.vertical, DesignTokens.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                        .fill(DesignTokens.Color.brandPrimary)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                        .stroke(
                            isFocused ? DesignTokens.Color.focusRing : Color.clear,
                            lineWidth: 3
                        )
                )
                .scaleEffect(isFocused ? DesignTokens.FocusMotion.focusScale : DesignTokens.FocusMotion.restScale)
                .animation(
                    .timingCurve(0.4, 0, 0.2, 1, duration: DesignTokens.FocusMotion.transitionSeconds),
                    value: isFocused
                )
        }
        .buttonStyle(.plain)
    }
}

/// Secondary raised surface button (ui-tv non-primary ActionButton).
struct TVSecondaryButton: View {
    let label: String
    var isFocused: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.xl)
                .padding(.vertical, DesignTokens.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                        .fill(DesignTokens.Color.backgroundRaised)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.sm, style: .continuous)
                        .stroke(
                            isFocused ? DesignTokens.Color.focusRing : Color.clear,
                            lineWidth: 3
                        )
                )
                .scaleEffect(isFocused ? 1.05 : 1)
        }
        .buttonStyle(.plain)
    }
}
