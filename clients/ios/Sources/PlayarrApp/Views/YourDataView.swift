import PlayarrKit
import SwiftUI
import UniformTypeIdentifiers

/// Settings, "Your data": portable export and import of this account's own data.
struct YourDataView: View {
    @State private var model: YourDataViewModel
    @State private var pickingFile = false

    init(transport: PlayarrRequestTransport) {
        _model = State(initialValue: YourDataViewModel(transport: transport))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            exportCard
            importCard
        }
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.zip]) { result in
            handlePicked(result)
        }
    }

    private var exportCard: some View {
        card(
            title: "Export your data",
            description: "Download your watch progress, playlists, watchlist and preferences as a portable package. Only your own account is included."
        ) {
            switch model.exportState {
            case .idle, .failed:
                if case .failed(let message) = model.exportState {
                    Text(message).font(.caption).foregroundStyle(.red)
                }
                Button("Create export") { Task { await model.startExport() } }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            case .working(let stage):
                HStack(spacing: 10) { ProgressView(); Text(stage).font(.subheadline) }
                    .foregroundStyle(PlayarrStyle.inkSoft)
            case .ready(let url, let counts):
                Text("Ready: \(counts.watchProgress) progress entries, \(counts.playlists) playlists.")
                    .font(.subheadline).foregroundStyle(PlayarrStyle.inkSoft)
                ShareLink(item: url) { Label("Save or share export", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            }
        }
    }

    private var importCard: some View {
        card(
            title: "Import your data",
            description: "Choose a Playarr export. You see a preview first and nothing changes until you confirm."
        ) {
            switch model.importState {
            case .idle:
                importOptions
                Button("Choose a package") { pickingFile = true }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            case .previewing:
                HStack(spacing: 10) { ProgressView(); Text("Checking the package").font(.subheadline) }
            case .preview(let preview):
                previewSummary(preview)
                HStack {
                    Button("Apply import") { Task { await model.applyImport() } }
                        .buttonStyle(PlayarrPrimaryButtonStyle())
                    Button("Cancel", role: .cancel) { model.resetImport() }
                }
            case .applying:
                HStack(spacing: 10) { ProgressView(); Text("Importing").font(.subheadline) }
            case .done(let result):
                resultSummary(result)
                Button("Done") { model.resetImport() }.buttonStyle(.bordered)
            case .failed(let message):
                Text(message).font(.caption).foregroundStyle(.red)
                Button("Try again") { model.resetImport() }.buttonStyle(.bordered)
            }
        }
    }

    private var importOptions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Include playback preferences", isOn: $model.includePreferences)
            Toggle("Keep my existing progress when it differs", isOn: $model.keepExistingProgress)
        }
        .font(.subheadline)
        .foregroundStyle(PlayarrStyle.ink)
    }

    private func previewSummary(_ preview: UserDataImportPreview) -> some View {
        let s = preview.summary
        return VStack(alignment: .leading, spacing: 6) {
            if !preview.sourceInstanceName.isEmpty {
                Text("From \(preview.sourceInstanceName)").font(.caption).foregroundStyle(PlayarrStyle.muted)
            }
            Text("Watch progress: \(s.watchProgress.willAdd) to add, \(s.watchProgress.willUpdate) to update, \(s.watchProgress.alreadyPresent) already present, \(s.watchProgress.unmatched) not found")
            Text("Playlists: \(s.playlists.new) new, \(s.playlists.existing) existing, \(s.playlists.itemsToAdd) items to add")
            if let watchlist = s.watchlist {
                Text("Watchlist: \(watchlist.willAdd) to add, \(watchlist.alreadyPresent) already present")
            }
            if s.playbackPreferencesNotApplied > 0 {
                Text("\(s.playbackPreferencesNotApplied) per-title playback preferences belong to another server and are not applied.")
                    .foregroundStyle(PlayarrStyle.muted)
            }
            ForEach(preview.warnings, id: \.self) { Text($0).foregroundStyle(PlayarrStyle.muted) }
        }
        .font(.subheadline)
        .foregroundStyle(PlayarrStyle.inkSoft)
    }

    private func resultSummary(_ result: UserDataImportResult) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if result.completed {
                Text("Import complete").font(.subheadline.weight(.semibold))
            } else {
                Text(result.failure ?? "The import stopped before it finished.").foregroundStyle(.red)
            }
            Text("Progress: \(result.progressAdded) added, \(result.progressUpdated) updated, \(result.progressConflictsKept) kept")
            Text("Playlists: \(result.playlistsCreated) created, \(result.playlistItemsAdded) items added")
            if result.unmatchedTotal > 0 { Text("\(result.unmatchedTotal) entries could not be matched in this library.") }
        }
        .font(.subheadline)
        .foregroundStyle(PlayarrStyle.inkSoft)
    }

    private func handlePicked(_ result: Result<URL, Error>) {
        switch result {
        case .failure(let error):
            model.reportImportFailure(error.localizedDescription)
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            let data = try? Data(contentsOf: url)
            if scoped { url.stopAccessingSecurityScopedResource() }
            guard let data else {
                model.reportImportFailure("That file could not be read.")
                return
            }
            Task { await model.previewImport(package: data) }
        }
    }

    private func card<Content: View>(title: String, description: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 17) {
            Text(title).font(.title2.weight(.semibold)).foregroundStyle(PlayarrStyle.ink)
            Text(description).font(.caption).foregroundStyle(PlayarrStyle.muted).lineSpacing(3)
            Divider().overlay(PlayarrStyle.line)
            content()
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.surfaceStrong.opacity(0.7))
        .overlay { Rectangle().stroke(PlayarrStyle.line, lineWidth: 1) }
    }
}
