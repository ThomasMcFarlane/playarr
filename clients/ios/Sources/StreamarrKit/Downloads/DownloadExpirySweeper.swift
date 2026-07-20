import Foundation
import SwiftData

/// Foreground-only cleanup for `KeepUntilPolicy`-expired downloads.
///
/// This package is a pure SwiftPM package with no Info.plist/Xcode-project
/// layer, so `BGTaskScheduler` — which needs
/// `BGTaskSchedulerPermittedIdentifiers` declared in an Info.plist — is not
/// available here. Call `sweep(modelContext:)` instead whenever the app
/// returns to the foreground; see `RootView`'s `scenePhase == .active`
/// hook, which drives this the same way it already drives
/// `UpdateViewModel.checkForUpdate()`.
public enum DownloadExpirySweeper {
    @MainActor
    public static func sweep(modelContext: ModelContext, now: Date = Date()) {
        let descriptor = FetchDescriptor<DownloadRecord>()
        guard let records = try? modelContext.fetch(descriptor) else { return }

        let supportDirectory = try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        )

        var didDelete = false
        for record in records {
            guard record.state == .completed,
                  record.keepUntil.isExpired(now: now, watchedAt: record.watchedAt) else { continue }
            if let relativePath = record.localFileRelativePath, let supportDirectory {
                try? FileManager.default.removeItem(at: supportDirectory.appendingPathComponent(relativePath))
            }
            modelContext.delete(record)
            didDelete = true
        }
        if didDelete {
            try? modelContext.save()
        }
    }
}
