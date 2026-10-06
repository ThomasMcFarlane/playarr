import Foundation

// Pure, UI-free Release Calendar logic shared by iOS and tvOS. Mirrors the Web
// (`groupSeriesEpisodes`, `applyCalendarFilters`) and Android (`PlayarrCalendarLogic`) behaviour.

/// `YYYY-MM-DD` day arithmetic on a fixed UTC Gregorian calendar, so a device time zone never shifts a day.
public enum CalendarDays {
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        return calendar
    }()

    public static func key(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// Parses `YYYY-MM-DD`; nil for anything else.
    public static func parse(_ key: String) -> Date? {
        let parts = key.split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        var components = DateComponents()
        components.year = y
        components.month = m
        components.day = d
        components.hour = 12
        guard let date = utc.date(from: components) else { return nil }
        let back = utc.dateComponents([.year, .month, .day], from: date)
        guard back.year == y, back.month == m, back.day == d else { return nil }
        return date
    }

    public static func format(_ date: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return key(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
    }

    /// The UTC day containing `date`.
    public static func today(now: Date = Date()) -> String { format(now) }

    public static func adding(days: Int, to key: String) -> String {
        guard let date = parse(key), let moved = utc.date(byAdding: .day, value: days, to: date) else { return key }
        return format(moved)
    }

    public static func daysBetween(_ from: String, _ to: String) -> Int {
        guard let a = parse(from), let b = parse(to) else { return 0 }
        return utc.dateComponents([.day], from: a, to: b).day ?? 0
    }

    /// 1 = Sunday ... 7 = Saturday.
    public static func weekday(of key: String) -> Int {
        guard let date = parse(key) else { return 1 }
        return utc.component(.weekday, from: date)
    }

    public static func firstOfMonth(_ key: String) -> String {
        guard let date = parse(key) else { return key }
        let c = utc.dateComponents([.year, .month], from: date)
        return Self.key(year: c.year ?? 1970, month: c.month ?? 1, day: 1)
    }

    public static func lastOfMonth(_ key: String) -> String {
        guard let date = parse(key), let range = utc.range(of: .day, in: .month, for: date) else { return key }
        let c = utc.dateComponents([.year, .month], from: date)
        return Self.key(year: c.year ?? 1970, month: c.month ?? 1, day: range.count)
    }

    public static func addingMonths(_ months: Int, to key: String) -> String {
        guard let date = parse(key), let moved = utc.date(byAdding: .month, value: months, to: date) else { return key }
        return format(moved)
    }

    /// Start of the week containing `key`, where `firstWeekday` is 1 (Sunday) to 7 (Saturday).
    public static func startOfWeek(containing key: String, firstWeekday: Int) -> String {
        let offset = (weekday(of: key) - firstWeekday + 7) % 7
        return adding(days: -offset, to: key)
    }

    public static func days(from start: String, to end: String) -> [String] {
        var result: [String] = []
        var cursor = start
        var guardCount = 0
        while cursor <= end && guardCount < 400 {
            result.append(cursor)
            cursor = adding(days: 1, to: cursor)
            guardCount += 1
        }
        return result
    }

    /// A date for display, built from a day key at local noon so it never crosses a day boundary.
    public static func displayDate(_ key: String) -> Date? { parse(key) }
}

public enum CalendarViewMode: String, Sendable, CaseIterable, Hashable {
    case agenda
    case week
    case month
}

public struct CalendarWindow: Sendable, Equatable {
    public let start: String
    public let end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }

    public var days: [String] { CalendarDays.days(from: start, to: end) }
}

/// The server default is today through today plus 30 days; the agenda requests the same 31 days.
public let calendarAgendaSpanDays = 31

public func calendarWindow(mode: CalendarViewMode, anchor: String, firstWeekday: Int = 2) -> CalendarWindow {
    switch mode {
    case .agenda:
        return CalendarWindow(start: anchor, end: CalendarDays.adding(days: calendarAgendaSpanDays - 1, to: anchor))
    case .week:
        let start = CalendarDays.startOfWeek(containing: anchor, firstWeekday: firstWeekday)
        return CalendarWindow(start: start, end: CalendarDays.adding(days: 6, to: start))
    case .month:
        let first = CalendarDays.firstOfMonth(anchor)
        let last = CalendarDays.lastOfMonth(anchor)
        let start = CalendarDays.startOfWeek(containing: first, firstWeekday: firstWeekday)
        let lastWeekStart = CalendarDays.startOfWeek(containing: last, firstWeekday: firstWeekday)
        return CalendarWindow(start: start, end: CalendarDays.adding(days: 6, to: lastWeekStart))
    }
}

public func calendarAnchor(mode: CalendarViewMode, _ day: String) -> String {
    mode == .month ? CalendarDays.firstOfMonth(day) : day
}

/// Moves the anchor one period backwards (`-1`) or forwards (`+1`).
public func calendarShift(mode: CalendarViewMode, anchor: String, by step: Int) -> String {
    switch mode {
    case .agenda: return CalendarDays.adding(days: step * calendarAgendaSpanDays, to: anchor)
    case .week: return CalendarDays.adding(days: step * 7, to: anchor)
    case .month: return CalendarDays.firstOfMonth(CalendarDays.addingMonths(step, to: anchor))
    }
}

// MARK: - Filters

public enum CalendarType: String, Sendable, CaseIterable, Hashable {
    case tv
    case movie
    case music
    case book

    public var kind: CalendarMediaKind {
        switch self {
        case .tv: return .episode
        case .movie: return .movie
        case .music: return .album
        case .book: return .book
        }
    }

    public var title: String {
        switch self {
        case .tv: return "TV"
        case .movie: return "Movies"
        case .music: return "Music"
        case .book: return "Books"
        }
    }
}

public enum CalendarStatus: String, Sendable, CaseIterable, Hashable {
    case aired
    case upcoming
    case downloaded
    case missing

    public var title: String {
        switch self {
        case .aired: return "Aired"
        case .upcoming: return "Upcoming"
        case .downloaded: return "Downloaded"
        case .missing: return "Missing"
        }
    }
}

public struct CalendarFilters: Sendable, Equatable {
    public var types: Set<CalendarType>
    public var sources: Set<UUID>
    public var statuses: Set<CalendarStatus>
    public var from: String?
    public var to: String?
    public var monitoredOnly: Bool

    public init(
        types: Set<CalendarType> = [],
        sources: Set<UUID> = [],
        statuses: Set<CalendarStatus> = [],
        from: String? = nil,
        to: String? = nil,
        monitoredOnly: Bool = false
    ) {
        self.types = types
        self.sources = sources
        self.statuses = statuses
        self.from = from
        self.to = to
        self.monitoredOnly = monitoredOnly
    }

    public var activeCount: Int {
        [
            !types.isEmpty,
            !sources.isEmpty,
            !statuses.isEmpty,
            from != nil || to != nil,
            monitoredOnly
        ].filter { $0 }.count
    }

    public var isEmpty: Bool { activeCount == 0 }
}

/// The local calendar day of an entry: its release instant in `zone` when known, else the server's UTC day.
public func calendarLocalDay(_ entry: CalendarEntry, zone: TimeZone) -> String {
    guard let releaseAt = entry.releaseAt else { return entry.date }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let c = calendar.dateComponents([.year, .month, .day], from: releaseAt)
    return CalendarDays.key(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
}

private func entryMatches(_ status: CalendarStatus, entry: CalendarEntry, today: String, zone: TimeZone) -> Bool {
    let aired = calendarLocalDay(entry, zone: zone) <= today
    switch status {
    case .aired: return aired
    case .upcoming: return !aired
    case .downloaded: return entry.hasFile
    case .missing: return aired && !entry.hasFile
    }
}

/// Values inside one filter are OR-ed, different filters AND-ed (same as Web `applyCalendarFilters`).
public func applyCalendarFilters(
    _ entries: [CalendarEntry],
    filters: CalendarFilters,
    today: String,
    zone: TimeZone
) -> [CalendarEntry] {
    if filters.isEmpty { return entries }
    let kinds = Set(filters.types.map(\.kind))
    return entries.filter { entry in
        let day = calendarLocalDay(entry, zone: zone)
        if !kinds.isEmpty, let kind = entry.kind, !kinds.contains(kind) { return false }
        if !filters.sources.isEmpty, !entry.sources.contains(where: { filters.sources.contains($0.sourceInstanceID) }) {
            return false
        }
        if !filters.statuses.isEmpty,
           !filters.statuses.contains(where: { entryMatches($0, entry: entry, today: today, zone: zone) }) {
            return false
        }
        if filters.monitoredOnly && !entry.monitored { return false }
        if let from = filters.from, day < from { return false }
        if let to = filters.to, day > to { return false }
        return true
    }
}

// MARK: - Grouping

public enum CalendarLibraryState: Sendable, Equatable {
    case inLibrary
    case monitored
    case notMonitored
}

public extension CalendarEntry {
    var libraryState: CalendarLibraryState {
        if hasFile { return .inLibrary }
        return monitored ? .monitored : .notMonitored
    }

    /// `S01E02` for episodes that carry both numbers, else nil.
    var episodeCode: String? {
        guard let season = seasonNumber, let episode = episodeNumber else { return nil }
        return String(format: "S%02dE%02d", season, episode)
    }
}

/// `S02E04–E06`, `S02E01, E03`, `S01E10, S02E01`: contiguous runs collapse, gaps are listed.
public func formatEpisodeCodes(_ entries: [CalendarEntry]) -> String {
    var bySeason: [Int: [Int]] = [:]
    for entry in entries {
        guard let season = entry.seasonNumber, let episode = entry.episodeNumber else { continue }
        bySeason[season, default: []].append(episode)
    }
    var parts: [String] = []
    for season in bySeason.keys.sorted() {
        var runs: [(first: Int, last: Int)] = []
        for episode in Set(bySeason[season] ?? []).sorted() {
            if let last = runs.last, episode == last.last + 1 {
                runs[runs.count - 1] = (last.first, episode)
            } else {
                runs.append((episode, episode))
            }
        }
        for (index, run) in runs.enumerated() {
            let prefix = index == 0 ? String(format: "S%02d", season) : ""
            let from = String(format: "E%02d", run.first)
            if run.first == run.last {
                parts.append(prefix + from)
            } else {
                parts.append(prefix + from + "\u{2013}" + String(format: "E%02d", run.last))
            }
        }
    }
    return parts.joined(separator: ", ")
}

public enum CalendarItem: Sendable, Equatable, Identifiable {
    case single(CalendarEntry)
    case series(key: String, title: String, entries: [CalendarEntry], codes: String)

    public var id: String {
        switch self {
        case .single(let entry): return entry.id
        case .series(let key, _, _, _): return key
        }
    }

    public var entries: [CalendarEntry] {
        switch self {
        case .single(let entry): return [entry]
        case .series(_, _, let entries, _): return entries
        }
    }

    public var title: String {
        switch self {
        case .single(let entry): return entry.title
        case .series(_, let title, _, _): return title
        }
    }
}

private func timeSlot(_ entry: CalendarEntry, zone: TimeZone) -> String {
    guard let releaseAt = entry.releaseAt else { return "all-day" }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let c = calendar.dateComponents([.hour, .minute], from: releaseAt)
    return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
}

/// Collapses episodes of the same series released on the same local day and air-time slot into one
/// `.series` item. Movies, albums, books, lone episodes and unnumbered episodes stay individual.
/// Pass one day's entries. Same semantics as Web and Android `groupSeriesEpisodes`.
public func groupSeriesEpisodes(_ entries: [CalendarEntry], zone: TimeZone) -> [CalendarItem] {
    var order: [String] = []
    var buckets: [String: [CalendarEntry]] = [:]
    for entry in entries {
        let groupable = entry.kind == .episode && entry.seasonNumber != nil && entry.episodeNumber != nil
        let key: String
        if groupable {
            let owner = entry.workID?.uuidString ?? entry.title
            key = "series:\(owner):\(calendarLocalDay(entry, zone: zone)):\(timeSlot(entry, zone: zone))"
        } else {
            key = "single:\(entry.id)"
        }
        if buckets[key] == nil { order.append(key) }
        buckets[key, default: []].append(entry)
    }
    return order.map { key in
        let members = buckets[key] ?? []
        if members.count == 1, let only = members.first {
            return CalendarItem.single(only)
        }
        let sorted = members.sorted { a, b in
            let sa = a.seasonNumber ?? 0, sb = b.seasonNumber ?? 0
            if sa != sb { return sa < sb }
            let ea = a.episodeNumber ?? 0, eb = b.episodeNumber ?? 0
            if ea != eb { return ea < eb }
            return a.id < b.id
        }
        return CalendarItem.series(
            key: key,
            title: sorted.first?.title ?? "",
            entries: sorted,
            codes: formatEpisodeCodes(sorted)
        )
    }
}

public struct CalendarDayGroup: Sendable, Equatable, Identifiable {
    public let day: String
    public let items: [CalendarItem]
    public var id: String { day }
    public var entryCount: Int { items.reduce(0) { $0 + $1.entries.count } }
}

private func entryOrder(_ a: CalendarEntry, _ b: CalendarEntry) -> Bool {
    switch (a.releaseAt, b.releaseAt) {
    case (let x?, let y?) where x != y: return x < y
    case (nil, _?): return false
    case (_?, nil): return true
    default: break
    }
    let ta = a.title.lowercased(), tb = b.title.lowercased()
    if ta != tb { return ta < tb }
    if (a.seasonNumber ?? 0) != (b.seasonNumber ?? 0) { return (a.seasonNumber ?? 0) < (b.seasonNumber ?? 0) }
    if (a.episodeNumber ?? 0) != (b.episodeNumber ?? 0) { return (a.episodeNumber ?? 0) < (b.episodeNumber ?? 0) }
    return a.id < b.id
}

/// Groups entries by local day, series-grouped within each day. With `fillingWindow` every day of the
/// window gets a group (week view); otherwise only days with entries do (agenda).
public func groupCalendarByDay(
    _ entries: [CalendarEntry],
    zone: TimeZone,
    fillingWindow window: CalendarWindow? = nil
) -> [CalendarDayGroup] {
    var byDay: [String: [CalendarEntry]] = [:]
    for entry in entries {
        byDay[calendarLocalDay(entry, zone: zone), default: []].append(entry)
    }
    var days = Set(byDay.keys)
    if let window { days.formUnion(window.days) }
    return days.sorted().map { day in
        let sorted = (byDay[day] ?? []).sorted(by: entryOrder)
        return CalendarDayGroup(day: day, items: groupSeriesEpisodes(sorted, zone: zone))
    }
}

/// Human wording for the average air-to-library lag.
public func calendarLagText(seconds: Int64) -> String {
    let clamped = max(0, seconds)
    let hours = Double(clamped) / 3600.0
    if hours >= 48 {
        let days = Int((hours / 24).rounded())
        return "about \(days) days"
    }
    if hours >= 1 {
        let h = Int(hours.rounded())
        return h == 1 ? "about 1 hour" : "about \(h) hours"
    }
    let minutes = max(1, Int((Double(clamped) / 60).rounded()))
    return minutes == 1 ? "about 1 minute" : "about \(minutes) minutes"
}
