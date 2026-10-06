import PlayarrKit
import SwiftUI

/// Shared layout for the web "list" pages (Watchlist and Requests): the page
/// header (back button and title) over a column of `tv-download-row` rows.
/// Numbers come from the web CSS at the 390 CSS px mobile viewport
/// (`.tv-download-row`, `.tv-watchlist-primary`, `.tv-discovery-note`).
private struct WMListPage<Content: View>: View {
    let title: String
    let onBack: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack(alignment: .topLeading) {
                WM.page.ignoresSafeArea()
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 9.6) { content() }
                        .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                        .padding(.trailing, phone ? 16 : max(22, proxy.size.width * 0.024))
                        .padding(.top, phone ? 84 : max(110, proxy.size.height * 0.13))
                        .padding(.bottom, 130)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollIndicators(.hidden)

                let top = WM.topInset + 2
                WMHeaderCircleButton(width: 42, height: 38, glyph: "←", action: onBack)
                    .offset(x: phone ? 16 : max(102, proxy.size.width * 0.08) - 52, y: top)
                WMText(title, 17.6, 580, lh: 26.4, ls: -0.792)
                    .frame(height: 38)
                    .offset(x: phone ? 68 : max(102, proxy.size.width * 0.08), y: top)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .background(WM.page)
        .ignoresSafeArea()
        .navigationBarHidden(true)
    }
}

/// `.tv-download-row`: rounded translucent card with copy on the left and actions on the right.
private struct WMListRow<Copy: View, Actions: View>: View {
    @ViewBuilder let copy: () -> Copy
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4.8) { copy() }
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) { actions() }
                .fixedSize()
        }
        .padding(14)
        .background(WM.artFill.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct WMListMeta: View {
    let parts: [String]

    var body: some View {
        Text(parts.joined(separator: "   "))
            .font(WM.font(12.3, 400))
            .foregroundStyle(WM.muted)
            .lineLimit(1)
    }
}

private struct WMListNote: View {
    let text: String
    var tone: Color = WM.muted

    var body: some View {
        Text(text)
            .font(WM.font(8.8, 400))
            .foregroundStyle(tone)
    }
}

private struct WMListEmpty: View {
    let title: String
    let description: String
    var isError = false

    var body: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(WM.font(17.6, 650))
                .foregroundStyle(isError ? WM.pink : WM.ink)
            Text(description)
                .font(WM.font(12.3, 400))
                .foregroundStyle(WM.muted)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }
}

private enum WMListState<Item> {
    case loading
    case ready([Item])
    case failed(String)
}

/// The primary pill (`.tv-watchlist-primary`).
private struct WMPrimaryPill: View {
    let label: String

    var body: some View {
        Text(label)
            .font(WM.font(15, 400))
            .foregroundStyle(WM.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(WM.chip.opacity(0.88), in: Capsule())
            .overlay(Capsule().stroke(WM.line.opacity(0.3), lineWidth: 1))
    }
}

/// The small action button (`.tv-download-row-actions button`).
private struct WMSmallPill: View {
    let label: String

    var body: some View {
        Text(label)
            .font(WM.font(7.68, 400))
            .foregroundStyle(WM.ink)
            .padding(.horizontal, 14.4)
            .frame(height: 34)
            .background(WM.artFill, in: Capsule())
    }
}

// MARK: - Watchlist

@MainActor
@Observable
final class WatchlistModel {
    fileprivate var state: WMListState<WatchlistEntry> = .loading
    var removeError: String?
    /// Titles whose Request button has been pressed (web's "Requested" state).
    var requested: Set<String> = []
    var requestErrors: [String: String] = [:]
    private let client: WatchlistClient
    private let requests: RequestsClient

    init(apiClient: PlayarrAPIClient) {
        client = WatchlistClient(transport: apiClient)
        requests = RequestsClient(transport: apiClient)
    }

    func load() async {
        do {
            state = .ready(try await client.list())
        } catch {
            if case .ready = state { return }
            state = .failed(Self.message(error))
        }
    }

    func remove(_ entry: WatchlistEntry) async {
        removeError = nil
        do {
            try await client.remove(titleKey: entry.title.titleKey)
            if case .ready(let items) = state {
                state = .ready(items.filter { $0.title.titleKey != entry.title.titleKey })
            }
        } catch {
            removeError = Self.message(error)
        }
    }

    func request(_ entry: WatchlistEntry) async {
        let key = entry.title.titleKey
        guard !requested.contains(key) else { return }
        requestErrors[key] = nil
        do {
            _ = try await requests.request(WatchlistPresentation.requestSnapshot(for: entry.title))
            requested.insert(key)
        } catch {
            requestErrors[key] = Self.message(error)
        }
    }

    private static func message(_ error: Error) -> String {
        (error as? APIError)?.displayMessage ?? error.localizedDescription
    }
}

struct WatchlistView: View {
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var model: WatchlistModel
    @Environment(\.playarrGoHome) private var goHome

    init(apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository) {
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        _model = State(initialValue: WatchlistModel(apiClient: apiClient))
    }

    var body: some View {
        WMListPage(title: "Watchlist", onBack: goHome) {
            switch model.state {
            case .loading:
                WMListNote(text: "Loading your watchlist…")
            case .failed(let message):
                WMListEmpty(title: "Couldn't load your watchlist", description: message, isError: true)
            case .ready(let items) where items.isEmpty:
                WMListEmpty(
                    title: "Your watchlist is empty",
                    description: "Add titles from search or a title page to keep them here on every device."
                )
            case .ready(let items):
                ForEach(items) { entry in row(entry) }
            }
            if let error = model.removeError { WMListNote(text: error, tone: WM.pink) }
        }
        .task { await model.load() }
    }

    private func row(_ entry: WatchlistEntry) -> some View {
        let title = entry.title
        let actions = entry.actions ?? []
        let primary = WatchlistPresentation.primaryAction(actions)
        let key = title.titleKey
        return WMListRow {
            titleLabel(title)
            WMListMeta(parts: metaParts(title))
            ForEach(WatchlistPresentation.explainedDisabledActions(actions), id: \.action) { action in
                WMListNote(text: "\(action.label): \(action.reason ?? "")")
            }
            if let error = model.requestErrors[key] { WMListNote(text: error, tone: WM.pink) }
        } actions: {
            primaryButton(primary, entry: entry)
            Button { Task { await model.remove(entry) } } label: {
                WMSmallPill(label: "Remove from watchlist")
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func titleLabel(_ title: DiscoveryTitle) -> some View {
        if let workID = WatchlistPresentation.libraryWorkID(title) {
            NavigationLink {
                WorkDetailView(
                    viewModel: WorkDetailViewModel(apiClient: apiClient, workID: workID),
                    apiClient: apiClient,
                    downloadRepository: downloadRepository
                )
            } label: {
                WMText(title.title, 10.88, 700, lh: 16.3)
            }
            .buttonStyle(.plain)
        } else {
            WMText(title.title, 10.88, 700, lh: 16.3)
        }
    }

    private func metaParts(_ title: DiscoveryTitle) -> [String] {
        var parts: [String] = []
        if let year = title.year { parts.append(String(year)) }
        parts += WatchlistPresentation.uniqueSourceKinds(title.sources ?? []).map(TitleSource.chipLabel)
        return parts
    }

    @ViewBuilder
    private func primaryButton(_ primary: TitleAction?, entry: WatchlistEntry) -> some View {
        if let primary, let mediaFileID = primary.mediaFileID, primary.action == "play" || primary.action == "resume" {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: entry.title.title,
                    suggestionsWorkID: primary.workID
                )
            } label: {
                WMPrimaryPill(label: primary.label)
            }
            .buttonStyle(.plain)
        } else if primary?.action == "request" {
            let done = model.requested.contains(entry.title.titleKey)
            Button { Task { await model.request(entry) } } label: {
                WMSmallPill(label: done ? "Requested" : "Request")
            }
            .buttonStyle(.plain)
            .disabled(done)
        }
    }
}

// MARK: - Requests

@MainActor
@Observable
final class RequestsModel {
    fileprivate var state: WMListState<RequestView> = .loading
    private let client: RequestsClient

    init(apiClient: PlayarrAPIClient) {
        client = RequestsClient(transport: apiClient)
    }

    func load() async {
        do {
            state = .ready(try await client.list())
        } catch {
            state = .failed((error as? APIError)?.displayMessage ?? error.localizedDescription)
        }
    }
}

struct RequestsView: View {
    @State private var model: RequestsModel
    @Environment(\.playarrGoHome) private var goHome

    init(apiClient: PlayarrAPIClient) {
        _model = State(initialValue: RequestsModel(apiClient: apiClient))
    }

    var body: some View {
        WMListPage(title: "Requests", onBack: goHome) {
            switch model.state {
            case .loading:
                WMListNote(text: "Loading your requests…")
            case .failed(let message):
                WMListEmpty(title: "Couldn't load your requests", description: message, isError: true)
            case .ready(let items) where items.isEmpty:
                WMListEmpty(
                    title: "No requests yet",
                    description: "Request a title that is not in the library and its progress shows up here."
                )
            case .ready(let items):
                ForEach(items) { request in
                    WMListRow {
                        WMText(request.title, 10.88, 700, lh: 16.3)
                        WMListMeta(parts: metaParts(request))
                        if let note = request.statusNote, !note.isEmpty { WMListNote(text: note) }
                    } actions: {
                        EmptyView()
                    }
                }
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
    }

    private func metaParts(_ request: RequestView) -> [String] {
        var parts: [String] = []
        if let year = request.year { parts.append(String(year)) }
        parts.append(request.status.label)
        if let by = request.requesterLabel { parts.append(by) }
        return parts
    }
}
