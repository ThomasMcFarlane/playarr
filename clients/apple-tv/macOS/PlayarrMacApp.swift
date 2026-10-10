import AppKit
import SwiftUI

/// Playarr for Mac: the Apple TV app's 10-foot layout (web TV) in a resizable 16:9 window. The stage is laid out
/// at 1920x1080 like the TV and scaled to the window, as web TV scales to the viewport.
@main
struct PlayarrMacApp: App {
    @NSApplicationDelegateAdaptor private var delegate: MacAppDelegate

    var body: some Scene {
        // The window is AppKit's (MacAppDelegate), so its size, 16:9 lock and minimum are exact.
        Settings { EmptyView() }
    }
}

@MainActor
final class MacAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private let environment = TVAppEnvironment()
    private let displayPreferences = TVDisplayPreferences()

    func applicationDidFinishLaunching(_ notification: Notification) {
        MacKeyboard.shared.install()
        let root = MacTVStage {
            TVRootView()
                .environment(self.environment)
                .environment(self.displayPreferences)
        }
        .preferredColorScheme(TVParityLaunch.theme ?? displayPreferences.colorScheme)
        let window = MacTVWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1920, height: 1080),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Playarr"
        window.contentAspectRatio = NSSize(width: 16, height: 9)
        window.contentMinSize = NSSize(width: 1280, height: 720)
        window.contentView = NSHostingView(rootView: root)
        window.setContentSize(NSSize(width: 1920, height: 1080))
        window.center()
        window.setFrameAutosaveName("PlayarrTV")
        // A screen smaller than 1920x1080 shrinks the window; keep the content exactly 16:9.
        let content = window.contentRect(forFrameRect: window.frame).size
        window.setContentSize(content.width * 9 / 16 <= content.height
            ? NSSize(width: content.width, height: (content.width * 9 / 16).rounded())
            : NSSize(width: (content.height * 16 / 9).rounded(), height: content.height))
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        // SwiftUI keyboard focus lives in the hosting view, so it must be the first responder.
        window.makeFirstResponder(window.contentView)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
        #if DEBUG
        MacDebugRemote.install(window: window)
        #endif
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

/// The default 1920x1080 window may be larger than a laptop screen; it is kept at 16:9 rather than squeezed.
final class MacTVWindow: NSWindow {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        guard let visible = screen?.visibleFrame,
              frameRect.width > visible.width || frameRect.height > visible.height else { return frameRect }
        let content = contentRect(forFrameRect: frameRect)
        let scale = min(visible.width / frameRect.width, (visible.height - (frameRect.height - content.height)) / content.height)
        let size = NSSize(width: content.width * scale, height: content.height * scale)
        var rect = self.frameRect(forContentRect: NSRect(origin: .zero, size: size))
        rect.origin = NSPoint(x: visible.midX - rect.width / 2, y: visible.maxY - rect.height)
        return rect
    }
}

/// The 1920x1080 stage scaled to the window.
struct MacTVStage<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { geo in
            content()
                .frame(width: 1920, height: 1080)
                .coordinateSpace(name: macStageSpace)
                .scaleEffect(min(geo.size.width / 1920, geo.size.height / 1080), anchor: .topLeading)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .background(Color.black)
    }
}
