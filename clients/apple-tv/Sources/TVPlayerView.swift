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
    /// Parity route: draw the chrome statically at this position over a black stage.
    let parity: (position: Double, duration: Double, menuOpen: Bool)?
    @State private var menuOpen = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(
        mediaFileID: UUID,
        title: String,
        apiClient: PlayarrAPIClient,
        suggestionsWorkID: UUID? = nil,
        queue: [PlaybackQueueEntry] = [],
        advance: EndOfPlaybackMachine.Advance = .countdown,
        subtitle: String? = nil,
        parity: (position: Double, duration: Double, menuOpen: Bool)? = nil
    ) {
        self.parity = parity
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
        playerBody
    }

    private var playerBody: some View {
        ZStack {
            // The stage is black behind the video, as on the web.
            Color.black.ignoresSafeArea()

            switch viewModel.state {
            case .idle, .negotiating:
                ProgressView("Preparing \(title)…")
                    .tint(DesignTokens.Color.brandPrimary)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
            case .ready:
                TVVideoSurface(player: viewModel.player)
                    .ignoresSafeArea()
                TVPlayerChrome(
                    state: TVPlayerChromeState(
                        position: viewModel.position,
                        duration: viewModel.duration,
                        isPlaying: viewModel.isPlaying,
                        qualityLabel: viewModel.qualityLabel,
                        selectedQualityID: viewModel.selectedQualityID,
                        menuOpen: menuOpen
                    ),
                    onClose: { dismiss() },
                    onTogglePlay: { viewModel.togglePlay() },
                    onToggleQualityMenu: { menuOpen.toggle() }
                )
                .onPlayPauseCommand { viewModel.togglePlay() }
                .onExitCommand { if menuOpen { menuOpen = false } else { dismiss() } }
                .onMoveCommand { direction in
                    switch direction {
                    case .left: viewModel.seek(by: -10)
                    case .right: viewModel.seek(by: 10)
                    default: break
                    }
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
                if let parity {
                    // Parity route: pause on a fixed frame with the chrome (and menu) showing.
                    menuOpen = parity.menuOpen
                    await viewModel.engine.seek(to: parity.position)
                    viewModel.engine.pause()
                }
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
}
