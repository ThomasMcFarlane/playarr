import PlayarrKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Neutral placeholder artwork for the Apple TV visual parity suite.
///
/// Every image is generated procedurally (a deterministic gradient derived from a seed string), so
/// the repository carries no third-party artwork. Real catalogue art is always loaded from the
/// server at runtime and never bundled.
enum TVParityArtwork {
    static var heroImage: Image? {
        gradientImage(seed: "hero", size: CGSize(width: 1920, height: 1080))
    }

    /// Library-directory hero placeholders per kind.
    static func libraryHero(kind: WorkKind) -> Image? {
        switch kind {
        case .artist: return gradientImage(seed: "hero-music", size: CGSize(width: 960, height: 1080))
        case .series, .author: return gradientImage(seed: "hero-series", size: CGSize(width: 960, height: 1080))
        case .movie: return gradientImage(seed: "hero-movie", size: CGSize(width: 960, height: 1080))
        default: return heroImage
        }
    }

    static func cardImage(forTitle title: String) -> Image? {
        gradientImage(seed: "card-\(title)", size: CGSize(width: 640, height: 360))
    }

    /// Cast headshot placeholders.
    static func castImage(index: Int) -> Image? {
        gradientImage(seed: "cast-\(index)", size: CGSize(width: 320, height: 320))
    }

    /// Deterministic (FNV-1a) hash so captures are identical between runs.
    private static func hash(_ seed: String) -> UInt64 {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in seed.utf8 {
            h ^= UInt64(byte)
            h = h &* 0x0000_0100_0000_01b3
        }
        return h
    }

    private static func gradientImage(seed: String, size: CGSize) -> Image? {
        // Fixture screens only: live routes show the server's own artwork (or the text tile).
        guard TVParityLaunch.requestedScreen != nil else { return nil }
        let h = hash(seed)
        func hue(_ shift: UInt64) -> CGFloat { CGFloat((h >> shift) & 0xff) / 255.0 }
        let top = UIColor(hue: hue(0), saturation: 0.45, brightness: 0.42, alpha: 1)
        let bottom = UIColor(hue: hue(8), saturation: 0.55, brightness: 0.18, alpha: 1)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let ui = renderer.image { ctx in
            let colors = [top.cgColor, bottom.cgColor] as CFArray
            guard let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 1]
            ) else { return }
            ctx.cgContext.drawLinearGradient(
                gradient,
                start: .zero,
                end: CGPoint(x: size.width * 0.3, y: size.height),
                options: []
            )
        }
        return Image(uiImage: ui)
    }
}
