#if DEBUG
import AppKit

/// Debug builds only: drives the app for parity captures and keyboard checks, the macOS analogue of `simctl`.
/// It renders the app's own window (never the screen) and posts keys into the app's own event queue, so it works
/// while the Mac is locked. Send a distributed notification `app.playarr.macos.debug` whose object is one of:
/// `snapshot:<path.png>` (the window content at 1920x1080), `key:<keyCode>[:shift]`, `tap:<x>,<y>` or `hold:<x>,<y>`
/// (a stage point).
@MainActor
enum MacDebugRemote {
    static func install(window: NSWindow) {
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("app.playarr.macos.debug"), object: nil, queue: .main
        ) { note in
            let command = note.object as? String ?? ""
            MainActor.assumeIsolated { run(command, window: window) }
        }
    }

    private static func run(_ command: String, window: NSWindow) {
        let parts = command.split(separator: ":", maxSplits: 2).map(String.init)
        switch parts.first {
        case "snapshot" where parts.count > 1:
            snapshot(window: window, to: URL(fileURLWithPath: parts[1]))
        case "key" where parts.count > 1:
            guard let code = UInt16(parts[1]) else { return }
            let flags: NSEvent.ModifierFlags = parts.count > 2 && parts[2] == "shift" ? [.shift] : []
            let chars = [36: "\r", 49: " ", 53: "\u{1b}", 51: "\u{7f}"][Int(code)] ?? ""
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags,
                                                timestamp: ProcessInfo.processInfo.systemUptime,
                                                windowNumber: window.windowNumber, context: nil,
                                                characters: chars, charactersIgnoringModifiers: chars,
                                                isARepeat: false, keyCode: code) {
                    NSApp.postEvent(event, atStart: false)
                }
            }
        case "tap" where parts.count > 1, "hold" where parts.count > 1:
            // A stage point (1920x1080): runs the target's action (tap) or long press (hold), as a click would.
            let xy = parts[1].split(separator: ",").compactMap { Double($0) }
            guard xy.count == 2, let target = MacFocusEngine.shared.target(at: CGPoint(x: xy[0], y: xy[1])) else {
                NSLog("PlayarrMac debug: no target at %@", parts[1])
                return
            }
            target.focus()
            if parts[0] == "tap" { target.activate?() } else { target.secondary?() }
        case "state":
            let engine = MacFocusEngine.shared
            let focused = engine.focusedID.flatMap { engine.targets[$0] }
            NSLog("PlayarrMac debug: key=%d bounds=%@ targets=%d top=%d focused=%@ responder=%@",
                  window.isKeyWindow ? 1 : 0, NSStringFromRect(window.contentView?.bounds ?? .zero),
                  engine.targets.count, engine.topLayer,
                  focused.map { NSStringFromRect($0.frame) } ?? "none",
                  String(describing: window.firstResponder.map { type(of: $0) }))
        default:
            NSLog("PlayarrMac debug: unknown command %@", command)
        }
    }

    /// Renders the window's content layer tree at 1920x1080.
    private static func snapshot(window: NSWindow, to url: URL) {
        guard let view = window.contentView, let layer = view.layer, view.bounds.width > 0 else { return }
        let width = 1920, height = 1080
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        // The stage sits at the top left, scaled to fit (MacTVStage); render just the stage at 1920x1080.
        let scale = 1 / min(view.bounds.width / 1920, view.bounds.height / 1080)
        if layer.isGeometryFlipped || view.isFlipped {
            ctx.translateBy(x: 0, y: CGFloat(height))
            ctx.scaleBy(x: scale, y: -scale)
        } else {
            ctx.scaleBy(x: scale, y: scale)
        }
        layer.render(in: ctx)
        guard let image = ctx.makeImage(),
              let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { return }
        try? data.write(to: url)
        NSLog("PlayarrMac debug: snapshot %@", url.path)
    }
}
#endif
