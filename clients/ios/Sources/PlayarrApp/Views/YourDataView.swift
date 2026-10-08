import PlayarrKit
import SwiftUI
import UniformTypeIdentifiers

/// Settings, "Your data": portable export and import of this account's own data.
struct YourDataView: View {
    @State private var model: YourDataViewModel
    @State private var pickingFile = false
    /// Web mobile settings panel layout while nothing is being previewed or imported.
    var webStyle = false

    init(transport: PlayarrRequestTransport, webStyle: Bool = false) {
        self.webStyle = webStyle
        _model = State(initialValue: YourDataViewModel(transport: transport))
    }

    var body: some View {
        if webStyle, case .idle = model.importState {
            webBody
        } else {
            cardBody
        }
    }

    private var webBody: some View {
        ZStack(alignment: .topLeading) {
            WMText("Export my data", 18.72, 700, lh: 28)
            WMPara(
                text: "Creates one ZIP with your watch progress, personal playlists (in order) and audio-language preference. Open the CSV files in a spreadsheet, or keep the file to import elsewhere.",
                size: 16, weight: 400, lh: 24, width: 318, height: 120
            )
            .offset(y: 48)
            WMPara(
                text: "The file contains only this profile's data. It never contains passwords, tokens, file paths, other people's activity or the media itself.",
                size: 12.48, weight: 400, lh: 18.5, width: 318, height: 56
            )
            .offset(y: 188)
            exportAction.offset(y: 264)
            WMText("Import data", 18.72, 700, lh: 28).offset(y: 356)
            WMPara(
                text: "Choose a Playarr export. You will see what it would change before anything is saved. Nothing is deleted, and your account, permissions and other profiles are never touched.",
                size: 16, weight: 400, lh: 24, width: 318, height: 120
            )
            .offset(y: 404)
            fieldLabel("Playarr data file (.zip)").offset(y: 544)
            Button { pickingFile = true } label: {
                HStack(spacing: 4) {
                    Text("Choose File")
                        .font(WM.font(11, 400)).foregroundStyle(WM.ink)
                        .padding(.horizontal, 6).frame(height: 16)
                        .background(WM.artFill)
                        .overlay(RoundedRectangle(cornerRadius: 2).stroke(WM.muted, lineWidth: 1))
                    Text("No file chosen").font(WM.font(11, 400)).foregroundStyle(WM.ink)
                    Spacer()
                }
                .padding(.horizontal, 8).padding(.top, 4)
                .frame(width: 318, height: 48, alignment: .topLeading)
                .overlay(Rectangle().stroke(WM.line.opacity(0.28), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .offset(y: 561)
            fieldLabel("If progress already exists").offset(y: 636)
            Menu {
                Button("Keep whichever is newer") { model.keepExistingProgress = false }
                Button("Always keep what is here") { model.keepExistingProgress = true }
            } label: {
                HStack {
                    Text(model.keepExistingProgress ? "Always keep what is here" : "Keep whichever is newer")
                        .font(WM.font(11, 400)).foregroundStyle(WM.muted)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(WM.muted)
                }
                .padding(.horizontal, 12)
                .frame(width: 318, height: 48)
                .overlay(Rectangle().stroke(WM.line.opacity(0.28), lineWidth: 1))
            }
            .offset(y: 653)
            Toggle(isOn: $model.includePreferences) {
                Text("Also apply my audio-language preference")
                    .font(WM.font(11.2, 720)).tracking(0.896).foregroundStyle(WM.muted)
            }
            .toggleStyle(.switch)
            .frame(width: 318)
            .offset(y: 728)
        }
        .frame(width: 318, height: 800, alignment: .topLeading)
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.zip]) { result in
            handlePicked(result)
        }
    }

    @ViewBuilder
    private var exportAction: some View {
        switch model.exportState {
        case .idle, .failed:
            WMPanelButton(label: "Prepare my data", width: 131, height: 44) { Task { await model.startExport() } }
        case .working(let stage):
            HStack(spacing: 10) { ProgressView(); Text(stage).font(.subheadline) }
                .foregroundStyle(PlayarrStyle.inkSoft)
        case .ready(let url, let counts):
            VStack(alignment: .leading, spacing: 8) {
                Text("Ready: \(counts.watchProgress) watch records and \(counts.playlists) playlists.")
                    .font(.subheadline).foregroundStyle(PlayarrStyle.inkSoft)
                ShareLink(item: url) { Label("Download", systemImage: "square.and.arrow.up") }
            }
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(WM.font(11.2, 720)).tracking(0.896).foregroundStyle(WM.muted)
            .frame(width: 318, height: 17, alignment: .leading)
    }

    private var cardBody: some View {
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
            title: "Export my data",
            description: "Creates one ZIP with your watch progress, personal playlists (in order) and audio-language preference. Open the CSV files in a spreadsheet, or keep the file to import elsewhere. The file contains only this profile's data. It never contains passwords, tokens, file paths, other people's activity or the media itself."
        ) {
            switch model.exportState {
            case .idle, .failed:
                if case .failed(let message) = model.exportState {
                    Text(message).font(.caption).foregroundStyle(PlayarrStyle.danger)
                }
                Button("Prepare my data") { Task { await model.startExport() } }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            case .working(let stage):
                HStack(spacing: 10) { ProgressView(); Text(stage).font(.subheadline) }
                    .foregroundStyle(PlayarrStyle.inkSoft)
            case .ready(let url, let counts):
                Text("Ready: \(counts.watchProgress) watch records and \(counts.playlists) playlists.")
                    .font(.subheadline).foregroundStyle(PlayarrStyle.inkSoft)
                ShareLink(item: url) { Label("Download", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            }
        }
    }

    private var importCard: some View {
        card(
            title: "Import data",
            description: "Choose a Playarr export. You will see what it would change before anything is saved. Nothing is deleted, and your account, permissions and other profiles are never touched."
        ) {
            switch model.importState {
            case .idle:
                importOptions
                Button("Playarr data file (.zip)") { pickingFile = true }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            case .previewing:
                HStack(spacing: 10) { ProgressView(); Text("Previewing...").font(.subheadline) }
            case .preview(let preview):
                previewSummary(preview)
                HStack {
                    Button("Apply import") { Task { await model.applyImport() } }
                        .buttonStyle(PlayarrPrimaryButtonStyle())
                    Button("Cancel", role: .cancel) { model.resetImport() }
                }
            case .applying:
                HStack(spacing: 10) { ProgressView(); Text("Importing").font(.subheadline) }
            case .done(let result, let unmatched):
                resultSummary(result)
                if let unmatched {
                    ShareLink(item: unmatched) { Label("Download \(result.unmatchedTotal) unmatched records", systemImage: "square.and.arrow.down") }
                }
                Button("Done") { model.resetImport() }.buttonStyle(.bordered)
            case .failed(let message):
                Text(message).font(.caption).foregroundStyle(PlayarrStyle.danger)
                Button("Try again") { model.resetImport() }.buttonStyle(.bordered)
            }
        }
    }

    private var importOptions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Also apply my audio-language preference", isOn: $model.includePreferences)
            Toggle("Always keep what is here when progress already exists", isOn: $model.keepExistingProgress)
        }
        .font(.subheadline)
        .foregroundStyle(PlayarrStyle.ink)
    }

    private func previewSummary(_ preview: UserDataImportPreview) -> some View {
        let s = preview.summary
        return VStack(alignment: .leading, spacing: 6) {
            Text("What this import would do").font(.headline).foregroundStyle(PlayarrStyle.ink)
            ForEach(preview.warnings, id: \.self) { Text($0).font(.caption).foregroundStyle(PlayarrStyle.muted) }
            Text("Progress: \(s.watchProgress.willAdd) new, \(s.watchProgress.willUpdate) updated, \(s.watchProgress.alreadyPresent) already here, \(s.watchProgress.conflictsKept) conflicts kept as they are.")
            Text("Playlists: \(s.playlists.new) new, \(s.playlists.itemsToAdd) items added, \(s.playlists.itemsAlreadyPresent) items already present.")
            if let w = s.watchlist {
                Text("Watchlist: \(w.willAdd) new, \(w.alreadyPresent) already here, \(w.unmatched) could not be placed.")
            }
            Text("\(s.unmatchedTotal) records could not be placed in this library (\(s.watchProgress.ambiguous) were ambiguous). You can download them afterwards.")
            if let language = s.preferredAudioLanguageChange {
                Text("Audio language would change to \(language).")
            }
            if s.playbackPreferencesNotApplied > 0 {
                Text("\(s.playbackPreferencesNotApplied) per-title playback choices are server specific and will not be applied.")
            }
            if !preview.samples.isEmpty {
                DisclosureGroup("Show examples") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(preview.samples.enumerated()), id: \.offset) { _, sample in
                            let playlist = sample.playlist.map { " (\($0))" } ?? ""
                            let candidates = sample.candidates.isEmpty ? "" : ": " + sample.candidates.joined(separator: "; ")
                            Text("\(sample.title) - \(sample.outcome)\(playlist)\(candidates)").font(.caption)
                        }
                    }
                }
            }
            Text("Applying writes these changes to your profile only. Running the same import again changes nothing.")
                .font(.caption).foregroundStyle(PlayarrStyle.muted)
        }
        .font(.subheadline)
        .foregroundStyle(PlayarrStyle.inkSoft)
    }

    private func resultSummary(_ result: UserDataImportResult) -> some View {
        Group {
            if result.completed {
                Text("Import finished: \(result.progressAdded + result.progressUpdated) progress records and \(result.playlistItemsAdded) playlist items saved.")
            } else {
                Text("The import stopped part way: \(result.failure ?? "") Running it again is safe.").foregroundStyle(PlayarrStyle.danger)
            }
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
