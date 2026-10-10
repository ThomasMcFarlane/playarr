import AppKit
import AVFoundation
import AVKit
import SwiftUI

// The one place the macOS app maps the UIKit and tvOS-only names the shared Apple TV sources use onto AppKit and
// SwiftUI-on-macOS. The shared sources stay tvOS code; this file is compiled into the macOS target only.

typealias UIImage = NSImage
typealias UIColor = NSColor
typealias UIFont = NSFont
typealias UIFontDescriptor = NSFontDescriptor

extension NSImage {
    convenience init(cgImage: CGImage) {
        self.init(cgImage: cgImage, size: NSSize(width: cgImage.width, height: cgImage.height))
    }

    func pngData() -> Data? {
        guard let cg = cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        return NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
    }
}

extension NSFont {
    /// UIKit's `lineHeight`: ascender plus descender plus leading.
    var lineHeight: CGFloat { ascender - descender + leading }
}

extension Image {
    init(uiImage: NSImage) { self.init(nsImage: uiImage) }
}

/// UIKit's light/dark trait, resolved from the view's effective appearance.
enum UIUserInterfaceStyle { case light, dark }
struct UITraitCollection { let userInterfaceStyle: UIUserInterfaceStyle }

extension NSColor {
    /// `UIColor { traits in ... }`: a colour that follows the appearance (SwiftUI's colour scheme sets it).
    convenience init(dynamicProvider: @escaping @Sendable (UITraitCollection) -> NSColor) {
        self.init(name: nil) { appearance in
            let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return dynamicProvider(UITraitCollection(userInterfaceStyle: dark ? .dark : .light))
        }
    }
}

/// `UIGraphicsImageRenderer` for the fixture artwork: a bitmap context with a top-left origin, like UIKit's.
final class UIGraphicsImageRendererFormat {
    var scale: CGFloat = 1
    static func `default`() -> UIGraphicsImageRendererFormat { UIGraphicsImageRendererFormat() }
}

struct UIGraphicsImageRendererContext { let cgContext: CGContext }

struct UIGraphicsImageRenderer {
    let size: CGSize
    let format: UIGraphicsImageRendererFormat

    init(size: CGSize, format: UIGraphicsImageRendererFormat) {
        self.size = size
        self.format = format
    }

    func image(_ actions: (UIGraphicsImageRendererContext) -> Void) -> NSImage {
        let w = max(1, Int((size.width * format.scale).rounded())), h = max(1, Int((size.height * format.scale).rounded()))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return NSImage(size: size) }
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: format.scale, y: -format.scale)
        actions(UIGraphicsImageRendererContext(cgContext: ctx))
        guard let cg = ctx.makeImage() else { return NSImage(size: size) }
        return NSImage(cgImage: cg, size: size)
    }
}

/// Idle timer and background tasks. macOS does not suspend the app, so a background task is a no-op; keeping the
/// display awake during playback uses a process activity.
struct UIBackgroundTaskIdentifier: Equatable {
    let raw: Int
    static let invalid = UIBackgroundTaskIdentifier(raw: 0)
}

@MainActor
final class UIApplication {
    static let shared = UIApplication()
    private var awake: NSObjectProtocol?

    var isIdleTimerDisabled: Bool {
        get { awake != nil }
        set {
            if newValue, awake == nil {
                awake = ProcessInfo.processInfo.beginActivity(options: [.idleDisplaySleepDisabled, .userInitiated],
                                                              reason: "Playarr playback")
            } else if !newValue, let token = awake {
                ProcessInfo.processInfo.endActivity(token)
                awake = nil
            }
        }
    }

    func beginBackgroundTask(withName name: String?, expirationHandler: (() -> Void)? = nil) -> UIBackgroundTaskIdentifier {
        UIBackgroundTaskIdentifier(raw: 1)
    }

    func endBackgroundTask(_ identifier: UIBackgroundTaskIdentifier) {}
}

extension NSColor {
    /// `Color.tvMix` reads components: AppKit only answers `getRed` for an RGB colour, so resolve to sRGB first.
    var rgbForMix: NSColor { usingColorSpace(.sRGB) ?? .black }
}

// MARK: tvOS-only SwiftUI names

extension ToolbarPlacement {
    /// No navigation bar on macOS; hiding the window toolbar is the equivalent.
    static var navigationBar: ToolbarPlacement { .windowToolbar }
}

extension PrimitiveButtonStyle where Self == PlainButtonStyle {
    /// tvOS `.card`: the TV layout draws its own card focus, so the plain style is the match.
    static var card: PlainButtonStyle { .plain }
}

enum UIKeyboardType { case numberPad, URL, `default` }

extension View {
    func keyboardType(_ type: UIKeyboardType) -> some View { self }

    /// The Play/Pause button: Space on the Mac (handled by `MacKeyboard`).
    func onPlayPauseCommand(perform action: (() -> Void)?) -> some View {
        modifier(MacPlayPauseHandler(action: action))
    }

    /// tvOS full-screen covers become a full-window layer above the shell.
    func fullScreenCover<Item: Identifiable, Content: View>(
        item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        overlay {
            if let value = item.wrappedValue {
                content(value)
                    .environment(\.macCoverDismiss, MacDismissAction { item.wrappedValue = nil })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .macFocusLayer()
                    .onDisappear { onDismiss?() }
            }
        }
    }

    func fullScreenCover<Content: View>(
        isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        overlay {
            if isPresented.wrappedValue {
                content()
                    .environment(\.macCoverDismiss, MacDismissAction { isPresented.wrappedValue = false })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .macFocusLayer()
                    .onDisappear { onDismiss?() }
            }
        }
    }
}

/// Registers the view's Play/Pause action while it is on screen; the newest one wins.
private struct MacPlayPauseHandler: ViewModifier {
    let action: (() -> Void)?
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { if let action { MacKeyboard.shared.pushPlayPause(token, action) } }
            .onDisappear { MacKeyboard.shared.popPlayPause(token) }
    }
}

/// `dismiss()` for a full-screen cover shown as a window layer.
struct MacDismissAction {
    var action: () -> Void = {}
    func callAsFunction() { action() }
}

private struct MacCoverDismissKey: EnvironmentKey {
    static let defaultValue = MacDismissAction()
}

extension EnvironmentValues {
    var macCoverDismiss: MacDismissAction {
        get { self[MacCoverDismissKey.self] }
        set { self[MacCoverDismissKey.self] = newValue }
    }
}

/// Renders an `AVPlayer` with no system transport controls (the shared SwiftUI chrome draws them), as on tvOS.
struct TVVideoSurface: NSViewRepresentable {
    let player: AVPlayer?

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .none
        view.videoGravity = .resizeAspect
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.black.cgColor
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }
}
