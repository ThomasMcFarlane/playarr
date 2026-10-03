import PlayarrKit
import SwiftUI

/// tvOS end-of-playback overlay per `docs/architecture/end-of-playback.md`:
/// ended card (Replay, Back to details, suggestions) or up-next countdown
/// (Play now, Cancel, Replay, Back to details, suggestions). Focus lands on
/// the primary action; Menu on the Siri Remote is Back to details; Play/Pause
/// activates the primary action; the suggestions rail is a focus section so
/// Down from the buttons reaches it, and moving focus there does not stop
/// the countdown (only selecting a suggestion does).
struct TVEndOfPlaybackView: View {
    let controller: EndOfPlaybackController
    let title: String
    let subtitle: String?
    let suggestions: [Work]
    let apiClient: PlayarrAPIClient

    private enum Focus: Hashable {
        case primary
    }

    @FocusState private var focus: Focus?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DesignTokens.Color.backgroundBase.opacity(0.92).ignoresSafeArea()

            VStack(spacing: DesignTokens.Spacing.xl) {
                Spacer(minLength: 0)
                switch controller.phase {
                case .upNext(let remaining):
                    if let next = controller.nextEntry { upNext(next, remaining: remaining) }
                default:
                    endCard
                }
                Spacer(minLength: 0)
                if !suggestions.isEmpty { suggestionsRail }
            }
            .padding(DesignTokens.Spacing.xl)
        }
        .onAppear {
            focus = .primary
            announce(controller.phase, isFirst: true)
        }
        .onChange(of: controller.phase) { _, phase in announce(phase) }
        .onExitCommand { controller.exit() }
        .onPlayPauseCommand { primaryAction() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(dialogLabel)
        .accessibilityAddTraits(.isModal)
    }

    private var dialogLabel: String {
        if case .upNext = controller.phase, let next = controller.nextEntry {
            return "Up next: \(next.title)"
        }
        return "Finished playing \(title)"
    }

    private func primaryAction() {
        if controller.isCountingDown { controller.playNow() } else { controller.replay() }
    }

    /// Announced at the start, at 5 s and at 0 s only, never every second.
    private func announce(_ phase: EndOfPlaybackMachine.Phase, isFirst: Bool = false) {
        guard case .upNext(let remaining) = phase, controller.machine.autoplaysNext else {
            if isFirst { AccessibilityNotification.Announcement(dialogLabel).post() }
            return
        }
        if isFirst {
            AccessibilityNotification.Announcement("\(dialogLabel). Playing in \(remaining)").post()
        } else if remaining == 5 || remaining == 1 {
            AccessibilityNotification.Announcement("Playing in \(remaining)").post()
        }
    }

    private var endCard: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Text("Finished")
                .font(TVTheme.captionFont())
                .textCase(.uppercase)
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(title)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .multilineTextAlignment(.center)
            if let subtitle {
                Text(subtitle)
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }
            HStack(spacing: DesignTokens.Spacing.lg) {
                primaryButton("Replay") { controller.replay() }
                if controller.nextEntry != nil {
                    TVSecondaryButton(label: "Play next") { controller.playNow() }
                }
                TVSecondaryButton(label: "Back to details") { controller.exit() }
            }
        }
    }

    private func upNext(_ next: PlaybackQueueEntry, remaining: Int) -> some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Text("Up next")
                .font(TVTheme.captionFont())
                .textCase(.uppercase)
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(next.title)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .multilineTextAlignment(.center)
            if let subtitle = next.subtitle {
                Text(subtitle)
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }
            if controller.machine.autoplaysNext {
                VStack(spacing: DesignTokens.Spacing.sm) {
                    // The bar is decorative; the text is the accessible value.
                    if !reduceMotion {
                        ProgressView(
                            value: Double(controller.machine.countdownSeconds - remaining),
                            total: Double(max(controller.machine.countdownSeconds - 1, 1))
                        )
                        .tint(DesignTokens.Color.brandPrimary)
                        .frame(width: 520)
                        .accessibilityHidden(true)
                    }
                    Text("Playing in \(remaining)")
                        .font(TVTheme.bodyFont(emphasis: true))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }
            }
            HStack(spacing: DesignTokens.Spacing.lg) {
                primaryButton("Play now") { controller.playNow() }
                if controller.machine.autoplaysNext {
                    TVSecondaryButton(label: "Cancel") { controller.cancelCountdown() }
                }
                TVSecondaryButton(label: "Replay") { controller.replay() }
                TVSecondaryButton(label: "Back to details") { controller.exit() }
            }
        }
    }

    private func primaryButton(_ label: String, action: @escaping () -> Void) -> some View {
        TVPrimaryButton(label: label, action: action)
            .focused($focus, equals: .primary)
    }

    private var suggestionsRail: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("More like this")
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DesignTokens.Shell.detailTrackItemGap) {
                    ForEach(suggestions) { work in
                        NavigationLink {
                            TVWorkDetailView(work: work, apiClient: apiClient)
                        } label: {
                            TVHomeCard(work: work, apiClient: apiClient)
                        }
                        .buttonStyle(TVFocusableCardButtonStyle())
                    }
                }
                .padding(.vertical, DesignTokens.Spacing.md)
            }
        }
        .focusSection()
    }
}
