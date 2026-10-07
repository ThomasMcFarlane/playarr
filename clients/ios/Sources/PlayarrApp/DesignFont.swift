import SwiftUI
import UIKit

/// The web's design fonts, Nunito Sans and JetBrains Mono (SIL Open Font License 1.1, variable builds in
/// `Resources/Fonts`, registered through `UIAppFonts`), built at an exact CSS weight like the web does.
enum DesignFont {
    /// Axes the web leaves at: width 100, optical size 12, `YTLC` 500.
    static let nunitoAxes: [String: Double] = ["wdth": 100, "opsz": 12, "YTLC": 500]

    private static func tag(_ name: String) -> NSNumber {
        var value: UInt32 = 0
        for scalar in name.unicodeScalars { value = (value << 8) | (scalar.value & 0xff) }
        return NSNumber(value: value)
    }

    static func uiFont(family: String, size: CGFloat, weight: Int, fixedAxes: [String: Double]) -> UIFont? {
        let variation = NSMutableDictionary()
        variation[tag("wght")] = NSNumber(value: Double(max(200, min(1000, weight))))
        for (name, value) in fixedAxes { variation[tag(name)] = NSNumber(value: value) }
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: family,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): variation,
        ])
        let font = UIFont(descriptor: descriptor, size: size)
        return font.familyName == family ? font : nil
    }
}

extension DesignFont {
    /// UI text: Nunito Sans at the CSS `weight`, falling back to Avenir Next when the face is unavailable.
    static func font(_ size: CGFloat, _ weight: Int = 400) -> Font {
        if let face = uiFont(family: "Nunito Sans", size: size, weight: weight, fixedAxes: nunitoAxes) {
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
