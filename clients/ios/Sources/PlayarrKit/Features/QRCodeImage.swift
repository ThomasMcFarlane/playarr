import CoreGraphics
import CoreImage
import Foundation

/// Renders a QR code locally (no network, so a one-time transfer link is never
/// sent to a third-party image service).
public enum QRCodeImage {
    public static func make(from text: String, scale: Int = 8) -> CGImage? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: CGFloat(scale), y: CGFloat(scale)))
        return CIContext().createCGImage(scaled, from: scaled.extent)
    }
}
