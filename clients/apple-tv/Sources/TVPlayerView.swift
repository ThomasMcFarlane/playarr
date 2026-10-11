import AVKit
import PlayarrKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct TVPlayerView: View {
    @Environment(\.setShellChromeHidden) private var setShellChromeHidden
    let mediaFileID: UUID
    let title: String
    let apiClient: PlayarrAPIClient
    /// Work whose `/similar` results fill the end-of-playback rail.
    let suggestionsWorkID: UUID?
    @State private var viewModel: TVPlayerViewModel
    @State private var suggestions: [Work] = []
    /// Parity route: draw the chrome statically at this position over a black stage.
    let parity: (position: Double, duration: Double, menuOpen: Bool)?
    @State private var interaction = TVPlayerInteraction()
    @FocusState private var focusedControl: TVPlayerControl?
    #if os(macOS)
    /// The Mac shows covers as a window layer, not a presentation (macOS/PlatformShims.swift).
    @Environment(\.macCoverDismiss) private var dismiss
    #else
    @Environment(\.dismiss) private var dismiss
    #endif
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
        // The player is full screen like the web's player page: the shell hides its nav and clock.
        screen
            .onAppear { setShellChromeHidden(true) }
            .onDisappear { setShellChromeHidden(false) }
    }

    @ViewBuilder
    private var screen: some View {
        if let parity {
            // Parity route: the fixture clips are Matroska and the runner cannot transcode, so the video
            // layer is the server's frame of the clip at the paused position, scaled to the stage.
            ZStack(alignment: .topLeading) {
                Color.black
                parityFrame
                TVPlayerChrome(
                    state: TVPlayerChromeState(
                        position: parity.position,
                        duration: parity.duration,
                        isPlaying: false,
                        qualityLabel: viewModel.qualityLabel,
                        selectedQualityID: viewModel.selectedQualityID,
                        menuOpen: parity.menuOpen
                    ),
                    frozen: true,
                    menuBackdrop: AnyView(parityFrame)
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .ignoresSafeArea()
            .task { await viewModel.loadInfo(mediaFileID: mediaFileID) }
        } else {
            playerBody
        }
    }

    /// The server's frame of the clip at the paused position, colour-matched to the browser's output.
    private var parityFrame: some View {
        TVAuthedImage(load: {
            let data = try await apiClient.fetchMediaThumbnail(mediaFileID: mediaFileID, positionMs: Int((parity?.position ?? 0) * 1000))
            return TVVideoFrameColour.matchingBrowser(data)
        }) { Color.black }
            .frame(width: 1920, height: 1080)
            .clipped()
    }

    private var playerBody: some View {
        ZStack {
            // The stage is black behind the video, as on the web.
            Color.black.ignoresSafeArea()

            // Play opens the player directly: a black stage with the normal chrome and at most a small
            // buffering spinner while the session and stream are negotiated. No interstitial page.
            switch TVPlayerStage.resolve(viewModel.state) {
            case .chrome(let videoAttached, let spinner):
                if videoAttached {
                    TVVideoSurface(player: viewModel.player)
                        .ignoresSafeArea()
                }
                ZStack {
                // While the controls are hidden this catches SELECT and moves to reveal them again.
                Color.clear
                    .ignoresSafeArea()
                    .focusable(!interaction.controlsVisible)
                    .onTapGesture {
                        interaction.reveal()
                        focusedControl = interaction.focus
                    }
                TVPlayerChrome(
                    state: TVPlayerChromeState(
                        position: viewModel.position,
                        duration: viewModel.duration,
                        isPlaying: viewModel.isPlaying,
                        qualityLabel: viewModel.qualityLabel,
                        selectedQualityID: viewModel.selectedQualityID,
                        menuOpen: interaction.menuOpen
                    ),
                    onClose: { dismiss() },
                    onTogglePlay: { handleSelect() },
                    onToggleQualityMenu: { handleSelect() },
                    controlsVisible: interaction.controlsVisible,
                    focus: $focusedControl
                )
                }
                .onPlayPauseCommand { viewModel.togglePlay(); interaction.reveal() }
                .onExitCommand {
                    switch interaction.back() {
                    case .closedMenu: focusedControl = interaction.focus
                    case .hidControls: break
                    case .exit: dismiss()
                    }
                }
                .onMoveCommand { direction in
                    interaction.reveal()
                    switch direction {
                    case .left:
                        viewModel.seek(by: -10)
                        interaction.seeked()
                    case .right:
                        viewModel.seek(by: 10)
                        interaction.seeked()
                    default: break
                    }
                    // A seek never moves focus: keep it on the control the user left it on.
                    if focusedControl == nil { focusedControl = interaction.focus }
                }
                .onChange(of: focusedControl) { _, control in
                    if let control { interaction.focus = control }
                }
                if spinner {
                    ProgressView().tint(.white).controlSize(.large)
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
            if phase != .active { viewModel.didEnterBackground() }
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

    /// SELECT: the scrubber and Play toggle play/pause only; Quality opens its panel.
    private func handleSelect() {
        interaction.focus = focusedControl ?? interaction.focus
        switch interaction.select() {
        case .togglePlayPause: viewModel.togglePlay()
        case .openQualityMenu: break
        case .close: dismiss()
        case nil: break
        }
    }
}
