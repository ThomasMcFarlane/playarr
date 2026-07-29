import SwiftUI
import UIKit

/// Embedded raster of `playarr-icon.svg` (84×84 @2x) for the shell logo.
enum PlayarrLogoAsset {
    static let pngBase64 =
        "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"

    static var image: Image {
        guard let data = Data(base64Encoded: pngBase64),
              let ui = UIImage(data: data) else {
            return Image(systemName: "play.circle.fill")
        }
        return Image(uiImage: ui)
    }
}
