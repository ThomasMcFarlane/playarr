import AVKit
import StreamarrKit
import SwiftUI

struct PlayerView: View {
    let viewModel: PlayerViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VideoPlayer(player: viewModel.avPlayer)
                    .aspectRatio(16.0 / 9.0, contentMode: .fit)
                    .background(Color.black)

                PlaybackControlsView(viewModel: viewModel)
                    .padding()

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                Spacer()
            }
            .navigationTitle("Now Playing")
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
    PlayerView(viewModel: PlayerViewModel(engine: AVPlayerEngine(), apiClient: PreviewAPIClient()))
}
