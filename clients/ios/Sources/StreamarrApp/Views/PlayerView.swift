import AVKit
import StreamarrKit
import SwiftUI

struct PlayerView: View {
    let apiClient: StreamarrAPIClient
    let mediaFileID: UUID?
    let title: String

    @State private var viewModel: PlayerViewModel?
    @State private var controlsVisible = true

    init(apiClient: StreamarrAPIClient, initialMediaFileID: String = "", initialTitle: String = "") {
        self.apiClient = apiClient
        self.mediaFileID = UUID(uuidString: initialMediaFileID)
        self.title = initialTitle
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch viewModel?.loadState {
            case nil, .idle, .loadingPlaybackInfo:
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
                if let viewModel {
                    VideoPlayer(player: viewModel.avPlayer)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation { controlsVisible.toggle() } }

                    if controlsVisible {
                        controls(viewModel)
                            .transition(.opacity)
                    }
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .playarrChromeHidden()
        .task {
            if viewModel == nil {
                viewModel = PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient)
            }
            if case .idle = viewModel?.loadState { startPlayback() }
        }
        .onDisappear { viewModel?.stop() }
    }

    private func controls(_ viewModel: PlayerViewModel) -> some View {
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

                ScrollView(.horizontal) {
                    HStack(spacing: 10) {
                        if !viewModel.qualityOptions.isEmpty {
                            Menu {
                                ForEach(viewModel.qualityOptions) { option in
                                    Button {
                                        Task { await viewModel.selectQuality(option.id) }
                                    } label: {
                                        if option.id == viewModel.selectedQualityID {
                                            Label(option.label, systemImage: "checkmark")
                                        } else { Text(option.label) }
                                    }
                                }
                            } label: { controlChip("Quality", icon: "slider.horizontal.3") }
                        }

                        if !viewModel.audioTracks.isEmpty {
                            Menu {
                                ForEach(viewModel.audioTracks) { track in
                                    Button {
                                        Task { await viewModel.selectAudioTrack(track.id) }
                                    } label: {
                                        if track.id == viewModel.selectedAudioTrackID {
                                            Label(track.label, systemImage: "checkmark")
                                        } else { Text(track.label) }
                                    }
                                }
                            } label: { controlChip("Audio", icon: "speaker.wave.2") }
                        }

                        Menu {
                            Button {
                                Task { await viewModel.selectSubtitleTrack(nil) }
                            } label: {
                                if viewModel.selectedSubtitleTrackID == nil {
                                    Label("Off", systemImage: "checkmark")
                                } else { Text("Off") }
                            }
                            ForEach(viewModel.subtitleTracks) { track in
                                Button {
                                    Task { await viewModel.selectSubtitleTrack(track.id) }
                                } label: {
                                    if track.id == viewModel.selectedSubtitleTrackID {
                                        Label(track.label, systemImage: "checkmark")
                                    } else { Text(track.label) }
                                }
                            }
                        } label: { controlChip("Subtitles", icon: "captions.bubble") }

                        if !viewModel.chapters.isEmpty {
                            Menu {
                                ForEach(viewModel.chapters) { chapter in
                                    Button {
                                        Task { await viewModel.seek(to: Double(chapter.startMS) / 1_000) }
                                    } label: {
                                        Text(chapter.title ?? Self.formatted(Double(chapter.startMS) / 1_000))
                                    }
                                }
                            } label: { controlChip("Chapters", icon: "list.bullet") }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            .padding(20)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .padding()
        }
        .foregroundStyle(.white)
    }

    private func controlChip(_ label: String, icon: String) -> some View {
        Label(label, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(.white.opacity(0.12), in: Capsule())
            .overlay { Capsule().stroke(.white.opacity(0.18), lineWidth: 1) }
    }

    private func startPlayback() {
        guard let mediaFileID, let viewModel else { return }
        Task { await viewModel.play(mediaFileID: mediaFileID, title: title) }
    }

    private static func formatted(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "--:--" }
        let totalSeconds = Int(seconds)
        return String(format: "%02d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}
