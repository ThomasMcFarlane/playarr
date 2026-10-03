import PlayarrKit
import SwiftUI

/// End-of-playback overlay for the iOS player, per
/// `docs/architecture/end-of-playback.md`: an ended card (Replay, Back to
/// details, suggestions) or, when a next item exists, an up-next countdown
/// (Play now, Cancel, Replay, Back to details, suggestions). State lives in
/// `EndOfPlaybackController`.
struct EndOfPlaybackView: View {
    let controller: EndOfPlaybackController
    let title: String
    let subtitle: String?
    let suggestions: [Work]
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            // Swallows taps: dismissing by tapping the backdrop is not allowed.
            Color.black.opacity(0.88).ignoresSafeArea().contentShape(Rectangle()).onTapGesture {}

            ScrollView {
                VStack(spacing: 24) {
                    switch controller.phase {
                    case .upNext(let remaining):
                        if let next = controller.nextEntry { upNext(next, remaining: remaining) }
                    default:
                        endedCard
                    }

                    if !suggestions.isEmpty { suggestionsRail }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 48)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .foregroundStyle(.white)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(dialogLabel)
        .accessibilityAddTraits(.isModal)
        .onChange(of: controller.phase) { _, phase in announce(phase) }
        .onAppear { announce(controller.phase, isFirst: true) }
    }

    private var dialogLabel: String {
        if case .upNext = controller.phase, let next = controller.nextEntry {
            return "Up next: \(next.title)"
        }
        return "Finished playing \(title)"
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

    private var endedCard: some View {
        VStack(spacing: 14) {
            Text("Finished")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.6))
            Text(title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            if let subtitle {
                Text(subtitle).font(.subheadline).foregroundStyle(.white.opacity(0.65))
            }

            actionRow {
                Button { controller.replay() } label: {
                    Label("Replay", systemImage: "arrow.counterclockwise").frame(minWidth: 96, minHeight: 44)
                }
                .buttonStyle(PlayarrPrimaryButtonStyle())

                if controller.nextEntry != nil {
                    Button { controller.playNow() } label: {
                        Label("Play next", systemImage: "forward.fill").frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(.white)
                }

                backButton
            }
            .padding(.top, 6)
        }
    }

    private func upNext(_ next: PlaybackQueueEntry, remaining: Int) -> some View {
        VStack(spacing: 14) {
            Text("Up next")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.6))

            if controller.machine.autoplaysNext {
                countdown(remaining: remaining)
            }

            VStack(spacing: 4) {
                Text(next.title).font(.title3.bold()).multilineTextAlignment(.center)
                if let subtitle = next.subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(.white.opacity(0.65))
                }
            }

            actionRow {
                Button { controller.playNow() } label: {
                    Label("Play now", systemImage: "play.fill").frame(minWidth: 96, minHeight: 44)
                }
                .buttonStyle(PlayarrPrimaryButtonStyle())

                if controller.machine.autoplaysNext {
                    Button("Cancel") { controller.cancelCountdown() }
                        .buttonStyle(.bordered)
                        .tint(.white)
                        .frame(minHeight: 44)
                }

                Button { controller.replay() } label: {
                    Label("Replay", systemImage: "arrow.counterclockwise").frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(.white)

                backButton
            }
        }
    }

    @ViewBuilder
    private func countdown(remaining: Int) -> some View {
        if reduceMotion {
            Text("Playing in \(remaining)")
                .font(.title3.weight(.semibold).monospacedDigit())
        } else {
            VStack(spacing: 8) {
                ZStack {
                    Circle().stroke(.white.opacity(0.18), lineWidth: 5)
                    Circle()
                        .trim(from: 0, to: CGFloat(remaining) / CGFloat(max(controller.machine.countdownSeconds, 1)))
                        .stroke(PlayarrStyle.pink, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 1), value: remaining)
                    Text("\(remaining)").font(.title.bold().monospacedDigit())
                }
                .frame(width: 84, height: 84)
                // The ring is decorative; the text below is the accessible value.
                .accessibilityHidden(true)
                Text("Playing in \(remaining)")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.72))
            }
        }
    }

    /// Wraps onto a second line on narrow phones in portrait.
    private func actionRow<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ViewThatFits {
            HStack(spacing: 12, content: content)
            VStack(spacing: 12, content: content)
        }
    }

    private var backButton: some View {
        Button { controller.exit() } label: {
            Label("Back to details", systemImage: "chevron.backward").frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(.white)
    }

    private var suggestionsRail: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("More like this")
                .font(.headline)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(suggestions) { work in
                        NavigationLink {
                            WorkDetailView(
                                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                apiClient: apiClient,
                                downloadRepository: downloadRepository
                            )
                        } label: {
                            PlayarrMediaCard(work: work, apiClient: apiClient, width: 160)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }
}
