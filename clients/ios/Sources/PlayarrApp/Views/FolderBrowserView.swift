import Observation
import PlayarrKit
import SwiftUI
import UIKit

@MainActor
@Observable
private final class FolderThumbnailLoader {
    private static let cache = NSCache<NSUUID, UIImage>()
    var image: UIImage?

    func load(mediaFileID: UUID, apiClient: PlayarrAPIClient) async {
        let key = mediaFileID as NSUUID
        if let cached = Self.cache.object(forKey: key) {
            image = cached
            return
        }
        guard let data = try? await apiClient.fetchMediaThumbnail(mediaFileID: mediaFileID),
              let decoded = UIImage(data: data) else {
            return
        }
        Self.cache.setObject(decoded, forKey: key)
        image = decoded
    }
}

private struct FolderThumbnail: View {
    let entry: FolderEntry
    let apiClient: PlayarrAPIClient
    @State private var loader = FolderThumbnailLoader()

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [PlayarrStyle.pink.opacity(0.26), PlayarrStyle.surfaceStrong],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            if let image = loader.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: entry.audioCodec != nil && entry.videoCodec == nil ? "music.note" : "play.rectangle")
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(PlayarrStyle.pink)
            }
        }
        .clipped()
        .task(id: entry.thumbnailURL) {
            guard entry.thumbnailURL != nil,
                  let mediaFileID = entry.mediaFileID else { return }
            await loader.load(mediaFileID: mediaFileID, apiClient: apiClient)
        }
    }
}

struct FolderBrowserView: View {
    let kind: WorkKind
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var viewModel: FolderBrowserViewModel

    init(
        kind: WorkKind,
        apiClient: PlayarrAPIClient,
        downloadRepository: DownloadRepository
    ) {
        self.kind = kind
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        _viewModel = State(initialValue: FolderBrowserViewModel(apiClient: apiClient))
    }

    var body: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 12) {
                    rootPicker
                    breadcrumbs

                    if !viewModel.rootErrors.isEmpty {
                        sourceWarning
                    }

                    switch viewModel.loadState {
                    case .idle, .loading:
                        HStack(spacing: 12) {
                            ProgressView().tint(PlayarrStyle.pink)
                            Text("Reading folders…")
                                .foregroundStyle(PlayarrStyle.inkSoft)
                        }
                        .frame(maxWidth: .infinity, minHeight: 180)
                    case .failed(let message):
                        PlayarrFailureView(title: "Couldn’t open this folder", message: message) {
                            Task { await viewModel.refresh() }
                        }
                        .frame(minHeight: 260)
                    case .empty:
                        emptyState
                    case .loaded:
                        ForEach(viewModel.entries) { entry in
                            entryRow(entry)
                                .task {
                                    if entry.id == viewModel.entries.last?.id {
                                        await viewModel.loadMore()
                                    }
                                }
                        }
                        if viewModel.isLoadingMore {
                            ProgressView()
                                .tint(PlayarrStyle.pink)
                                .frame(maxWidth: .infinity)
                                .padding()
                        }
                    }
                }
                .padding(.top, phone ? 112 : max(132, proxy.size.height * 0.16))
                .padding(.horizontal, phone ? 16 : max(28, proxy.size.width * 0.04))
                .padding(.bottom, phone ? 118 : 60)
            }
            .scrollIndicators(.visible)
            .refreshable { await viewModel.refresh() }
        }
        .task(id: kind) {
            if case .idle = viewModel.loadState {
                await viewModel.loadRoots(kind: kind)
            }
        }
    }

    private var rootPicker: some View {
        Menu {
            ForEach(viewModel.roots) { root in
                Button {
                    Task { await viewModel.selectRoot(root) }
                } label: {
                    if root.id == viewModel.selectedRootID {
                        Label(rootLabel(root), systemImage: "checkmark")
                    } else {
                        Text(rootLabel(root))
                    }
                }
                .disabled(!root.available)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "externaldrive")
                    .foregroundStyle(PlayarrStyle.pink)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ROOT FOLDER")
                        .font(.caption2.weight(.bold))
                        .tracking(0.7)
                        .foregroundStyle(PlayarrStyle.muted)
                    Text(viewModel.selectedRoot.map(rootLabel) ?? "No root folders")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PlayarrStyle.ink)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.bold())
                    .foregroundStyle(PlayarrStyle.inkSoft)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 62)
            .background(PlayarrStyle.surfaceStrong.opacity(0.88), in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(PlayarrStyle.lineStrong, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(viewModel.roots.isEmpty)
        .accessibilityLabel("Select root folder")
    }

    @ViewBuilder
    private var breadcrumbs: some View {
        if let response = viewModel.browseResponse, !response.breadcrumbs.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Array(response.breadcrumbs.enumerated()), id: \.element.id) { index, crumb in
                        if index > 0 {
                            Image(systemName: "chevron.right")
                                .font(.caption2.bold())
                                .foregroundStyle(PlayarrStyle.muted)
                        }
                        Button(crumb.name) {
                            Task { await viewModel.open(path: crumb.path) }
                        }
                        .buttonStyle(.plain)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(
                            index == response.breadcrumbs.count - 1
                                ? PlayarrStyle.ink
                                : PlayarrStyle.pink
                        )
                    }
                }
                .padding(.vertical, 4)
            }
            .scrollIndicators(.visible)
        }
    }

    private var sourceWarning: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.rootErrors.map { "\($0.sourceName): \($0.message)" }.joined(separator: "\n"))
                .font(.caption)
                .foregroundStyle(PlayarrStyle.inkSoft)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.pink.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func entryRow(_ entry: FolderEntry) -> some View {
        if entry.entryType == .directory {
            Button {
                Task { await viewModel.open(path: entry.path) }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "folder.fill")
                        .font(.title2)
                        .foregroundStyle(PlayarrStyle.pink)
                        .frame(width: 72, height: 52)
                        .background(PlayarrStyle.surfaceStrong, in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(PlayarrStyle.ink)
                            .lineLimit(2)
                        Text("Folder")
                            .font(.caption)
                            .foregroundStyle(PlayarrStyle.muted)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.bold())
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .folderRowChrome()
            }
            .buttonStyle(.plain)
        } else if let mediaFileID = entry.mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: entry.title ?? entry.name
                )
            } label: {
                mediaRow(entry)
            }
            .buttonStyle(.plain)
        } else {
            mediaRow(entry).opacity(0.62)
        }
    }

    private func mediaRow(_ entry: FolderEntry) -> some View {
        HStack(spacing: 14) {
            FolderThumbnail(entry: entry, apiClient: apiClient)
                .frame(width: 72, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.title ?? entry.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(2)
                if let byline = [entry.artist, entry.album]
                    .compactMap({ $0 })
                    .filter({ !$0.isEmpty })
                    .joined(separator: " · ")
                    .nonEmpty {
                    Text(byline)
                        .font(.caption)
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .lineLimit(1)
                }
                Text(metadataLine(entry))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: entry.mediaFileID == nil ? "exclamationmark.circle" : "play.fill")
                .font(.caption.bold())
                .foregroundStyle(entry.mediaFileID == nil ? PlayarrStyle.muted : PlayarrStyle.pink)
        }
        .folderRowChrome()
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: viewModel.roots.isEmpty ? "externaldrive.badge.questionmark" : "folder")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.roots.isEmpty ? "No root folders" : "This folder is empty")
                .font(.headline)
                .foregroundStyle(PlayarrStyle.ink)
            if let reason = viewModel.selectedRoot?.unavailableReason {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(PlayarrStyle.muted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }

    private func rootLabel(_ root: FolderRoot) -> String {
        root.sourceName == root.name ? root.name : "\(root.sourceName) — \(root.name)"
    }

    private func metadataLine(_ entry: FolderEntry) -> String {
        var parts: [String] = []
        if let container = entry.container {
            parts.append(container.uppercased())
        }
        if let width = entry.width, let height = entry.height {
            parts.append("\(width)×\(height)")
        }
        if let durationMS = entry.durationMS {
            let totalSeconds = durationMS / 1_000
            parts.append("\(totalSeconds / 60):\(String(format: "%02llu", totalSeconds % 60))")
        }
        if let sizeBytes = entry.sizeBytes {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(clamping: sizeBytes), countStyle: .file))
        }
        return parts.isEmpty ? entry.name : parts.joined(separator: " · ")
    }
}

private extension View {
    func folderRowChrome() -> some View {
        self
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(PlayarrStyle.surfaceStrong.opacity(0.72), in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(PlayarrStyle.line, lineWidth: 1)
            }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
