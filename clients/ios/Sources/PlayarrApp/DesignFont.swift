import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The web's design fonts, Nunito Sans and JetBrains Mono (SIL Open Font License 1.1, variable builds in
/// `Resources/Fonts`, registered through `UIAppFonts`), built at an exact CSS weight like the web does.
enum DesignFont {
    /// `NunitoSans-wght-web.ttf` is the web's exact Nunito Sans instance with the width, optical-size
    /// and `YTLC` axes already baked in, so only the weight is set (its default is 200).
    static let nunitoAxes: [String: Double] = [:]

    private static func tag(_ name: String) -> NSNumber {
        var value: UInt32 = 0
        for scalar in name.unicodeScalars { value = (value << 8) | (scalar.value & 0xff) }
        return NSNumber(value: value)
    }

    /// PostScript name of the web-instance file's default face (`NunitoSans-wght-web.ttf`); the
    /// typographic family is "Nunito Sans 12pt", so the face is requested by this exact name.
    static let nunitoPostScriptName = "NunitoSans-12ptExtraLight"

    /// Builds the face and sets the weight axis. `postScriptName` (when given) selects the file's face
    /// exactly; otherwise `family` does. Returns nil, never a substitute, when the bundled font is not
    /// registered.
    static func uiFont(
        family: String,
        postScriptName: String? = nil,
        size: CGFloat,
        weight: Int,
        fixedAxes: [String: Double]
    ) -> UIFont? {
        let variation = NSMutableDictionary()
        variation[tag("wght")] = NSNumber(value: Double(max(200, min(1000, weight))))
        for (name, value) in fixedAxes { variation[tag(name)] = NSNumber(value: value) }
        var attributes: [UIFontDescriptor.AttributeName: Any] = [
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): variation,
        ]
        if let postScriptName { attributes[.name] = postScriptName } else { attributes[.family] = family }
        // `as UIFont?`: AppKit's initialiser (the macOS app aliases UIFont to NSFont) is failable.
        guard let font = UIFont(descriptor: UIFontDescriptor(fontAttributes: attributes), size: size) as UIFont? else { return nil }
        // An unregistered name makes UIKit answer with a substitute (system font or Helvetica).
        // The typographic family may carry an optical-size suffix ("Nunito Sans 12pt").
        return (font.familyName as String?)?.hasPrefix(family) == true ? font : nil
    }
}

extension DesignFont {
    /// UI text: Nunito Sans at the CSS `weight`, falling back to Avenir Next when the face is unavailable.
    static func font(_ size: CGFloat, _ weight: Int = 400) -> Font {
        if let face = uiFont(family: "Nunito Sans", postScriptName: nunitoPostScriptName, size: size, weight: weight, fixedAxes: nunitoAxes) {
            return Font(face as CTFont)
        }
        return .custom("Avenir Next", fixedSize: size)
    }

    /// Monospace runs (the version label): JetBrains Mono at the CSS `weight`.
    static func mono(_ size: CGFloat, _ weight: Int = 400) -> Font {
        if let face = uiFont(family: "JetBrains Mono", size: size, weight: weight, fixedAxes: [:]) {
            return Font(face as CTFont)
        }
        return .system(size: size, design: .monospaced)
    }
}
