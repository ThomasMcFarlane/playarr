import AVKit
import StreamarrKit
import SwiftUI

struct PlayerView: View {
    let viewModel: PlayerViewModel

    @State private var mediaFileIDText: String
    @State private var titleText: String

    init(viewModel: PlayerViewModel, initialMediaFileID: String = "", initialTitle: String = "") {
        self.viewModel = viewModel
        _mediaFileIDText = State(initialValue: initialMediaFileID)
        _titleText = State(initialValue: initialTitle)
    }

    // Deliberately no `NavigationStack` of its own: this view is pushed via
    // `NavigationLink` from `WorkDetailView` (already inside a
    // `NavigationStack`) as well as hosted directly as a tab root in
    // `RootView` (which wraps it in one there). Nesting a second
    // `NavigationStack` inside an already-pushed one breaks the back
    // button/nav-bar, so the wrapping is the call site's job, not this
    // view's.
    var body: some View {
        VStack(spacing: 0) {
            switch viewModel.loadState {
            case .idle, .failed:
                playbackForm
            case .loadingPlaybackInfo:
                ProgressView("Negotiating playback…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .playing:
                playbackPlayer
            }

            if case .failed(let message) = viewModel.loadState {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding()
            }

            Spacer()
        }
        .navigationTitle("Now Playing")
    }

    private var playbackForm: some View {
        Form {
            Section("Media file") {
                TextField("Title", text: $titleText)
                TextField("Media File ID (UUID)", text: $mediaFileIDText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Text(
                    "The catalog API doesn't expose a media_file_id for a title yet (see WorkDetailViewModel), " +
                    "so playback is driven directly by id here — this still calls the real " +
                    "GET /api/v1/playback/{media_file_id} negotiation endpoint."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Button("Play") {
                guard let mediaFileID = UUID(uuidString: mediaFileIDText) else { return }
                Task { await viewModel.play(mediaFileID: mediaFileID, title: titleText) }
            }
            .disabled(UUID(uuidString: mediaFileIDText) == nil)
        }
    }

    private var playbackPlayer: some View {
        VStack(spacing: 0) {
            VideoPlayer(player: viewModel.avPlayer)
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .background(Color.black)

            PlaybackControlsView(viewModel: viewModel)
                .padding()

            if let mode = viewModel.playbackMode {
                Text("Playback mode: \(mode.rawValue)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button("Stop", role: .destructive) {
                viewModel.stop()
            }
            .padding(.bottom)
        }
    }
}

private struct PlaybackControlsView: View {
    let viewModel: PlayerViewModel

    var body: some View {
        VStack(spacing: 12) {
            Slider(
                value: Binding(
                    get: { viewModel.currentTime },
                    set: { newValue in Task { await viewModel.seek(to: newValue) } }
                ),
                in: 0...max(viewModel.duration, 1)
            )

            HStack {
                Text(Self.formatted(viewModel.currentTime))
                Spacer()
                Text(Self.formatted(viewModel.duration))
            }
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)

            Button {
                viewModel.togglePlayPause()
            } label: {
                Image(systemName: viewModel.engineState == .playing ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 44))
            }
            .buttonStyle(.plain)
        }
    }

    private static func formatted(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "--:--" }
        let totalSeconds = Int(seconds)
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}

#Preview {
    NavigationStack {
        PlayerView(viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: PreviewAPIClient()))
    }
}
