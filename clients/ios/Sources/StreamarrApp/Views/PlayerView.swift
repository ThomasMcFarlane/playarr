import AVKit
import StreamarrKit
import SwiftUI

struct PlayerView: View {
    let viewModel: PlayerViewModel
    let mediaFileID: UUID?
    let title: String

    @State private var controlsVisible = true

    init(viewModel: PlayerViewModel, initialMediaFileID: String = "", initialTitle: String = "") {
        self.viewModel = viewModel
        self.mediaFileID = UUID(uuidString: initialMediaFileID)
        self.title = initialTitle
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch viewModel.loadState {
            case .idle, .loadingPlaybackInfo:
                VStack(spacing: 14) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text("Preparing playback…")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.72))
                }
            case .failed(let message):
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(PlayarrStyle.pink)
                    Text("Playback failed").font(.title2.bold())
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center)
                    if mediaFileID != nil {
                        Button("Try again") { startPlayback() }
                            .buttonStyle(PlayarrPrimaryButtonStyle())
                    }
                }
                .foregroundStyle(.white)
                .padding(30)
            case .playing:
                VideoPlayer(player: viewModel.avPlayer)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation { controlsVisible.toggle() } }

                if controlsVisible {
                    controls
                        .transition(.opacity)
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if case .idle = viewModel.loadState { startPlayback() }
        }
        .onDisappear { viewModel.stop() }
    }

    private var controls: some View {
        VStack {
            Spacer()
            VStack(spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title.isEmpty ? "Now playing" : title)
                            .font(.headline)
                            .lineLimit(1)
                        if let mode = viewModel.playbackMode {
                            Text(mode == .direct ? "Direct play" : "Adaptive stream")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.58))
                        }
                    }
                    Spacer()
                    Button {
                        viewModel.togglePlayPause()
                    } label: {
                        Image(systemName: viewModel.engineState == .playing ? "pause.fill" : "play.fill")
                            .font(.title2)
                            .frame(width: 48, height: 48)
                            .background(.white, in: Circle())
                            .foregroundStyle(.black)
                    }
                }

                Slider(
                    value: Binding(
                        get: { viewModel.currentTime },
                        set: { value in Task { await viewModel.seek(to: value) } }
                    ),
                    in: 0...max(viewModel.duration, 1)
                )
                .tint(PlayarrStyle.pink)

                HStack {
                    Text(Self.formatted(viewModel.currentTime))
                    Spacer()
                    Text(Self.formatted(viewModel.duration))
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white.opacity(0.58))
            }
            .padding(20)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .padding()
        }
        .foregroundStyle(.white)
    }

    private func startPlayback() {
        guard let mediaFileID else { return }
        Task { await viewModel.play(mediaFileID: mediaFileID, title: title) }
    }

    private static func formatted(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "--:--" }
        let totalSeconds = Int(seconds)
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}
