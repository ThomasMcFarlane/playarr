import SwiftUI

/// Byte-stable mirror of `clients/tv-web/packages/design-tokens/src/index.ts`.
/// Keep values in lock-step with that file — it is the design source of truth
/// for the TV surface. When tokens change upstream, update this file to match.
enum DesignTokens {
    enum Color {
        // background
        static let backgroundBase = SwiftUI.Color(red: 0x20 / 255, green: 0x20 / 255, blue: 0x20 / 255)
        static let backgroundElevated = SwiftUI.Color(red: 0x2a / 255, green: 0x2a / 255, blue: 0x2a / 255)
        static let backgroundRaised = SwiftUI.Color(red: 0x33 / 255, green: 0x33 / 255, blue: 0x33 / 255)
        static let backgroundOverlay = SwiftUI.Color.black.opacity(0.7)
        static let backgroundInputDisabled = SwiftUI.Color(red: 0x22 / 255, green: 0x22 / 255, blue: 0x22 / 255)

        // text
        static let textPrimary = SwiftUI.Color(red: 0xcc / 255, green: 0xcc / 255, blue: 0xcc / 255)
        static let textSecondary = SwiftUI.Color(red: 0x99 / 255, green: 0x99 / 255, blue: 0x99 / 255)
        static let textDisabled = SwiftUI.Color(red: 0x90 / 255, green: 0x92 / 255, blue: 0x93 / 255)
        static let textHelp = textDisabled
        static let textInverse = SwiftUI.Color.white

        // brand
        static let brandPrimary = SwiftUI.Color(red: 0x5d / 255, green: 0x9c / 255, blue: 0xec / 255)
        static let brandPrimaryHover = SwiftUI.Color(red: 0x7b / 255, green: 0xad / 255, blue: 0xf0 / 255)
        static let brandPrimaryPressed = SwiftUI.Color(red: 0x4a / 255, green: 0x84 / 255, blue: 0xd1 / 255)
        static let brandAccent = SwiftUI.Color(red: 0xe5 / 255, green: 0x48 / 255, blue: 0x4d / 255)

        // focus
        static let focusRing = brandPrimary
        static let focusRingOffset = backgroundElevated

        // state
        static let stateSuccess = SwiftUI.Color(red: 0x27 / 255, green: 0xc2 / 255, blue: 0x4c / 255)
        static let stateWarning = SwiftUI.Color(red: 0xff / 255, green: 0xa5 / 255, blue: 0x00 / 255)
        static let stateError = SwiftUI.Color(red: 0xf0 / 255, green: 0x50 / 255, blue: 0x50 / 255)
        static let stateInfo = brandPrimary
        static let stateQueue = SwiftUI.Color(red: 0x7a / 255, green: 0x43 / 255, blue: 0xb6 / 255)

        // border / shadow
        static let borderDefault = SwiftUI.Color(red: 0x85 / 255, green: 0x85 / 255, blue: 0x85 / 255)
        static let shadow = SwiftUI.Color(red: 0x11 / 255, green: 0x11 / 255, blue: 0x11 / 255)
    }

    enum Spacing {
        static let none: CGFloat = 0
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
        static let xxxl: CGFloat = 64
    }

    enum Radius {
        static let none: CGFloat = 0
        static let sm: CGFloat = 4
        static let md: CGFloat = 6
        static let lg: CGFloat = 8
        static let full: CGFloat = 9999
        static let card: CGFloat = 3
        static let button: CGFloat = 4
        static let input: CGFloat = 4
        static let badge: CGFloat = 2
        static let pill: CGFloat = 9999
        static let modal: CGFloat = 6
    }

    enum TypeScale {
        static let microSize: CGFloat = 11
        static let captionSize: CGFloat = 12
        static let bodySize: CGFloat = 14
        static let subtitleSize: CGFloat = 18
        static let titleSize: CGFloat = 24
        static let displaySize: CGFloat = 50

        static let microWeight: Font.Weight = .regular
        static let captionWeight: Font.Weight = .regular
        static let bodyWeight: Font.Weight = .regular
        static let bodyEmphasisWeight: Font.Weight = .bold
        static let subtitleWeight: Font.Weight = .light
        static let titleWeight: Font.Weight = .bold
        static let displayWeight: Font.Weight = .light
    }

    enum FocusMotion {
        static let restScale: CGFloat = 1
        static let focusScale: CGFloat = 1.08
        static let transitionSeconds: Double = 0.15
    }

    /// Hex strings for structural tests and parity evidence (must match design-tokens).
    enum Hex {
        static let backgroundBase = "#202020"
        static let backgroundElevated = "#2a2a2a"
        static let backgroundRaised = "#333333"
        static let textPrimary = "#cccccc"
        static let textSecondary = "#999999"
        static let brandPrimary = "#5d9cec"
        static let brandAccent = "#e5484d"
        static let focusRing = "#5d9cec"
        static let stateError = "#f05050"
        static let stateSuccess = "#27c24c"
        static let borderDefault = "#858585"
    }
}
