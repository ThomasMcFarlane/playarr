import StreamarrKit
import SwiftUI

/// Quality + keep-until picker presented before actually starting a
/// download, for either a single leaf (movie/episode/track/book) or a
/// whole container (season/album/series/artist — `candidates.count > 1`).
///
/// For a container target, this only fetches
/// `GET /api/v1/media/{id}/download-options` once, for one representative
/// leaf (`candidates.first`), and shows an aggregate "~X GB for N items"
/// estimate scaled from that single call — not once per leaf. Each leaf's
/// own concrete download-options/create-ticket round trip only happens
/// lazily, inside `DownloadRepository.enqueue`, once the user actually
/// confirms.
struct DownloadOptionsSheet: View {
    private enum LoadState {
        case loading
        case loaded
        case failed(String)
    }

    private enum KeepUntilKind: String, CaseIterable, Identifiable {
        case forever = "Forever"
        case specificDate = "Until a date"
        case afterWatched = "After watched"
        var id: String { rawValue }
    }

    let candidates: [DownloadCandidate]
    let apiClient: StreamarrAPIClient
    let downloadRepository: DownloadRepository

    @Environment(\.dismiss) private var dismiss

    @State private var loadState: LoadState = .loading
    @State private var options: [MediaFileDownloadOption] = []
    @State private var selectedOptionID: String?

    @State private var keepUntilKind: KeepUntilKind = .forever
    @State private var specificDate = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var afterWatchedAmount = 30
    @State private var afterWatchedUnit: KeepUntilPolicy.TimeUnit = .days

    var body: some View {
        NavigationStack {
            Group {
                switch loadState {
                case .loading:
                    PlayarrLoadingView(title: "Checking download sizes…")
                case .failed(let message):
                    PlayarrFailureView(title: "Couldn’t load download options", message: message) {
                        Task { await load() }
                    }
                case .loaded:
                    form
                }
            }
            .navigationTitle(candidates.count > 1 ? "Download \(candidates.count) items" : "Download")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Download") { startDownload() }
                        .disabled(selectedOptionID == nil || candidates.isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
        .task { await load() }
    }

    private var form: some View {
        Form {
            Section("Quality") {
                ForEach(options) { option in
                    Button {
                        selectedOptionID = option.id
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.label).foregroundStyle(PlayarrStyle.ink)
                                Text(sizeLabel(for: option))
                                    .font(.caption)
                                    .foregroundStyle(PlayarrStyle.muted)
                            }
                            Spacer()
                            if option.id == selectedOptionID {
                                Image(systemName: "checkmark").foregroundStyle(PlayarrStyle.pink)
                            }
                        }
                    }
                }
            }

            Section("Keep until") {
                Picker("Keep until", selection: $keepUntilKind) {
                    ForEach(KeepUntilKind.allCases) { kind in
                        Text(kind.rawValue).tag(kind)
                    }
                }
                .pickerStyle(.segmented)

                switch keepUntilKind {
                case .forever:
                    EmptyView()
                case .specificDate:
                    DatePicker("Date", selection: $specificDate, in: Date()..., displayedComponents: .date)
                case .afterWatched:
                    Stepper("After \(afterWatchedAmount) \(afterWatchedUnit.rawValue)", value: $afterWatchedAmount, in: 1...365)
                    Picker("Unit", selection: $afterWatchedUnit) {
                        Text("Days").tag(KeepUntilPolicy.TimeUnit.days)
                        Text("Weeks").tag(KeepUntilPolicy.TimeUnit.weeks)
                    }
                    .pickerStyle(.segmented)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(PlayarrStyle.background)
    }

    private func sizeLabel(for option: MediaFileDownloadOption) -> String {
        let multiplier = max(1, candidates.count)
        let scaledEstimate = option.estimatedSizeBytes.map { $0 * Int64(multiplier) }
        let sizeString = PlayarrByteFormat.string(scaledEstimate) ?? "Unknown size"
        let prefix = option.sizeIsEstimate ? "~" : ""
        if multiplier > 1 {
            return "\(prefix)\(sizeString) for \(multiplier) items"
        }
        return "\(prefix)\(sizeString)"
    }

    private func load() async {
        guard let representative = candidates.first else {
            loadState = .failed("Nothing to download.")
            return
        }
        loadState = .loading
        do {
            let response = try await apiClient.mediaDownloadOptions(mediaFileID: representative.mediaFileID)
            options = response.options
            selectedOptionID = response.options.first(where: { $0.id == "original" })?.id ?? response.options.first?.id
            loadState = .loaded
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    private var resolvedKeepUntil: KeepUntilPolicy {
        switch keepUntilKind {
        case .forever: .forever
        case .specificDate: .specificDate(specificDate)
        case .afterWatched: .afterWatched(amount: afterWatchedAmount, unit: afterWatchedUnit)
        }
    }

    private func startDownload() {
        guard let selectedOptionID, let selectedOption = options.first(where: { $0.id == selectedOptionID }) else { return }
        downloadRepository.enqueue(
            candidates: candidates,
            profile: selectedOption.profile,
            keepUntil: resolvedKeepUntil
        )
        dismiss()
    }
}

/// The small icon button every download call site (`WorkDetailView` row
/// builders/section headers, `HomeView`/`LibraryView` context menus) uses
/// to present `DownloadOptionsSheet` — a single reusable affordance rather
/// than each call site owning its own `@State` sheet flag.
struct DownloadTriggerButton: View {
    let candidates: [DownloadCandidate]
    let apiClient: StreamarrAPIClient
    let downloadRepository: DownloadRepository
    var systemImage = "arrow.down.circle"

    @State private var showingSheet = false

    var body: some View {
        Button {
            showingSheet = true
        } label: {
            Image(systemName: iconName)
        }
        .disabled(candidates.isEmpty)
        .sheet(isPresented: $showingSheet) {
            DownloadOptionsSheet(candidates: candidates, apiClient: apiClient, downloadRepository: downloadRepository)
        }
    }

    private var iconName: String {
        guard candidates.count == 1, let first = candidates.first else { return systemImage }
        return downloadRepository.hasActiveOrCompletedDownload(mediaFileID: first.mediaFileID)
            ? "checkmark.circle.fill"
            : systemImage
    }
}

/// The catalog-card `.contextMenu { Button("Download") { ... } }` at
/// `HomeView`/`LibraryView` call sites only has a summary `Work`, not the
/// full `WorkDetail` tree `DownloadCandidate`s need — this resolves that
/// tree (`GET /api/v1/catalog/{id}`) first, deriving every playable leaf's
/// candidate from it (a movie's own leaf; every episode/track/book for a
/// series/artist/author), then hands off to `DownloadOptionsSheet`. Present
/// via `.sheet(item:)` bound to an `@State private var downloadTarget:
/// Work?` at the call site.
struct WorkDownloadSheet: View {
    let work: Work
    let apiClient: StreamarrAPIClient
    let downloadRepository: DownloadRepository

    @State private var candidates: [DownloadCandidate]?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let candidates {
                DownloadOptionsSheet(candidates: candidates, apiClient: apiClient, downloadRepository: downloadRepository)
            } else if let errorMessage {
                NavigationStack {
                    PlayarrFailureView(title: "Couldn’t prepare download", message: errorMessage) {
                        Task { await resolve() }
                    }
                }
                .preferredColorScheme(.dark)
            } else {
                PlayarrLoadingView(title: "Preparing download…")
            }
        }
        .task { await resolve() }
    }

    private func resolve() async {
        errorMessage = nil
        do {
            let detail = try await apiClient.fetchWork(id: work.id)
            let resolved = Self.candidates(from: detail)
            guard !resolved.isEmpty else {
                errorMessage = "Nothing in this title can be downloaded yet."
                return
            }
            candidates = resolved
        } catch let error as APIError {
            errorMessage = error.displayMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func candidates(from detail: WorkDetail) -> [DownloadCandidate] {
        let posterURLString = detail.work.images.first(where: { $0.kind == .poster })?.url
        switch detail.children {
        case .movie:
            guard let mediaFileID = detail.mediaFileID else { return [] }
            return [
                DownloadCandidate(
                    mediaFileID: mediaFileID,
                    workID: detail.work.id,
                    title: detail.work.title,
                    posterURLString: posterURLString
                ),
            ]
        case .series(let seasons):
            return seasons.flatMap { season in
                season.episodes.compactMap { episode -> DownloadCandidate? in
                    guard let mediaFileID = episode.mediaFileID else { return nil }
                    return DownloadCandidate(
                        mediaFileID: mediaFileID,
                        workID: detail.work.id,
                        title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                        subtitle: detail.work.title,
                        posterURLString: posterURLString
                    )
                }
            }
        case .artist(let albums):
            return albums.flatMap { album in
                album.tracks.compactMap { track -> DownloadCandidate? in
                    guard let mediaFileID = track.mediaFileID else { return nil }
                    return DownloadCandidate(
                        mediaFileID: mediaFileID,
                        workID: detail.work.id,
                        title: track.track.title,
                        subtitle: album.album.title,
                        posterURLString: posterURLString
                    )
                }
            }
        case .author(let books):
            return books.compactMap { book -> DownloadCandidate? in
                guard let mediaFileID = book.mediaFileID else { return nil }
                return DownloadCandidate(
                    mediaFileID: mediaFileID,
                    workID: detail.work.id,
                    title: book.book.title,
                    posterURLString: posterURLString
                )
            }
        }
    }
}
