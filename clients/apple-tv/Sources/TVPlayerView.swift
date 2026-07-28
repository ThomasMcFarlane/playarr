import AVKit
import PlayarrKit
import SwiftUI

struct TVPlayerView: View {
    let mediaFileID: UUID
    let title: String
    @State private var viewModel: TVPlayerViewModel

    init(mediaFileID: UUID, title: String, apiClient: PlayarrAPIClient) {
        self.mediaFileID = mediaFileID
        self.title = title
        _viewModel = State(initialValue: TVPlayerViewModel(apiClient: apiClient))
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
        }
        .task {
            if viewModel.state == .idle {
                await viewModel.play(mediaFileID: mediaFileID, title: title)
            }
        }
        .onDisappear { viewModel.stop() }
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
