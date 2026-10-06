import PlayarrKit
import SwiftUI

private struct LiveEventsHubKey: EnvironmentKey {
    static let defaultValue: LiveEventsHub? = nil
}

extension EnvironmentValues {
    /// The live-events hub of the signed-in shell; `nil` in previews and tests.
    var liveEvents: LiveEventsHub? {
        get { self[LiveEventsHubKey.self] }
        set { self[LiveEventsHubKey.self] = newValue }
    }
}

private struct LiveInvalidationModifier: ViewModifier {
    @Environment(\.liveEvents) private var hub
    let areas: [LiveArea]
    let action: @MainActor () async -> Void

    func body(content: Content) -> some View {
        content.onChange(of: hub?.signature(of: areas) ?? 0) { _, _ in
            Task { await action() }
        }
    }
}

extension View {
    /// Runs `action` (a silent in-place refetch) when any of `areas` is invalidated by a live event.
    func onLiveInvalidation(_ areas: [LiveArea], perform action: @escaping @MainActor () async -> Void) -> some View {
        modifier(LiveInvalidationModifier(areas: areas, action: action))
    }
}
