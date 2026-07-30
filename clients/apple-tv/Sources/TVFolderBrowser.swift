import Foundation
import Observation
import PlayarrKit
import SwiftUI
import UIKit

/// Library presentation choices exposed by the existing Filters control.
enum TVLibraryViewMode: String, CaseIterable, Identifiable {
    case library
    case folders

    var id: String { rawValue }

    var label: String {
        switch self {
        case .library: return "Library"
        case .folders: return "Folders"
        }
    }

    var systemImage: String {
        switch self {
        case .library: return "rectangle.grid.3x2"
        case .folders: return "folder"
        }
    }
}

/// The folder-only slice of PlayarrKit's API used by the tvOS browser.
///
/// Keeping this adapter narrow makes the folder state independently testable
/// without replacing the complete signed-in Playarr client.
protocol TVFolderBrowsingAPI: Sendable {
    func listFolderRoots(kind: WorkKind) async throws -> FolderRootsResponse
    func browseFolder(
        rootID: UUID,
        path: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> FolderBrowseResponse
}

struct TVPlayarrFolderAPI: TVFolderBrowsingAPI {
    let client: PlayarrAPIClient

    func listFolderRoots(kind: WorkKind) async throws -> FolderRootsResponse {
        try await client.listFolderRoots(kind: kind)
    }

    func browseFolder(
        rootID: UUID,
        path: String?,
        limit: Int?,
        offset: Int?
    ) async throws -> FolderBrowseResponse {
        try await client.browseFolder(
            rootID: rootID,
            path: path,
            limit: limit,
            offset: offset
        )
    }
}

enum TVFolderLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

@MainActor
@Observable
final class TVFolderBrowserViewModel {
    static let pageSize = 100

    private(set) var rootsState: TVFolderLoadState = .idle
    private(set) var directoryState: TVFolderLoadState = .idle
    private(set) var roots: [FolderRoot] = []
    private(set) var rootErrors: [FolderRootError] = []
    private(set) var selectedRootID: UUID?
    private(set) var directory: FolderBrowseResponse?
    private(set) var requestedPath = ""
    private(set) var loadingMore = false
    private(set) var paginationError: String?

    private let api: TVFolderBrowsingAPI
    private var rootsRequest = 0
    private var directoryRequest = 0

    init(api: TVFolderBrowsingAPI) {
        self.api = api
    }

    var selectedRoot: FolderRoot? {
        roots.first { $0.id == selectedRootID }
    }

    var canLoadMore: Bool {
        guard let directory else { return false }
        return Int64(directory.entries.count) < directory.total
    }

    func load(kind: WorkKind) async {
        rootsRequest += 1
        let request = rootsRequest
        rootsState = .loading
        rootErrors = []

        do {
            let response = try await api.listFolderRoots(kind: kind)
            guard request == rootsRequest else { return }

            roots = response.roots
            rootErrors = response.errors
            rootsState = .loaded

            let retainedRoot = roots.first {
                $0.id == selectedRootID && $0.available
            }
            let root = retainedRoot ?? roots.first(where: { $0.available })
            selectedRootID = root?.id
            directory = nil
            directoryState = .idle

            if let root {
                await open(rootID: root.id, path: "")
            }
        } catch is CancellationError {
            return
        } catch {
            guard request == rootsRequest else { return }
            roots = []
            selectedRootID = nil
            directory = nil
            directoryState = .idle
            rootsState = .failed(Self.message(for: error))
        }
    }

    func select(_ root: FolderRoot) async {
        guard root.available else { return }
        selectedRootID = root.id
        await open(rootID: root.id, path: "")
    }

    func open(rootID: UUID, path: String, append: Bool = false) async {
        let normalisedPath = path
            .split(separator: "/", omittingEmptySubsequences: true)
            .joined(separator: "/")
        let current = directory
        let isValidAppend = append
            && current?.root.id == rootID
            && current?.path == normalisedPath
            && current.map { Int64($0.entries.count) < $0.total } == true
        guard !append || isValidAppend else { return }

        directoryRequest += 1
        let request = directoryRequest
        selectedRootID = rootID
        requestedPath = normalisedPath
        paginationError = nil

        if isValidAppend {
            loadingMore = true
        } else {
            directory = nil
            directoryState = .loading
        }

        do {
            let response = try await api.browseFolder(
                rootID: rootID,
                path: normalisedPath.isEmpty ? nil : normalisedPath,
                limit: Self.pageSize,
                offset: isValidAppend ? (current?.entries.count ?? 0) : 0
            )
            guard request == directoryRequest else { return }

            if isValidAppend, let current {
                let existingIDs = Set(current.entries.map(\.id))
                let newEntries = response.entries.filter {
                    !existingIDs.contains($0.id)
                }
                let entries = current.entries + newEntries
                directory = FolderBrowseResponse(
                    root: response.root,
                    path: response.path,
                    breadcrumbs: response.breadcrumbs,
                    entries: entries,
                    total: response.total,
                    offset: 0,
                    limit: entries.count
                )
            } else {
                directory = response
            }
            directoryState = .loaded
            loadingMore = false
        } catch is CancellationError {
            guard request == directoryRequest else { return }
            loadingMore = false
        } catch {
            guard request == directoryRequest else { return }
            loadingMore = false
            if isValidAppend {
                paginationError = Self.message(for: error)
            } else {
                directory = nil
                directoryState = .failed(Self.message(for: error))
            }
        }
    }

    func loadMore() async {
        guard let directory, canLoadMore, !loadingMore else { return }
        await open(rootID: directory.root.id, path: directory.path, append: true)
    }

    func retryDirectory() async {
        guard let selectedRootID else { return }
        await open(rootID: selectedRootID, path: requestedPath)
    }

    private static func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.displayMessage
        }
        return error.localizedDescription
    }
}

struct TVFolderBrowserView: View {
    let kindLabel: String
    let workKind: WorkKind
    let apiClient: PlayarrAPIClient
    let onClose: () -> Void

    @State private var viewModel: TVFolderBrowserViewModel

    init(
        kindLabel: String,
        workKind: WorkKind,
        apiClient: PlayarrAPIClient,
        onClose: @escaping () -> Void
    ) {
        self.kindLabel = kindLabel
        self.workKind = workKind
        self.apiClient = apiClient
        self.onClose = onClose
        _viewModel = State(
            initialValue: TVFolderBrowserViewModel(
                api: TVPlayarrFolderAPI(client: apiClient)
            )
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            folderHeading
            rootsContent
            rootErrorContent
            directoryContent
        }
        .padding(.top, 104)
        .padding(.leading, 34)
        .padding(.trailing, 86)
        .padding(.bottom, 36)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DesignTokens.Color.backgroundBase)
        .task(id: "\(workKind.rawValue)-\(apiClient.baseURL.absoluteString)") {
            await viewModel.load(kind: workKind)
        }
        .onExitCommand {
            if let directory = viewModel.directory, !directory.path.isEmpty {
                Task {
                    await viewModel.open(
                        rootID: directory.root.id,
                        path: tvFolderParentPath(directory.path)
                    )
                }
            } else {
                onClose()
            }
        }
    }

    private var folderHeading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 18) {
            Text("\(kindLabel) folders")
                .font(TVTheme.font(size: 31, weight: .medium))
                .tracking(-1.3)
                .foregroundStyle(DesignTokens.Color.textPrimary)
            if let directory = viewModel.directory {
                Text("\(directory.total) ITEMS")
                    .font(TVTheme.font(size: 11, weight: .heavy))
                    .tracking(0.8)
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
            Spacer()
        }
    }

    @ViewBuilder
    private var rootsContent: some View {
        switch viewModel.rootsState {
        case .idle, .loading:
            ProgressView("Loading root folders…")
                .tint(DesignTokens.Color.brandPrimary)
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .failed(let message):
            TVFolderInlineError(message: message) {
                Task { await viewModel.load(kind: workKind) }
            }
        case .loaded where viewModel.roots.isEmpty:
            ContentUnavailableView(
                "No root folders",
                systemImage: "folder.badge.questionmark",
                description: Text("No source exposed a root folder for \(kindLabel.lowercased()).")
            )
            .foregroundStyle(DesignTokens.Color.textSecondary)
        case .loaded:
            ScrollView(.horizontal, showsIndicators: true) {
                LazyHStack(spacing: 14) {
                    ForEach(viewModel.roots) { root in
                        Button {
                            Task { await viewModel.select(root) }
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 8) {
                                    Image(systemName: root.available ? "folder.fill" : "folder.badge.minus")
                                    Text(root.name)
                                        .lineLimit(1)
                                }
                                .font(TVTheme.font(size: 15, weight: .semibold))
                                Text(root.sourceName)
                                    .font(TVTheme.font(size: 10, weight: .medium))
                                    .foregroundStyle(DesignTokens.Color.textSecondary)
                                    .lineLimit(1)
                                if let reason = root.unavailableReason, !root.available {
                                    Text(reason)
                                        .font(TVTheme.font(size: 9, weight: .regular))
                                        .foregroundStyle(DesignTokens.Color.textDisabled)
                                        .lineLimit(2)
                                }
                            }
                            .foregroundStyle(
                                root.available
                                    ? DesignTokens.Color.textPrimary
                                    : DesignTokens.Color.textDisabled
                            )
                            .frame(width: 240, minHeight: 70, alignment: .leading)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(
                                        root.id == viewModel.selectedRootID
                                            ? DesignTokens.Color.backgroundElevated
                                            : DesignTokens.Color.backgroundRaised.opacity(0.82)
                                    )
                            )
                        }
                        .buttonStyle(TVFolderButtonStyle())
                        .disabled(!root.available)
                        .opacity(root.available ? 1 : 0.65)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .frame(height: 116)
            .focusSection()
        }
    }

    @ViewBuilder
    private var rootErrorContent: some View {
        if !viewModel.rootErrors.isEmpty {
            Label {
                Text(
                    viewModel.rootErrors
                        .map { "\($0.sourceName): \($0.message)" }
                        .joined(separator: "\n")
                )
                .lineLimit(2)
            } icon: {
                Image(systemName: "exclamationmark.triangle")
            }
            .font(TVTheme.font(size: 10, weight: .medium))
            .foregroundStyle(DesignTokens.Color.textSecondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(DesignTokens.Color.backgroundRaised.opacity(0.8))
            )
        }
    }

    @ViewBuilder
    private var directoryContent: some View {
        switch viewModel.directoryState {
        case .idle:
            if viewModel.rootsState == .loaded, !viewModel.roots.isEmpty {
                ContentUnavailableView(
                    "No available root",
                    systemImage: "externaldrive.badge.xmark",
                    description: Text("Mount a root folder on this Playarr Server to browse it.")
                )
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        case .loading:
            ProgressView("Reading folder…")
                .tint(DesignTokens.Color.brandPrimary)
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            TVFolderInlineError(message: message) {
                Task { await viewModel.retryDirectory() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            if let directory = viewModel.directory {
                directoryView(directory)
            }
        }
    }

    private func directoryView(_ directory: FolderBrowseResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            breadcrumbBar(directory)

            if directory.entries.isEmpty {
                ContentUnavailableView(
                    "This folder is empty",
                    systemImage: "folder",
                    description: Text("No playable media or subfolders were found.")
                )
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(.vertical, showsIndicators: true) {
                    LazyVStack(spacing: 10) {
                        ForEach(directory.entries) { entry in
                            entryControl(entry)
                        }

                        if viewModel.canLoadMore {
                            Button {
                                Task { await viewModel.loadMore() }
                            } label: {
                                HStack(spacing: 12) {
                                    if viewModel.loadingMore {
                                        ProgressView()
                                            .tint(DesignTokens.Color.textPrimary)
                                    } else {
                                        Image(systemName: "arrow.down.circle")
                                    }
                                    Text(viewModel.loadingMore ? "Loading…" : "Load more")
                                }
                                .font(TVTheme.font(size: 13, weight: .semibold))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .padding(.horizontal, 22)
                                .padding(.vertical, 14)
                                .background(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .fill(DesignTokens.Color.backgroundRaised)
                                )
                            }
                            .buttonStyle(TVFolderButtonStyle())
                            .disabled(viewModel.loadingMore)
                        }

                        if let paginationError = viewModel.paginationError {
                            Text(paginationError)
                                .font(TVTheme.captionFont())
                                .foregroundStyle(DesignTokens.Color.stateError)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                }
                .focusSection()
            }
        }
    }

    private func breadcrumbBar(_ directory: FolderBrowseResponse) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 7) {
                ForEach(Array(directory.breadcrumbs.enumerated()), id: \.element.id) { index, breadcrumb in
                    if index > 0 {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                    }
                    Button {
                        Task {
                            await viewModel.open(
                                rootID: directory.root.id,
                                path: breadcrumb.path
                            )
                        }
                    } label: {
                        Text(breadcrumb.name)
                            .font(TVTheme.font(size: 11, weight: .semibold))
                            .foregroundStyle(
                                breadcrumb.path == directory.path
                                    ? DesignTokens.Color.textPrimary
                                    : DesignTokens.Color.textSecondary
                            )
                            .lineLimit(1)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 9)
                            .background(
                                Capsule()
                                    .fill(
                                        breadcrumb.path == directory.path
                                            ? DesignTokens.Color.backgroundElevated
                                            : DesignTokens.Color.backgroundRaised.opacity(0.68)
                                    )
                            )
                    }
                    .buttonStyle(TVFolderButtonStyle(shape: .capsule))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .frame(height: 58)
        .focusSection()
    }

    @ViewBuilder
    private func entryControl(_ entry: FolderEntry) -> some View {
        switch entry.entryType {
        case .directory:
            Button {
                guard let selectedRootID = viewModel.selectedRootID else { return }
                Task { await viewModel.open(rootID: selectedRootID, path: entry.path) }
            } label: {
                TVFolderEntryLabel(entry: entry, apiClient: apiClient)
            }
            .buttonStyle(TVFolderButtonStyle())
        case .media:
            if let mediaFileID = entry.mediaFileID {
                NavigationLink {
                    TVPlayerView(
                        mediaFileID: mediaFileID,
                        title: tvFolderDisplayTitle(entry),
                        apiClient: apiClient
                    )
                } label: {
                    TVFolderEntryLabel(entry: entry, apiClient: apiClient)
                }
                .buttonStyle(TVFolderButtonStyle())
            } else {
                TVFolderEntryLabel(entry: entry, apiClient: apiClient)
                    .opacity(0.55)
            }
        }
    }
}

private struct TVFolderEntryLabel: View {
    let entry: FolderEntry
    let apiClient: PlayarrAPIClient

    var body: some View {
        HStack(spacing: 18) {
            Group {
                if entry.entryType == .directory {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 34, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                } else if entry.thumbnailURL != nil,
                          let mediaFileID = entry.mediaFileID {
                    TVAuthenticatedFolderThumbnail(
                        mediaFileID: mediaFileID,
                        apiClient: apiClient
                    )
                } else {
                    Image(
                        systemName: entry.audioCodec != nil && entry.videoCodec == nil
                            ? "music.note"
                            : "play.rectangle"
                    )
                        .font(.system(size: 32, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                }
            }
            .frame(width: 156, height: 88)
            .background(DesignTokens.Color.backgroundElevated)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                Text(tvFolderDisplayTitle(entry))
                    .font(TVTheme.font(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                if entry.entryType == .media,
                   entry.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                    Text(entry.name)
                        .font(TVTheme.font(size: 9, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .lineLimit(1)
                }
                let metadata = tvFolderMetadata(entry)
                if !metadata.isEmpty {
                    Text(metadata)
                        .font(TVTheme.font(size: 10, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Image(systemName: entry.entryType == .directory ? "chevron.right" : "play.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(
                    entry.entryType == .media && entry.mediaFileID == nil
                        ? DesignTokens.Color.textDisabled
                        : DesignTokens.Color.brandPrimary
                )
                .padding(.trailing, 8)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 106, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DesignTokens.Color.backgroundRaised.opacity(0.78))
        )
    }
}

private struct TVAuthenticatedFolderThumbnail: View {
    let mediaFileID: UUID
    let apiClient: PlayarrAPIClient

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            DesignTokens.Color.backgroundElevated
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "play.rectangle")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
        }
        .clipped()
        .task(id: mediaFileID) {
            guard image == nil else { return }
            guard let data = try? await apiClient.fetchMediaThumbnail(mediaFileID: mediaFileID) else {
                return
            }
            image = UIImage(data: data)
        }
    }
}

private struct TVFolderInlineError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Label("Couldn’t load folders", systemImage: "exclamationmark.triangle")
                .font(TVTheme.font(size: 17, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text(message)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding(24)
    }
}

private enum TVFolderButtonShape {
    case rounded
    case capsule
}

private struct TVFolderButtonStyle: ButtonStyle {
    var shape: TVFolderButtonShape = .rounded

    func makeBody(configuration: Configuration) -> some View {
        TVFolderButtonStyleBody(
            isPressed: configuration.isPressed,
            shape: shape
        ) {
            configuration.label
        }
    }
}

private struct TVFolderButtonStyleBody<Content: View>: View {
    @Environment(\.isFocused) private var isFocused
    let isPressed: Bool
    let shape: TVFolderButtonShape
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .overlay {
                switch shape {
                case .rounded:
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(
                            isFocused
                                ? DesignTokens.Color.brandPrimary
                                : Color.clear,
                            lineWidth: 2
                        )
                case .capsule:
                    Capsule()
                        .stroke(
                            isFocused
                                ? DesignTokens.Color.brandPrimary
                                : Color.clear,
                            lineWidth: 2
                        )
                    }
            }
            .scaleEffect(isFocused ? 1.025 : (isPressed ? 0.985 : 1))
            .animation(.easeOut(duration: 0.14), value: isFocused)
    }
}

func tvFolderParentPath(_ path: String) -> String {
    path.split(separator: "/", omittingEmptySubsequences: true)
        .dropLast()
        .joined(separator: "/")
}

func tvFolderDisplayTitle(_ entry: FolderEntry) -> String {
    if let title = entry.title?.trimmingCharacters(in: .whitespacesAndNewlines),
       !title.isEmpty {
        return title
    }
    return entry.name
}

func tvFolderMetadata(_ entry: FolderEntry) -> String {
    guard entry.entryType == .media else { return "" }

    var identity = [String]()
    if let artist = entry.artist?.nilIfBlank {
        identity.append(artist)
    }
    if let album = entry.album?.nilIfBlank, album != identity.last {
        identity.append(album)
    }

    var technical = [String]()
    if let container = entry.container?.nilIfBlank {
        technical.append(container.uppercased())
    }
    if let width = entry.width, let height = entry.height {
        technical.append("\(width)×\(height)")
    }
    if let videoCodec = entry.videoCodec?.nilIfBlank {
        technical.append(videoCodec.uppercased())
    }
    if let audioCodec = entry.audioCodec?.nilIfBlank {
        technical.append(audioCodec.uppercased())
    }
    if let duration = tvFolderDuration(entry.durationMS) {
        technical.append(duration)
    }
    if let bitrate = tvFolderBitrate(entry.bitrateBPS) {
        technical.append(bitrate)
    }
    if let size = tvFolderSize(entry.sizeBytes) {
        technical.append(size)
    }
    if let modifiedAt = entry.modifiedAt {
        technical.append(tvFolderDay(modifiedAt))
    }
    technical = technical.reduce(into: []) { values, value in
        if !values.contains(value) {
            values.append(value)
        }
    }

    return [
        identity.joined(separator: " · "),
        technical.joined(separator: " · "),
    ]
    .filter { !$0.isEmpty }
    .joined(separator: "\n")
}

func tvFolderDuration(_ milliseconds: UInt64?) -> String? {
    guard let milliseconds else { return nil }
    let totalSeconds = milliseconds / 1_000
    let hours = totalSeconds / 3_600
    let minutes = (totalSeconds % 3_600) / 60
    let seconds = totalSeconds % 60
    if hours > 0 {
        return String(format: "%llu:%02llu:%02llu", hours, minutes, seconds)
    }
    return String(format: "%llu:%02llu", minutes, seconds)
}

func tvFolderBitrate(_ bitrateBPS: UInt64?) -> String? {
    guard let bitrateBPS else { return nil }
    if bitrateBPS >= 1_000_000 {
        return String(format: "%.1f Mbps", Double(bitrateBPS) / 1_000_000)
    }
    return String(format: "%.0f kbps", Double(bitrateBPS) / 1_000)
}

func tvFolderSize(_ bytes: UInt64?) -> String? {
    guard let bytes else { return nil }
    if bytes < 1_024 { return "\(bytes) B" }
    let units = ["KB", "MB", "GB", "TB"]
    var value = Double(bytes)
    var unit = -1
    while value >= 1_024, unit < units.count - 1 {
        value /= 1_024
        unit += 1
    }
    return value >= 10
        ? String(format: "%.0f %@", value, units[unit])
        : String(format: "%.1f %@", value, units[unit])
}

private func tvFolderDay(_ date: Date) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    return String(
        format: "%04d-%02d-%02d",
        components.year ?? 0,
        components.month ?? 0,
        components.day ?? 0
    )
}

private extension String {
    var nilIfBlank: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
