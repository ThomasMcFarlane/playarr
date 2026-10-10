import AppKit
import SwiftUI

// Keyboard, mouse and hover for the TV layout on the Mac. tvOS has a spatial focus engine and a remote; macOS has
// neither, so this file supplies both: every Button in the module (shadowed below) is a focus target that hover
// focuses, and the arrow keys move focus geometrically between targets, the web TV's spatial rules.
//
// Keys: arrows move, Return selects, Shift+Return or a right click is the long press (actions), Escape or Delete is
// Back, Space is Play/Pause.

/// The coordinate space of the 1920x1080 stage, inside the window scale.
let macStageSpace = "playarr.macStage"

enum MacMoveDirection { case up, down, left, right }

@MainActor
final class MacFocusEngine {
    static let shared = MacFocusEngine()

    struct Target {
        var frame: CGRect
        var layer: Int
        var focus: () -> Void
        var activate: (() -> Void)?
        /// The long press (a media card's actions).
        var secondary: (() -> Void)?
    }

    private(set) var targets: [UUID: Target] = [:]
    private(set) var focusedID: UUID?
    private(set) var hoveredID: UUID?
    /// The last focused target per layer, so closing a cover returns focus where it was (tvOS does the same).
    private var lastFocused: [Int: UUID] = [:]

    func update(_ id: UUID, _ target: Target) {
        let isNew = targets[id] == nil
        targets[id] = target
        if isNew { scheduleSettle() }
    }

    func remove(_ id: UUID) {
        targets[id] = nil
        if hoveredID == id { hoveredID = nil }
        if focusedID == id { focusedID = nil; scheduleSettle() }
    }

    func didFocus(_ id: UUID, _ focused: Bool) {
        if focused {
            focusedID = id
            if let layer = targets[id]?.layer { lastFocused[layer] = id }
        } else if focusedID == id {
            focusedID = nil
        }
    }

    func didHover(_ id: UUID, _ inside: Bool) {
        if inside { hoveredID = id } else if hoveredID == id { hoveredID = nil }
    }

    var topLayer: Int { targets.values.map(\.layer).max() ?? 0 }

    /// Return: the focused target's action.
    func activateFocused() -> Bool {
        guard let id = focusedID, let action = targets[id]?.activate else { return false }
        action()
        return true
    }

    /// Right click (the hovered target) or Shift+Return (the focused one): the long press, if the target has one.
    func secondary(hovered: Bool) -> Bool {
        guard let id = hovered ? hoveredID : focusedID, let action = targets[id]?.secondary else { return false }
        action()
        return true
    }

    /// The top layer's smallest target under a stage point (debug automation).
    func target(at point: CGPoint) -> Target? {
        let layer = topLayer
        return targets.values.filter { $0.layer == layer && $0.frame.contains(point) }
            .min(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    }

    /// Moves focus to the nearest target in `direction` in the top layer. With nothing focused it focuses the
    /// layer's first target.
    func move(_ direction: MacMoveDirection) {
        let layer = topLayer
        let candidates = targets.filter { $0.value.layer == layer }
        guard let fromID = focusedID, let from = candidates[fromID] else {
            first(in: candidates)?.focus()
            return
        }
        if let next = Self.nearest(from: from.frame, direction: direction,
                                   in: candidates.filter { $0.key != fromID }.map { ($0.key, $0.value.frame) }) {
            candidates[next]?.focus()
        }
    }

    /// The geometric neighbour: the closest row (or column) ahead, then the closest centre across it, so a move
    /// between rails lands on the card visually above or below, never on a matching index.
    nonisolated static func nearest(from: CGRect, direction: MacMoveDirection, in others: [(UUID, CGRect)]) -> UUID? {
        let slack: CGFloat = 1
        func gap(_ r: CGRect) -> CGFloat? {
            switch direction {
            case .right: return r.midX > from.midX && r.minX >= from.maxX - r.width / 2 ? max(0, r.minX - from.maxX) : nil
            case .left: return r.midX < from.midX && r.maxX <= from.minX + r.width / 2 ? max(0, from.minX - r.maxX) : nil
            case .down: return r.midY > from.midY && r.minY >= from.maxY - r.height / 2 ? max(0, r.minY - from.maxY) : nil
            case .up: return r.midY < from.midY && r.maxY <= from.minY + r.height / 2 ? max(0, from.minY - r.maxY) : nil
            }
        }
        func across(_ r: CGRect) -> CGFloat {
            switch direction {
            case .left, .right: return abs(r.midY - from.midY)
            case .up, .down: return abs(r.midX - from.midX)
            }
        }
        func overlaps(_ r: CGRect) -> Bool {
            switch direction {
            case .left, .right: return r.maxY > from.minY + slack && r.minY < from.maxY - slack
            case .up, .down: return r.maxX > from.minX + slack && r.minX < from.maxX - slack
            }
        }
        let ahead = others.compactMap { item -> (UUID, CGRect, CGFloat)? in
            guard let g = gap(item.1) else { return nil }
            return (item.0, item.1, g)
        }
        guard !ahead.isEmpty else { return nil }
        switch direction {
        case .left, .right:
            // Same row first (overlapping the beam), nearest; otherwise the closest by gap and offset.
            let beam = ahead.filter { overlaps($0.1) }
            if let best = beam.min(by: { ($0.2, across($0.1)) < ($1.2, across($1.1)) }) { return best.0 }
            return ahead.min(by: { $0.2 + 2 * across($0.1) < $1.2 + 2 * across($1.1) })?.0
        case .up, .down:
            // The nearest row ahead, then the card whose horizontal centre is closest.
            let row = ahead.map(\.2).min()!
            let rowTolerance: CGFloat = 24
            return ahead.filter { $0.2 <= row + rowTolerance }.min(by: { across($0.1) < across($1.1) })?.0
        }
    }

    private func first(in candidates: [UUID: Target]) -> Target? {
        if let layer = candidates.first?.value.layer, let id = lastFocused[layer], let t = candidates[id] { return t }
        return candidates.values.min(by: { ($0.frame.minY, $0.frame.minX) < ($1.frame.minY, $1.frame.minX) })
    }

    private var settleScheduled = false
    /// After targets come and go (a cover opens or closes, a page loads), keep focus inside the top layer, as the
    /// tvOS engine does. Code that sets focus itself (initial focus on a series page) wins: this only fills a gap.
    private func scheduleSettle() {
        guard !settleScheduled else { return }
        settleScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self else { return }
            self.settleScheduled = false
            let layer = self.topLayer
            if let id = self.focusedID, self.targets[id]?.layer == layer { return }
            let candidates = self.targets.filter { $0.value.layer == layer }
            self.first(in: candidates)?.focus()
        }
    }
}

// MARK: Focus targets

private struct MacFocusLayerKey: EnvironmentKey { static let defaultValue = 0 }

struct MacSecondary { let action: () -> Void }
private struct MacSecondaryKey: EnvironmentKey { static let defaultValue: MacSecondary? = nil }

extension EnvironmentValues {
    var macFocusLayer: Int {
        get { self[MacFocusLayerKey.self] }
        set { self[MacFocusLayerKey.self] = newValue }
    }

    var macSecondaryAction: MacSecondary? {
        get { self[MacSecondaryKey.self] }
        set { self[MacSecondaryKey.self] = newValue }
    }
}

extension View {
    /// A layer above the page (cover, drawer): while it has targets, focus stays inside it.
    func macFocusLayer() -> some View { modifier(MacFocusLayerBump()) }

    /// Makes a view a keyboard and hover focus target; `activate` runs on Return.
    func macFocusTarget(activate: (() -> Void)? = nil) -> some View { modifier(MacFocusTarget(activate: activate)) }

    /// The long-press action (actions drawer) of the button inside: right click while hovered, or Shift+Return.
    func macSecondaryAction(_ action: @escaping () -> Void) -> some View {
        environment(\.macSecondaryAction, MacSecondary(action: action))
    }
}

private struct MacFocusLayerBump: ViewModifier {
    @Environment(\.macFocusLayer) private var layer
    func body(content: Content) -> some View { content.environment(\.macFocusLayer, layer + 1) }
}

struct MacFocusTarget: ViewModifier {
    var activate: (() -> Void)?
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.macFocusLayer) private var layer
    @Environment(\.macSecondaryAction) private var secondary
    @FocusState private var focused: Bool
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .focusable(isEnabled, interactions: .activate)
            .focused($focused)
            .focusEffectDisabled()
            .onHover { inside in
                MacFocusEngine.shared.didHover(id, inside)
                if inside, isEnabled { focused = true }
            }
            .onChange(of: focused) { _, now in MacFocusEngine.shared.didFocus(id, now) }
            .background {
                GeometryReader { proxy in
                    let frame = proxy.frame(in: .named(macStageSpace))
                    Color.clear
                        .onAppear { register(frame) }
                        .onChange(of: frame) { _, new in register(new) }
                        .onChange(of: isEnabled) { _, _ in register(frame) }
                        .onChange(of: layer) { _, _ in register(frame) }
                }
            }
            .onDisappear { MacFocusEngine.shared.remove(id) }
    }

    private func register(_ frame: CGRect) {
        guard isEnabled, frame.width > 0, frame.height > 0 else {
            MacFocusEngine.shared.remove(id)
            return
        }
        let binding = $focused
        MacFocusEngine.shared.update(id, .init(frame: frame, layer: layer, focus: { binding.wrappedValue = true },
                                               activate: activate, secondary: secondary?.action))
    }
}

// MARK: Button

/// Every `Button` in the shared sources resolves to this one on the Mac (a module type shadows SwiftUI's), so each
/// is a keyboard and hover focus target without touching the tvOS code. It draws SwiftUI's button unchanged.
struct Button<Label: View>: View {
    private let role: ButtonRole?
    private let action: () -> Void
    private let label: Label

    init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.role = nil
        self.action = action
        self.label = label()
    }

    init(role: ButtonRole?, action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.role = role
        self.action = action
        self.label = label()
    }

    var body: some View {
        SwiftUI.Button(role: role, action: action) { label }
            .macFocusTarget(activate: action)
    }
}

extension Button where Label == Text {
    init(_ titleKey: LocalizedStringKey, action: @escaping () -> Void) {
        self.init(action: action) { Text(titleKey) }
    }

    @_disfavoredOverload
    init<S: StringProtocol>(_ title: S, action: @escaping () -> Void) {
        self.init(action: action) { Text(title) }
    }

    init(_ titleKey: LocalizedStringKey, role: ButtonRole?, action: @escaping () -> Void) {
        self.init(role: role, action: action) { Text(titleKey) }
    }
}

// MARK: Keyboard and mouse

@MainActor
final class MacKeyboard {
    static let shared = MacKeyboard()
    private var monitor: Any?
    private var playPause: [(UUID, () -> Void)] = []

    func pushPlayPause(_ id: UUID, _ action: @escaping () -> Void) {
        playPause.removeAll { $0.0 == id }
        playPause.append((id, action))
    }

    func popPlayPause(_ id: UUID) { playPause.removeAll { $0.0 == id } }

    func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .rightMouseDown]) { event in
            MainActor.assumeIsolated { MacKeyboard.shared.handle(event) }
        }
    }

    private func handle(_ event: NSEvent) -> NSEvent? {
        if event.type == .rightMouseDown {
            return MacFocusEngine.shared.secondary(hovered: true) ? nil : event
        }
        // Text fields keep their keys (search, server address, PIN).
        if event.window?.firstResponder is NSText { return event }
        let mods = event.modifierFlags.intersection([.command, .option, .control, .shift])
        if mods.contains(.command) { return event }
        switch event.keyCode {
        case 123, 124, 125, 126:
            let direction: MacMoveDirection = [123: .left, 124: .right, 125: .down, 126: .up][event.keyCode]!
            // The focused view's own onMoveCommand runs first (as on tvOS); the engine then moves focus unless
            // that handler already moved it.
            let before = MacFocusEngine.shared.focusedID
            DispatchQueue.main.async {
                if MacFocusEngine.shared.focusedID == before { MacFocusEngine.shared.move(direction) }
            }
            return event
        case 36, 76: // Return, keypad Enter
            if mods.contains(.shift) { return MacFocusEngine.shared.secondary(hovered: false) ? nil : event }
            return MacFocusEngine.shared.activateFocused() ? nil : event
        case 49: // Space
            if let action = playPause.last?.1 { action(); return nil }
            return event
        case 51, 117: // Delete, forward delete: Back, the same as Escape
            return NSEvent.keyEvent(with: .keyDown, location: event.locationInWindow, modifierFlags: [],
                                    timestamp: event.timestamp, windowNumber: event.windowNumber, context: nil,
                                    characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
                                    isARepeat: event.isARepeat, keyCode: 53) ?? event
        default:
            return event
        }
    }
}
