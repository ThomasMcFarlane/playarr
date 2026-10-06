import CoreGraphics
import Observation
import PlayarrKit
import SwiftUI

/// Apple TV has no file picker, so the package moves through a phone or
/// computer: a one-time link shown as a QR code (see
/// `docs/architecture/user-portability.md`, "Ten-foot transfer").
@MainActor
@Observable
final class TVYourDataModel {
    enum ExportState {
        case idle
        case working(String)
        case link(UserDataTransferLink)
        case failed(String)
    }

    enum ImportState {
        case idle
        case waiting(UserDataImportSession)
        case previewing
        case preview(UserDataImportPreview, sessionID: String)
        case applying
        case done(UserDataImportResult)
        case failed(String)
    }

    private(set) var exportState: ExportState = .idle
    private(set) var importState: ImportState = .idle

    private let client: UserDataClient
    private var task: Task<Void, Never>?

    init(transport: PlayarrRequestTransport) {
        client = UserDataClient(transport: transport)
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    func startExport() {
        cancel()
        exportState = .working("Preparing your data")
        task = Task { [client] in
            do {
                var job = try await client.startExport()
                var polls = 0
                while job.status == .queued || job.status == .running {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    polls += 1
                    if polls > 300 { throw APIError.serviceUnavailable(nil) }
                    job = try await client.exportJob(id: job.id)
                }
                guard job.status == .ready else {
                    exportState = .failed(job.error ?? "The export did not finish. Try again.")
                    return
                }
                exportState = .link(try await client.createExportTransferLink(id: job.id))
            } catch is CancellationError {
                exportState = .idle
            } catch {
                exportState = .failed(Self.message(error))
            }
        }
    }

    func startImport() {
        cancel()
        task = Task { [client] in
            do {
                var session = try await client.createImportSession()
                importState = .waiting(session)
                var polls = 0
                while !session.isUploaded {
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    polls += 1
                    if polls > 450 { throw APIError.serviceUnavailable(nil) }
                    session = try await client.importSession(id: session.id)
                    importState = .waiting(session)
                }
                importState = .previewing
                let preview = try await client.previewSession(id: session.id, options: UserDataImportOptions())
                importState = .preview(preview, sessionID: session.id)
            } catch is CancellationError {
                importState = .idle
            } catch {
                importState = .failed(Self.message(error))
            }
        }
    }

    func applyImport() {
        guard case .preview(let preview, let sessionID) = importState else { return }
        importState = .applying
        task = Task { [client] in
            do {
                let result = try await client.applySession(
                    id: sessionID, packageSHA256: preview.packageSHA256, options: UserDataImportOptions()
                )
                importState = .done(result)
            } catch {
                importState = .failed(Self.message(error))
            }
        }
    }

    func resetImport() {
        cancel()
        importState = .idle
    }

    private static func message(_ error: Error) -> String {
        (error as? APIError)?.displayMessage ?? error.localizedDescription
    }
}

struct TVYourDataView: View {
    @State private var model: TVYourDataModel

    init(transport: PlayarrRequestTransport) {
        _model = State(initialValue: TVYourDataModel(transport: transport))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            exportSection
            Divider().background(DesignTokens.Color.borderDefault.opacity(0.35))
            importSection
        }
        .onDisappear { model.cancel() }
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(DesignTokens.Color.textPrimary)
    }

    private func copy(_ text: String) -> some View {
        Text(text)
            .font(TVTheme.captionFont())
            .foregroundStyle(DesignTokens.Color.textSecondary)
            .frame(maxWidth: 560, alignment: .leading)
    }

    private func qr(_ text: String) -> some View {
        Group {
            if let image = QRCodeImage.make(from: text) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 220, height: 220)
                    .padding(12)
                    .background(Color.white)
            } else {
                Text(text).font(TVTheme.captionFont()).foregroundStyle(DesignTokens.Color.textPrimary)
            }
        }
    }

    @ViewBuilder
    private var exportSection: some View {
        heading("Export your data")
        copy("Scan the code with a phone or computer to download a package with your watch progress, playlists and preferences. The link works once and expires in 15 minutes.")
        switch model.exportState {
        case .idle:
            TVPrimaryButton(label: "Create export link") { model.startExport() }
        case .working(let stage):
            ProgressView(stage).tint(DesignTokens.Color.brandPrimary)
        case .link(let link):
            qr(link.url)
            copy("Open the link on the other device to download the package.")
        case .failed(let message):
            Text(message).font(TVTheme.captionFont()).foregroundStyle(DesignTokens.Color.stateError)
            TVPrimaryButton(label: "Try again") { model.startExport() }
        }
    }

    @ViewBuilder
    private var importSection: some View {
        heading("Import your data")
        copy("Scan the code on a phone or computer and upload a Playarr export. You review a preview here before anything changes.")
        switch model.importState {
        case .idle:
            TVPrimaryButton(label: "Create upload link") { model.startImport() }
        case .waiting(let session):
            if let url = session.uploadURL {
                qr(url)
            }
            ProgressView("Waiting for the upload").tint(DesignTokens.Color.brandPrimary)
            Button("Cancel", role: .cancel) { model.resetImport() }
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .previewing:
            ProgressView("Checking the package").tint(DesignTokens.Color.brandPrimary)
        case .preview(let preview, _):
            let s = preview.summary
            copy("Watch progress: \(s.watchProgress.willAdd) to add, \(s.watchProgress.willUpdate) to update, \(s.watchProgress.unmatched) not found.")
            copy("Playlists: \(s.playlists.new) new, \(s.playlists.itemsToAdd) items to add.")
            HStack(spacing: 24) {
                TVPrimaryButton(label: "Apply import") { model.applyImport() }
                Button("Cancel", role: .cancel) { model.resetImport() }
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        case .applying:
            ProgressView("Importing").tint(DesignTokens.Color.brandPrimary)
        case .done(let result):
            if result.completed {
                copy("Import complete: \(result.progressAdded) added, \(result.progressUpdated) updated, \(result.playlistsCreated) playlists created.")
            } else {
                Text(result.failure ?? "The import stopped before it finished.")
                    .font(TVTheme.captionFont()).foregroundStyle(DesignTokens.Color.stateError)
            }
            Button("Done") { model.resetImport() }.foregroundStyle(DesignTokens.Color.textSecondary)
        case .failed(let message):
            Text(message).font(TVTheme.captionFont()).foregroundStyle(DesignTokens.Color.stateError)
            TVPrimaryButton(label: "Try again") { model.resetImport() }
        }
    }
}
