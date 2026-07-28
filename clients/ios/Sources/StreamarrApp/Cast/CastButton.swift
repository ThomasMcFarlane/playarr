import GoogleCast
import SwiftUI

/// Thin `UIViewRepresentable` bridge for `GCKUICastButton` -- the Cast SDK
/// ships this as a plain `UIView` with no SwiftUI equivalent, so it has to
/// be wrapped. This is the first `UIViewRepresentable` anywhere in this
/// codebase (there was no existing local pattern to follow when this was
/// written), so it's kept intentionally minimal: `GCKUICastButton` is
/// otherwise self-sufficient once `GCKCastContext` exists (it shows its own
/// device picker, starts/ends sessions, and reflects connection state on
/// its own icon without any help from app code).
///
/// Callers should gate this on `CastSessionCoordinator.isConfigured` --
/// `GCKUICastButton` expects a configured `GCKCastContext` to already
/// exist, which only happens when `Info.plist`'s `PlayarrCastReceiverAppID`
/// is non-empty (see `AppDelegate`).
struct CastButton: UIViewRepresentable {
    var tintColor: UIColor = .white

    func makeUIView(context: Context) -> GCKUICastButton {
        let button = GCKUICastButton(frame: CGRect(x: 0, y: 0, width: 24, height: 24))
        button.tintColor = tintColor
        return button
    }

    func updateUIView(_ uiView: GCKUICastButton, context: Context) {
        uiView.tintColor = tintColor
    }
}
