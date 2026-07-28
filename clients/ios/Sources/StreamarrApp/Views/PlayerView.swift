import AVKit
import StreamarrKit
import SwiftUI

struct PlayerView: View {
    let apiClient: StreamarrAPIClient
    let downloadRepository: DownloadRepository
    let mediaFileID: UUID?
    let title: String
    /// `true` for `DownloadsView`'s completed-download row -- a sandboxed
    /// `file://` URL is unreachable from a real Chromecast device, so the
    /// cast affordance is hidden rather than left to silently fail. Also
    /// backstopped by `viewModel.isPlayingLocalFile`, which catches the
    /// same case if it's ever reached some other way.
    let isOfflinePlayback: Bool

    @State private var viewModel: PlayerViewModel?
    @State private var controlsVisible = true
    private let castCoordinator = CastSessionCoordinator.shared

    init(
        apiClient: StreamarrAPIClient,
        downloadRepository: DownloadRepository,
        initialMediaFileID: String = "",
        initialTitle: String = "",
        isOfflinePlayback: Bool = false
    ) {
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.mediaFileID = UUID(uuidString: initialMediaFileID)
        self.title = initialTitle
        self.isOfflinePlayback = isOfflinePlayback
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
                    if castCoordinator.isCasting {
                        nowCastingCard
                    } else {
                        VideoPlayer(player: viewModel.avPlayer)
                        .ignoresSafeArea()
                        .onTapGesture { withAnimation { controlsVisible.toggle() } }
                    }

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
        .overlay(alignment: .topTrailing) {
            if showsCastAffordance {
                CastButton(tintColor: .white)
                    .frame(width: 32, height: 32)
                    .padding(20)
            }
        }
        .task {
            if viewModel == nil {
                viewModel = PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient, downloadRepository: downloadRepository, castCoordinator: castCoordinator)
            }
            if case .idle = viewModel?.loadState { startPlayback() }
        }
        .onDisappear { viewModel?.viewDidDisappear() }
    }

    private var showsCastAffordance: Bool {
        CastSessionCoordinator.isConfigured && !isOfflinePlayback && viewModel?.isPlayingLocalFile != true
    }

    private var nowCastingCard: some View {
        VStack(spacing: 18) {
            Image(systemName: "tv.badge.wifi")
                .font(.system(size: 54, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text("Now casting")
                .font(.custom("Avenir Next", fixedSize: 13).weight(.bold))
                .foregroundStyle(.white.opacity(0.6))
                .textCase(.uppercase)
            Text(title.isEmpty ? "Playarr" : title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            if case .connected(let deviceName) = castCoordinator.connectionState {
                Text("Playing on \(deviceName)")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.65))
            }
            Button("Stop casting") {
                castCoordinator.endSession(reason: .userStopped)
            }
            .buttonStyle(.bordered)
            .tint(.white)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white)
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

                // NB: while `castCoordinator.isCasting`, these three menus
                // still list whatever `viewModel.qualityOptions`/
                // `audioTracks`/`subtitleTracks` were populated from the
                // *local* negotiation right before the cast handoff --
                // `viewModel.selectQuality`/`selectAudioTrack`/
                // `selectSubtitleTrack` already correctly route the
                // resulting *selection* to the receiver over the cast
                // channel (see `PlayerViewModel`), but the menu *contents*
                // aren't re-synced from the receiver's own live
                // `PlayarrCastStateMessage.qualityOptions`/`audioTracks`/
                // `subtitleTracks` (a different, cast-protocol-shaped
                // type) in this pass. Known, scoped-out gap -- not a
                // functional break, just a possibly-stale option list.
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
