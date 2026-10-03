import AVKit
import PlayarrKit
import SwiftUI
import UIKit

struct TVPlayerView: View {
    let mediaFileID: UUID
    let title: String
    let apiClient: PlayarrAPIClient
    /// Work whose `/similar` results fill the end-of-playback rail.
    let suggestionsWorkID: UUID?
    @State private var viewModel: TVPlayerViewModel
    @State private var suggestions: [Work] = []
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(
        mediaFileID: UUID,
        title: String,
        apiClient: PlayarrAPIClient,
        suggestionsWorkID: UUID? = nil,
        queue: [PlaybackQueueEntry] = [],
        advance: EndOfPlaybackMachine.Advance = .countdown,
        subtitle: String? = nil
    ) {
        self.mediaFileID = mediaFileID
        self.title = title
        self.apiClient = apiClient
        self.suggestionsWorkID = suggestionsWorkID
        let model = TVPlayerViewModel(apiClient: apiClient)
        model.endOfPlayback.setQueue(queue, advance: advance)
        model.setSubtitle(subtitle)
        _viewModel = State(initialValue: model)
    }

    var body: some View {
        ZStack {
            // Player stage uses background.base so chrome matches ui-tv PlayerScreen
            // when media has not yet painted.
            DesignTokens.Color.backgroundBase.ignoresSafeArea()

            switch viewModel.state {
            case .idle, .negotiating:
                ProgressView("Preparing \(title)…")
                    .tint(DesignTokens.Color.brandPrimary)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
            case .ready:
                VideoPlayer(player: viewModel.player)
                    .ignoresSafeArea()
                    .overlay(alignment: .bottomLeading) {
                        playerChrome
                    }
            case .failed(let message):
                TVErrorView(title: "Playback failed", message: message) {
                    Task { await viewModel.play(mediaFileID: mediaFileID, title: title) }
                }
            }

            if viewModel.endOfPlayback.phase != .playing {
                TVEndOfPlaybackView(
                    controller: viewModel.endOfPlayback,
                    title: viewModel.currentTitle.isEmpty ? title : viewModel.currentTitle,
                    subtitle: viewModel.currentSubtitle,
                    suggestions: suggestions,
                    apiClient: apiClient
                )
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.endOfPlayback.phase)
        .task {
            viewModel.onExit = { dismiss() }
            // Returning from a suggestion must not restart a finished item.
            if viewModel.state == .idle, viewModel.endOfPlayback.phase == .playing {
                await viewModel.play(mediaFileID: mediaFileID, title: title)
            }
        }
        .task(id: viewModel.endOfPlayback.phase == .playing) { @MainActor in
            guard viewModel.endOfPlayback.phase != .playing, suggestions.isEmpty, let suggestionsWorkID else { return }
            let similar = (try? await apiClient.fetchSimilarWorks(id: suggestionsWorkID, limit: 13)) ?? []
            suggestions = Array(similar.filter { $0.id != suggestionsWorkID }.prefix(12))
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { viewModel.endOfPlayback.resumeTimer() } else { viewModel.endOfPlayback.stopTimer() }
        }
        // Hold the screen awake while the end card or countdown is up; release
        // after 60 s idle on a plain end card, and on exit.
        .task(id: viewModel.endOfPlayback.phase) { @MainActor in
            let phase = viewModel.endOfPlayback.phase
            UIApplication.shared.isIdleTimerDisabled = phase != .playing
            if phase == .endCard {
                try? await Task.sleep(for: .seconds(60))
                if !Task.isCancelled { UIApplication.shared.isIdleTimerDisabled = false }
            }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            viewModel.stop()
        }
    }

    /// Transport chrome aligned with ui-tv `PlayerScreen` (title + mode badge).
    private var playerChrome: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Text(title)
                .font(TVTheme.titleFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
            if let mode = viewModel.playbackMode {
                Text(mode == .direct ? "Direct play" : "Streaming")
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .padding(.horizontal, DesignTokens.Spacing.md)
                    .padding(.vertical, DesignTokens.Spacing.xs)
                    .background(
                        Capsule().fill(DesignTokens.Color.backgroundRaised.opacity(0.9))
                    )
            }
        }
        .padding(DesignTokens.Spacing.xl)
    }
}
