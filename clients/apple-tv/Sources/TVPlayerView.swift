import AVKit
import StreamarrKit
import SwiftUI

struct TVPlayerView: View {
    let mediaFileID: UUID
    let title: String
    @State private var viewModel: TVPlayerViewModel

    init(mediaFileID: UUID, title: String, apiClient: StreamarrAPIClient) {
        self.mediaFileID = mediaFileID
        self.title = title
        _viewModel = State(initialValue: TVPlayerViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch viewModel.state {
            case .idle, .negotiating:
                ProgressView("Preparing \(title)…")
                    .tint(.white)
            case .ready:
                VideoPlayer(player: viewModel.player)
                    .ignoresSafeArea()
                    .overlay(alignment: .topTrailing) {
                        if let mode = viewModel.playbackMode {
                            Text(mode == .direct ? "Direct play" : "Streaming")
                                .font(.caption.bold())
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(.black.opacity(0.65), in: Capsule())
                                .padding(40)
                        }
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
}
