import PlayarrKit
import SwiftUI

enum PlayarrByteFormat {
    private static let formatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()

    static func string(_ bytes: Int64?) -> String? {
        guard let bytes else { return nil }
        return formatter.string(fromByteCount: bytes)
    }
}

struct DownloadsView: View {
    @State private var viewModel: DownloadsViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository

    init(repository: DownloadRepository, apiClient: PlayarrAPIClient) {
        _viewModel = State(initialValue: DownloadsViewModel(repository: repository))
        self.apiClient = apiClient
        self.downloadRepository = repository
    }

    @Environment(\.playarrGoHome) private var goHome

    private var isPhone: Bool { PlayarrLayout.isPhone(UIScreen.main.bounds.size) }

    var body: some View {
        Group {
            if viewModel.isEmpty && isPhone {
                phoneEmpty
            } else if viewModel.isEmpty {
                emptyState
            } else {
                content
            }
        }
        .background(PlayarrStyle.surface)
        .navigationBarHidden(viewModel.isEmpty && isPhone)
        .navigationTitle("Downloads")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { viewModel.refresh() }
        .onAppear { viewModel.refresh() }
    }

    /// Web mobile Downloads page with nothing downloaded: storage line and bar, then the empty state.
    private var phoneEmpty: some View {
        ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            WMText("\(PlayarrByteFormat.string(viewModel.storageUsedBytes) ?? "0 KB") used on this device", 8, 400, color: WM.muted, lh: 12)
                .frame(width: 342, alignment: .leading)
                .offset(x: 24, y: 24)
            Capsule().fill(WM.artFill).frame(width: 342, height: 4).offset(x: 24, y: 44)
            WMEmptyStateRow(
                title: "No downloads yet",
                description: "Download a title from its detail page to watch it without a connection."
            )
            .offset(x: 37, y: 80)
            WMHeaderCircleButton(width: 44, height: 40, glyph: "\u{2190}", action: goHome)
                .offset(x: 15, y: WM.topInset + 1)
            WMText("Downloads", 21.6, 580, lh: 32, ls: -0.972).offset(x: 68, y: WM.topInset + 5)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
    }

    private var content: some View {
        List {
            section("Downloading", records: viewModel.downloading, isActive: true)
            section("Queued", records: viewModel.queued, isActive: true)
            section("Completed", records: viewModel.completed, isActive: false)
            section("Failed", records: viewModel.failed, isActive: false)

            Section {
                HStack {
                    Text("Storage used")
                        .foregroundStyle(PlayarrStyle.inkSoft)
                    Spacer()
                    Text(PlayarrByteFormat.string(viewModel.storageUsedBytes) ?? "0 KB")
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .font(.footnote.weight(.semibold))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { viewModel.refresh() }
    }

    @ViewBuilder
    private func section(_ title: String, records: [DownloadRecord], isActive: Bool) -> some View {
        if !records.isEmpty {
            Section(title) {
                ForEach(records, id: \.mediaFileID) { record in
                    row(for: record)
                }
            }
        }
    }

    @ViewBuilder
    private func row(for record: DownloadRecord) -> some View {
        if record.state == .completed {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: record.mediaFileID.uuidString,
                    initialTitle: record.title,
                    // A downloaded file plays from a sandboxed `file://`
                    // URL, unreachable from a real Chromecast device -- hide
                    // the cast affordance rather than let it silently fail.
                    isOfflinePlayback: true
                )
            } label: {
                DownloadRow(record: record)
            }
            .swipeActions(edge: .trailing) {
                Button("Delete", systemImage: "trash", role: .destructive) { viewModel.delete(record) }
            }
        } else {
            DownloadRow(record: record)
                .swipeActions(edge: .trailing) {
                    Button("Delete", systemImage: "trash", role: .destructive) { viewModel.delete(record) }
                }
                .swipeActions(edge: .leading) {
                    if record.state == .paused || record.state == .failed {
                        Button("Resume", systemImage: "arrow.down.circle") { viewModel.resume(record) }
                            .tint(PlayarrStyle.pink)
                    } else if record.state == .downloading {
                        Button("Pause", systemImage: "pause.circle") { viewModel.pause(record) }
                    }
                }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 46, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text("No downloads yet")
                .font(.custom("Avenir Next", fixedSize: 20).weight(.bold))
            Text("Downloaded titles play back without a connection.")
                .font(.custom("Avenir Next", fixedSize: 12))
                .foregroundStyle(PlayarrStyle.inkSoft)
                .multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(PlayarrStyle.ink)
        .background(PlayarrStyle.surface)
    }
}

private struct DownloadRow: View {
    let record: DownloadRecord

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(PlayarrStyle.surfaceStrong)
                Image(systemName: iconName)
                    .foregroundStyle(record.state == .failed ? PlayarrStyle.danger : PlayarrStyle.pink)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 4) {
                Text(record.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(1)

                if record.state == .downloading || record.state == .paused {
                    ProgressView(value: record.progressFraction)
                        .tint(PlayarrStyle.pink)
                }

                Text(statusLine)
                    .font(.caption)
                    .foregroundStyle(record.state == .failed ? PlayarrStyle.danger : PlayarrStyle.muted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    private var iconName: String {
        switch record.state {
        case .queued, .preparing: "clock"
        case .downloading: "arrow.down.circle"
        case .paused: "pause.circle"
        case .completed: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle"
        }
    }

    private var statusLine: String {
        switch record.state {
        case .queued:
            return "Queued"
        case .preparing:
            return "Preparing…"
        case .downloading:
            let written = PlayarrByteFormat.string(record.bytesWritten) ?? "0 KB"
            if let total = PlayarrByteFormat.string(record.totalBytes) {
                return "\(written) of \(total)"
            }
            return "\(written) downloaded"
        case .paused:
            return "Paused"
        case .completed:
            return PlayarrByteFormat.string(record.totalBytes ?? record.bytesWritten) ?? "Downloaded"
        case .failed:
            return record.errorMessage ?? "Download failed"
        }
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        DownloadsView(repository: DownloadRepository(apiClient: apiClient), apiClient: apiClient)
    }
}
