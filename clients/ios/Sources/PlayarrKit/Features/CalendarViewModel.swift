import Foundation
import Observation


/// Release Calendar state for iPhone, iPad and Apple TV: window, filters, loaded entries, selection and the
/// iCal subscription. All filtering and grouping lives in `PlayarrKit` (`CalendarLogic.swift`).
@MainActor
@Observable
public final class CalendarViewModel {
    public enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    public enum FeedState: Equatable {
        case unknown
        case loading
        case inactive
        case active(since: Date?)
        case created(url: String)
        case unsupported
        case failed(String)
    }

    public var mode: CalendarViewMode = .agenda
    public private(set) var anchor: String
    public var filters = CalendarFilters()
    public var selectedKey: String?
    public var selectedDay: String?
    public private(set) var loadState: LoadState = .loading
    public private(set) var response: CalendarResponse?
    public private(set) var feedState: FeedState = .unknown

    private let client: CalendarClient
    private let zone: TimeZone
    private let firstWeekday: Int
    private let nowProvider: () -> Date

    public init(
        transport: PlayarrRequestTransport,
        zone: TimeZone = .current,
        firstWeekday: Int = Calendar.current.firstWeekday,
        now: @escaping () -> Date = { Date() }
    ) {
        self.client = CalendarClient(transport: transport)
        self.zone = zone
        self.firstWeekday = firstWeekday
        self.nowProvider = now
        self.anchor = CalendarDays.today(now: now(), zone: zone)
    }

    public var today: String { CalendarDays.today(now: nowProvider(), zone: zone) }
    public var window: CalendarWindow { calendarWindow(mode: mode, anchor: anchor, firstWeekday: firstWeekday) }
    public var sources: [CalendarSourceStatus] { response?.sources ?? [] }
    public var unhealthySources: [CalendarSourceStatus] { sources.filter { !$0.isOK } }

    public var filteredEntries: [CalendarEntry] {
        applyCalendarFilters(response?.entries ?? [], filters: filters, today: today, zone: zone)
    }

    public var dayGroups: [CalendarDayGroup] {
        groupCalendarByDay(filteredEntries, zone: zone, fillingWindow: mode == .agenda ? nil : window)
    }

    public var selectedItem: CalendarItem? {
        guard let selectedKey else { return nil }
        for group in dayGroups {
            if let item = group.items.first(where: { $0.id == selectedKey }) { return item }
        }
        return nil
    }

    public var windowTitle: String {
        let window = window
        guard let start = CalendarDays.displayDate(window.start), let end = CalendarDays.displayDate(window.end) else {
            return "\(window.start) to \(window.end)"
        }
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted)
        style.timeZone = TimeZone(identifier: "UTC") ?? .current
        if mode == .month, let anchorDate = CalendarDays.displayDate(anchor) {
            var month = Date.FormatStyle().month(.wide).year()
            month.timeZone = TimeZone(identifier: "UTC") ?? .current
            return anchorDate.formatted(month)
        }
        return "\(start.formatted(style)) \u{2013} \(end.formatted(style))"
    }

    public func load() async {
        loadState = .loading
        await fetch()
    }

    /// Re-fetches the visible window, keeping the current entries on screen until it answers.
    public func refresh() async {
        if response == nil { loadState = .loading }
        await fetch()
    }

    private func fetch() async {
        let requested = window
        do {
            let result = try await client.calendar(start: requested.start, end: requested.end)
            guard requested == window else { return }
            response = result
            loadState = .loaded
        } catch is CancellationError {
            return
        } catch {
            guard requested == window else { return }
            if response == nil { loadState = .failed(Self.message(for: error)) }
        }
    }

    public func setMode(_ newMode: CalendarViewMode) async {
        guard newMode != mode else { return }
        mode = newMode
        anchor = calendarAnchor(mode: newMode, anchor)
        selectedKey = nil
        selectedDay = nil
        await load()
    }

    public func step(_ direction: Int) async {
        anchor = calendarShift(mode: mode, anchor: anchor, by: direction)
        selectedKey = nil
        selectedDay = nil
        await load()
    }

    public func goToToday() async {
        anchor = calendarAnchor(mode: mode, today)
        selectedKey = nil
        selectedDay = nil
        await load()
    }

    /// Jumps to a day (web: a month cell opens the agenda there).
    public func goTo(_ day: String) async {
        anchor = calendarAnchor(mode: mode, day)
        selectedKey = nil
        selectedDay = day
        await load()
    }

    public func select(_ item: CalendarItem?) {
        selectedKey = item?.id
    }

    // MARK: Subscription

    public func loadFeedStatus() async {
        feedState = .loading
        do {
            let status = try await client.feedStatus()
            feedState = status.active ? .active(since: status.createdAt) : .inactive
        } catch APIError.notFound {
            feedState = .unsupported
        } catch {
            feedState = Self.isUnsupported(error) ? .unsupported : .failed(Self.message(for: error))
        }
    }

    public func createFeed() async {
        feedState = .loading
        do {
            let created = try await client.createFeed()
            feedState = .created(url: created.url)
        } catch {
            feedState = Self.isUnsupported(error) ? .unsupported : .failed(Self.message(for: error))
        }
    }

    public func revokeFeed() async {
        feedState = .loading
        do {
            try await client.revokeFeed()
            feedState = .inactive
        } catch {
            feedState = Self.isUnsupported(error) ? .unsupported : .failed(Self.message(for: error))
        }
    }

    private static func isUnsupported(_ error: Error) -> Bool {
        if case APIError.http(let status, _, _) = error { return [404, 405, 501].contains(status) }
        if case APIError.notFound = error { return true }
        return false
    }

    static func message(for error: Error) -> String {
        if case APIError.transport = error { return "The server could not be reached." }
        if case APIError.unauthorized = error { return "Your session has expired. Sign in again." }
        if case APIError.http(let status, _, _) = error, status == 403 { return "This profile cannot view the calendar." }
        return "The calendar could not be loaded."
    }
}
