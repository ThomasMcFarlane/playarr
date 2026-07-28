import Foundation

/// Background-capable `URLSession`-backed download engine — one
/// `URLSessionDownloadTask` per in-flight media file, tracked by
/// `URLSessionTask.taskDescription` (set to the media file id's UUID
/// string on `enqueue`/`resume`) rather than a separately-persisted task
/// identifier, so a relaunch that reconnects to the background session
/// (`AppDelegate.application(_:handleEventsForBackgroundURLSession:
/// completionHandler:)` in the `PlayarrApp` target, then
/// `reconnectExistingTasks()` here) can still match a completed/failed
/// task back to the `DownloadRecord` it belongs to without any extra
/// bookkeeping.
///
/// Callbacks are plain closures rather than a delegate protocol
/// deliberately: `URLSessionDownloadDelegate` methods below fire on the
/// session's own private delegate queue (not necessarily the main actor),
/// and a closure that itself hops with `Task { @MainActor in ... }` is
/// simpler to reason about here than a cross-actor protocol conformance
/// would be. `DownloadRepository` is the sole intended subscriber.
///
/// No UIKit import anywhere in this file (or this target) — see
/// `Package.swift`'s tvOS-reuse note; the one UIKit-touching piece of this
/// feature (`UIApplicationDelegate`) lives in `PlayarrApp/AppDelegate.swift`
/// instead and only reaches into this type via `backgroundCompletionHandler`.
public final class URLSessionDownloadEngine: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    /// Stable per-install background session identifier. Must stay the same
    /// across launches for the OS to reconnect a relaunch-after-termination
    /// to the same in-flight background tasks.
    public static let backgroundSessionIdentifier = "com.playarr.ios.downloads.background"

    // These are always invoked from within `Task { @MainActor in ... }`
    // below, never directly from a delegate callback's own (background)
    // thread — typing the closures themselves as `@MainActor` lets
    // `DownloadRepository` (a `@MainActor` type) assign its own
    // main-actor-isolated methods here directly, with no extra hop needed
    // at the call site.
    public var onProgress: (@MainActor @Sendable (_ mediaFileID: UUID, _ bytesWritten: Int64, _ totalBytes: Int64) -> Void)?
    public var onFinished: (@MainActor @Sendable (_ mediaFileID: UUID, _ finalFileURL: URL, _ totalBytes: Int64) -> Void)?
    public var onFailed: (@MainActor @Sendable (_ mediaFileID: UUID, _ error: Error, _ resumeData: Data?) -> Void)?
    public var onPaused: (@MainActor @Sendable (_ mediaFileID: UUID, _ resumeData: Data?) -> Void)?

    /// Set by `AppDelegate` (via `DownloadRepository`) when the OS relaunches
    /// this app to handle background `URLSession` events. Called from
    /// `urlSessionDidFinishEvents(forBackgroundURLSession:)` once every
    /// queued delegate callback for that background event has been
    /// delivered — signals the OS this app is done processing and can be
    /// suspended/snapshotted again.
    public var backgroundCompletionHandler: (() -> Void)?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.backgroundSessionIdentifier)
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private let taskLock = NSLock()
    private var tasksByMediaFileID: [UUID: URLSessionDownloadTask] = [:]

    override public init() {
        super.init()
    }

    /// Reconnects to any tasks the background session already has in
    /// flight — needed because this object (and the `DownloadRepository`
    /// that owns it) is recreated fresh every launch, while the OS's
    /// background session and its tasks persist independently of that.
    /// Call once, shortly after construction.
    public func reconnectExistingTasks() async {
        let tasks = await session.allTasks
        register(tasks: tasks)
    }

    /// Synchronous on purpose (see call site above) — taking the lock from
    /// inside an `async` function body directly triggers a "use async-safe
    /// scoped locking instead" warning even when, as here, no suspension
    /// actually occurs while it's held.
    private func register(tasks: [URLSessionTask]) {
        taskLock.lock()
        defer { taskLock.unlock() }
        for task in tasks {
            guard let downloadTask = task as? URLSessionDownloadTask,
                  let description = task.taskDescription,
                  let mediaFileID = UUID(uuidString: description) else { continue }
            tasksByMediaFileID[mediaFileID] = downloadTask
        }
    }

    @discardableResult
    public func enqueue(mediaFileID: UUID, request: URLRequest) -> URLSessionDownloadTask {
        let task = session.downloadTask(with: request)
        task.taskDescription = mediaFileID.uuidString
        register(task, for: mediaFileID)
        task.resume()
        return task
    }

    @discardableResult
    public func resume(mediaFileID: UUID, resumeData: Data) -> URLSessionDownloadTask {
        let task = session.downloadTask(withResumeData: resumeData)
        task.taskDescription = mediaFileID.uuidString
        register(task, for: mediaFileID)
        task.resume()
        return task
    }

    /// Cancels the in-flight task but preserves resume data via `onPaused`
    /// so a later `resume(mediaFileID:resumeData:)` can pick up roughly
    /// where it left off.
    public func pause(mediaFileID: UUID) {
        guard let task = existingTask(for: mediaFileID) else { return }
        unregister(mediaFileID)
        task.cancel { [weak self] resumeData in
            guard let self else { return }
            let onPaused = self.onPaused
            Task { @MainActor in
                onPaused?(mediaFileID, resumeData)
            }
        }
    }

    /// Cancels the in-flight task with no intent to resume — the caller is
    /// expected to delete the associated `DownloadRecord`/remote ticket.
    public func cancel(mediaFileID: UUID) {
        guard let task = existingTask(for: mediaFileID) else { return }
        unregister(mediaFileID)
        task.cancel()
    }

    // MARK: - URLSessionDownloadDelegate

    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        // The OS deletes `location` the instant this method returns, so the
        // move into this app's own storage must happen synchronously, on
        // this callback's own thread — not deferred onto a `Task`.
        guard let description = downloadTask.taskDescription, let mediaFileID = UUID(uuidString: description) else { return }
        let totalBytes = downloadTask.countOfBytesExpectedToReceive
        unregister(mediaFileID)

        do {
            let destination = try Self.moveDownloadedFile(from: location, mediaFileID: mediaFileID)
            let onFinished = onFinished
            Task { @MainActor in
                onFinished?(mediaFileID, destination, totalBytes)
            }
        } catch {
            let onFailed = onFailed
            Task { @MainActor in
                onFailed?(mediaFileID, error, nil)
            }
        }
    }

    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard let description = downloadTask.taskDescription, let mediaFileID = UUID(uuidString: description) else { return }
        let onProgress = onProgress
        Task { @MainActor in
            onProgress?(mediaFileID, totalBytesWritten, totalBytesExpectedToWrite)
        }
    }

    // MARK: - URLSessionTaskDelegate

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        guard let description = task.taskDescription, let mediaFileID = UUID(uuidString: description) else { return }
        unregister(mediaFileID)
        // `NSURLSessionDownloadTaskResumeData` on a cancelled/failed
        // download task's error carries resume data the same way an
        // explicit `pause(mediaFileID:)` does — surface it the same way so
        // a transient network failure is resumable, not just an explicit
        // pause.
        let resumeData = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        let onFailed = onFailed
        Task { @MainActor in
            onFailed?(mediaFileID, error, resumeData)
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let handler = backgroundCompletionHandler
        backgroundCompletionHandler = nil
        Task { @MainActor in
            handler?()
        }
    }

    // MARK: - Private

    private func register(_ task: URLSessionDownloadTask, for mediaFileID: UUID) {
        taskLock.lock()
        tasksByMediaFileID[mediaFileID] = task
        taskLock.unlock()
    }

    private func unregister(_ mediaFileID: UUID) {
        taskLock.lock()
        tasksByMediaFileID.removeValue(forKey: mediaFileID)
        taskLock.unlock()
    }

    private func existingTask(for mediaFileID: UUID) -> URLSessionDownloadTask? {
        taskLock.lock()
        defer { taskLock.unlock() }
        return tasksByMediaFileID[mediaFileID]
    }

    /// Moves the OS-owned temporary download file into this app's
    /// `Application Support/Downloads/<mediaFileID>` — see
    /// `DownloadRecord.localFileRelativePath`'s doc comment for why that's
    /// stored as a path relative to `.applicationSupportDirectory`, not
    /// this method's absolute result.
    private static func moveDownloadedFile(from location: URL, mediaFileID: UUID) throws -> URL {
        let fileManager = FileManager.default
        let supportDirectory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let downloadsDirectory = supportDirectory.appendingPathComponent("Downloads", isDirectory: true)
        try fileManager.createDirectory(at: downloadsDirectory, withIntermediateDirectories: true)
        let destination = downloadsDirectory.appendingPathComponent(mediaFileID.uuidString)
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: location, to: destination)
        return destination
    }
}
