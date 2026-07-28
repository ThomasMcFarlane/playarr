import PlayarrKit
import SwiftUI

/// Applies `UpdateViewModel`'s current `AppUpdateStatus` as UI: a
/// dismissible soft-nudge alert while between the two compatibility
/// floors, or a non-dismissible blocking interstitial once below
/// `min_supported_version`. See `UpdateViewModel`/`AppUpdateEvaluator`
/// (`PlayarrKit`) for where that decision actually gets made — this
/// modifier only renders it.
///
/// **Ceiling on what this can enforce, stated explicitly (per this pass's
/// instructions):** Apple's App Store guidelines prohibit an iOS app from
/// downloading and executing new code outside what App Review approved
/// (see `docs/architecture/clients/ios.md`), so there is no way for this
/// (or any) iOS client to force an actual code update. The "blocking"
/// interstitial below is **UX-level only** — it withholds this app's own
/// UI behind a full-screen cover with no dismiss/skip affordance, but it
/// cannot stop a determined user (or a debugger, or a jailbroken device)
/// from working around it, and it does nothing to enforce the floor at the
/// network/API layer — every request this app makes is still sent exactly
/// as it would be otherwise. Real enforcement, if Playarr Server ever needs
/// one, has to happen server-side (the version-gate middleware rejecting
/// the request outright, per `docs/versioning-policy.md`), independent of
/// whether this client-side interstitial exists, is bypassed, or is
/// removed entirely from a tampered build.
struct UpdateGateModifier: ViewModifier {
    let viewModel: UpdateViewModel

    func body(content: Content) -> some View {
        content
            .fullScreenCover(isPresented: isBlockedBinding) {
                BlockingUpdateInterstitial(viewModel: viewModel)
                    // No effective escape hatch — see the ceiling note
                    // above for why this is still only a soft, UX-level
                    // block despite the "non-dismissible" presentation.
                    .interactiveDismissDisabled(true)
            }
            .alert(
                "Update available",
                isPresented: isSoftNudgePresentedBinding,
                presenting: softNudgeLatestVersion
            ) { _ in
                Button("Update") { viewModel.openAppStore() }
                Button("Not Now", role: .cancel) { viewModel.dismissSoftNudge() }
            } message: { latestVersion in
                Text("Playarr \(latestVersion) is available. Update when you get a chance.")
            }
    }

    private var isBlockedBinding: Binding<Bool> {
        Binding(
            get: {
                if case .blocked = viewModel.status { return true }
                return false
            },
            // Deliberately a no-op: there is no user action that should be
            // able to dismiss a `.blocked` state client-side — it clears
            // only when the next `checkForUpdate()` (foreground) sees a
            // compatible version installed.
            set: { _ in }
        )
    }

    private var isSoftNudgePresentedBinding: Binding<Bool> {
        Binding(
            get: {
                guard case .softNudge = viewModel.status else { return false }
                return !viewModel.softNudgeDismissed
            },
            set: { isPresented in
                if !isPresented { viewModel.dismissSoftNudge() }
            }
        )
    }

    private var softNudgeLatestVersion: String? {
        if case .softNudge(let latestVersion) = viewModel.status { return latestVersion }
        return nil
    }
}

private struct BlockingUpdateInterstitial: View {
    let viewModel: UpdateViewModel

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)

            Text("Update Required")
                .font(.title2.bold())

            if case .blocked(let minSupportedVersion) = viewModel.status {
                Text(
                    "This version of Playarr is no longer supported by your server " +
                    "(minimum supported: \(minSupportedVersion)). Update the app to keep using it."
                )
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            }

            Button {
                viewModel.openAppStore()
            } label: {
                Text("Open App Store")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 40)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    /// Wires `UpdateGateModifier` onto this view — call once, high in the
    /// hierarchy (see `RootView`).
    func updateGate(_ viewModel: UpdateViewModel) -> some View {
        modifier(UpdateGateModifier(viewModel: viewModel))
    }
}
