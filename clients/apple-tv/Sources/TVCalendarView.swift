import PlayarrKit
import SwiftUI

/// Release Calendar for Apple TV: shared header with Filters, Agenda master-detail, Week and Month,
/// a Filters panel and the calendar-link panel. Logic and state live in `PlayarrKit`
/// (`CalendarViewModel`, `CalendarLogic`), shared with iOS.
struct TVCalendarView: View {
    @Environment(TVAppEnvironment.self) private var environment

    var body: some View {
        TVCalendarContent(transport: environment.apiClient)
    }
}

private enum TVCalendarPanel: Equatable {
    case filters
    case link
}

private struct TVCalendarContent: View {
    @State private var viewModel: CalendarViewModel
    @State private var panel: TVCalendarPanel?
    @FocusState private var focusedKey: String?

    init(transport: PlayarrRequestTransport) {
        _viewModel = State(initialValue: CalendarViewModel(transport: transport))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundBase.ignoresSafeArea()
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                header
                controls
                if !viewModel.unhealthySources.isEmpty { sourceBanner }
                content
            }
            .padding(.leading, DesignTokens.Shell.libraryHeadingLeft)
            .padding(.trailing, DesignTokens.Spacing.xxxl)
            .padding(.top, DesignTokens.Shell.libraryHeadingTop)
            .padding(.bottom, DesignTokens.Spacing.xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if let panel {
                TVCalendarPanelView(panel: panel, viewModel: viewModel) { self.panel = nil }
                    .transition(.move(edge: .trailing))
                    .zIndex(20)
            }
        }
        .task { if viewModel.response == nil { await viewModel.load() } }
        .onChange(of: focusedKey) { _, newValue in
            if let newValue, viewModel.mode == .agenda { viewModel.selectedKey = newValue }
        }
    }

    // MARK: Shared page header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.lg) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Calendar")
                    .font(TVTheme.font(size: DesignTokens.Shell.searchTitleSize, weight: .medium))
                    .tracking(-1.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(viewModel.windowTitle)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
            Spacer(minLength: 0)
            TVCalendarPill(title: "Calendar link", systemImage: "link") { panel = .link }
            TVCalendarPill(
                title: viewModel.filters.activeCount > 0 ? "Filters (\(viewModel.filters.activeCount))" : "Filters",
                systemImage: "line.3.horizontal.decrease.circle"
            ) { panel = .filters }
        }
    }

    private var controls: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            ForEach(CalendarViewMode.allCases, id: \.self) { mode in
                TVCalendarPill(title: mode.tvTitle, selected: viewModel.mode == mode) {
                    Task { await viewModel.setMode(mode) }
                }
            }
            Spacer(minLength: 0)
            TVCalendarPill(title: "Previous", systemImage: "chevron.left") { Task { await viewModel.step(-1) } }
            TVCalendarPill(title: "Today") { Task { await viewModel.goToToday() } }
            TVCalendarPill(title: "Next", systemImage: "chevron.right") { Task { await viewModel.step(1) } }
        }
        .focusSection()
    }

    private var sourceBanner: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(viewModel.unhealthySources) { source in
                Text("\(source.name): some releases may be missing (\(source.status))")
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.stateError)
            }
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch viewModel.loadState {
        case .loading:
            Text("Loading the calendar\u{2026}")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .failed(let message):
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                Text(message)
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                TVCalendarPill(title: "Try again") { Task { await viewModel.load() } }
            }
        case .loaded:
            loaded
        }
    }

    @ViewBuilder
    private var loaded: some View {
        let groups = viewModel.dayGroups
        switch viewModel.mode {
        case .agenda:
            if groups.isEmpty {
                emptyState
            } else {
                // Details on the left, the list on the right.
                HStack(alignment: .top, spacing: DesignTokens.Spacing.xxl) {
                    detailPane(item: viewModel.selectedItem ?? groups.first?.items.first)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                    dayList(groups: groups).frame(maxWidth: .infinity)
                }
            }
        case .week:
            dayList(groups: groups)
        case .month:
            monthView(groups: groups)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Text(viewModel.filters.isEmpty ? "No releases in this period" : "No releases match these filters")
                .font(TVTheme.bodyFont(emphasis: true))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            if !viewModel.filters.isEmpty {
                TVCalendarPill(title: "Clear filters") { viewModel.filters = CalendarFilters() }
            }
        }
    }

    private func dayList(groups: [CalendarDayGroup]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
                        Text(tvDayHeading(group.day, today: viewModel.today))
                            .font(TVTheme.captionFont())
                            .tracking(0.6)
                            .foregroundStyle(
                                group.day == viewModel.today ? DesignTokens.Color.brandPrimary : DesignTokens.Color.textDisabled
                            )
                        if group.items.isEmpty {
                            Text("Nothing scheduled")
                                .font(TVTheme.captionFont())
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                        }
                        ForEach(group.items) { item in
                            Button {
                                viewModel.select(item)
                            } label: {
                                TVCalendarRow(item: item)
                            }
                            .buttonStyle(TVFocusableCardButtonStyle())
                            .focused($focusedKey, equals: item.id)
                        }
                    }
                }
            }
            .padding(.vertical, DesignTokens.Spacing.md)
        }
        .focusSection()
    }

    private func monthView(groups: [CalendarDayGroup]) -> some View {
        let days = viewModel.window.days
        let rows = stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
        let byDay = Dictionary(uniqueKeysWithValues: groups.map { ($0.day, $0) })
        let selectedDay = viewModel.selectedDay ?? viewModel.today
        return HStack(alignment: .top, spacing: DesignTokens.Spacing.xxl) {
            VStack(spacing: 6) {
                ForEach(rows, id: \.first) { row in
                    HStack(spacing: 6) {
                        ForEach(row, id: \.self) { day in
                            Button {
                                viewModel.selectedDay = day
                            } label: {
                                TVCalendarDayCell(
                                    day: day,
                                    count: byDay[day]?.entryCount ?? 0,
                                    isToday: day == viewModel.today,
                                    inMonth: String(day.prefix(7)) == String(viewModel.anchor.prefix(7)),
                                    selected: day == selectedDay
                                )
                            }
                            .buttonStyle(TVFocusableCardButtonStyle())
                        }
                    }
                }
            }
            .focusSection()
            .frame(maxWidth: .infinity)

            if let group = byDay[selectedDay], !group.items.isEmpty {
                dayList(groups: [group]).frame(maxWidth: .infinity)
            } else {
                Text("Nothing scheduled on \(tvDayHeading(selectedDay, today: viewModel.today).capitalized)")
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }

    @ViewBuilder
    private func detailPane(item: CalendarItem?) -> some View {
        if let item {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
                Text(item.title)
                    .font(TVTheme.titleFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                if case .series(_, _, let entries, let codes) = item {
                    Text("\(codes) \u{00B7} \(entries.count) episodes")
                        .font(TVTheme.bodyFont(emphasis: true))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                } else if let entry = item.entries.first {
                    let sub = [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " ")
                    if !sub.isEmpty {
                        Text(sub)
                            .font(TVTheme.bodyFont(emphasis: true))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                    }
                }
                if let entry = item.entries.first {
                    Text(tvStateLabel(item.entries))
                        .font(TVTheme.captionFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    if let at = entry.releaseAt {
                        Text("\(tvDayHeading(entry.date, today: viewModel.today).capitalized) at \(at.formatted(date: .omitted, time: .shortened))")
                            .font(TVTheme.captionFont())
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                    }
                    if let lag = entry.averageLagSeconds, lag > 0 {
                        Text("Usually available \(calendarLagText(seconds: lag)) after release")
                            .font(TVTheme.captionFont())
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                    }
                    let names = Array(Set(item.entries.flatMap(\.sources).map(\.sourceName))).sorted()
                    if !names.isEmpty {
                        Text("Source: \(names.joined(separator: ", "))")
                            .font(TVTheme.captionFont())
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                    }
                    if item.entries.compactMap(\.workID).isEmpty {
                        Text("Not in your library yet")
                            .font(TVTheme.captionFont())
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                    }
                }
            }
        }
    }
}

private extension CalendarViewMode {
    var tvTitle: String {
        switch self {
        case .agenda: return "Agenda"
        case .week: return "Week"
        case .month: return "Month"
        }
    }
}

private func tvDayHeading(_ day: String, today: String) -> String {
    if day == today { return "TODAY" }
    if CalendarDays.adding(days: 1, to: today) == day { return "TOMORROW" }
    guard let date = CalendarDays.displayDate(day) else { return day }
    var style = Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated)
    style.timeZone = TimeZone(identifier: "UTC") ?? .current
    return date.formatted(style).uppercased()
}

private func tvStateLabel(_ entries: [CalendarEntry]) -> String {
    let states = entries.map(\.libraryState)
    if states.allSatisfy({ $0 == .inLibrary }) { return "In library" }
    if states.contains(.monitored) || states.contains(.inLibrary) { return "Monitored" }
    return "Not monitored"
}

/// Pill button with a focus highlight, used for the header actions, view switch and panel options.
private struct TVCalendarPill: View {
    let title: String
    var systemImage: String?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            TVCalendarPillLabel(title: title, systemImage: systemImage, selected: selected)
        }
        .buttonStyle(TVFocusableCardButtonStyle())
    }
}

private struct TVCalendarPillLabel: View {
    @Environment(\.isFocused) private var isFocused
    let title: String
    let systemImage: String?
    let selected: Bool

    var body: some View {
        HStack(spacing: 8) {
            if let systemImage { Image(systemName: systemImage) }
            Text(title)
        }
        .font(TVTheme.bodyFont(emphasis: true))
        .foregroundStyle(isFocused || selected ? DesignTokens.Color.textInverse : DesignTokens.Color.textPrimary)
        .padding(.horizontal, DesignTokens.Spacing.lg)
        .padding(.vertical, DesignTokens.Spacing.sm + 2)
        .background(
            Capsule().fill(
                isFocused ? DesignTokens.Color.brandPrimary
                    : (selected ? DesignTokens.Color.textDisabled : DesignTokens.Color.backgroundElevated)
            )
        )
        .scaleEffect(isFocused ? DesignTokens.FocusMotion.buttonFocusScale : 1)
        .animation(.easeOut(duration: DesignTokens.FocusMotion.transitionSeconds), value: isFocused)
    }
}

private struct TVCalendarRow: View {
    @Environment(\.isFocused) private var isFocused
    let item: CalendarItem

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(TVTheme.bodyFont(emphasis: true))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                Text(subtitle)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Text(tvStateLabel(item.entries).uppercased())
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textDisabled)
        }
        .padding(DesignTokens.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                .fill(isFocused ? DesignTokens.Color.backgroundRaised : DesignTokens.Color.backgroundElevated.opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                .stroke(isFocused ? DesignTokens.Color.focusRing : .clear, lineWidth: 2)
        )
        .scaleEffect(isFocused ? 1.02 : 1)
        .animation(.easeOut(duration: DesignTokens.FocusMotion.transitionSeconds), value: isFocused)
    }

    private var subtitle: String {
        switch item {
        case .series(_, _, let entries, let codes):
            return "\(codes) \u{00B7} \(entries.count) episodes"
        case .single(let entry):
            var parts: [String] = []
            if let code = entry.episodeCode { parts.append(code) }
            if let sub = entry.subtitle { parts.append(sub) }
            if let at = entry.releaseAt { parts.append(at.formatted(date: .omitted, time: .shortened)) }
            return parts.joined(separator: " \u{00B7} ")
        }
    }
}

private struct TVCalendarDayCell: View {
    @Environment(\.isFocused) private var isFocused
    let day: String
    let count: Int
    let isToday: Bool
    let inMonth: Bool
    let selected: Bool

    var body: some View {
        VStack(spacing: 4) {
            Text("\(Int(day.suffix(2)) ?? 0)")
                .font(TVTheme.bodyFont(emphasis: isToday))
                .foregroundStyle(
                    isToday ? DesignTokens.Color.brandPrimary
                        : (inMonth ? DesignTokens.Color.textPrimary : DesignTokens.Color.textDisabled)
                )
            Text(count > 0 ? "\(count)" : " ")
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                .fill(isFocused || selected ? DesignTokens.Color.backgroundRaised : DesignTokens.Color.backgroundElevated.opacity(0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                .stroke(isFocused ? DesignTokens.Color.focusRing : .clear, lineWidth: 2)
        )
        .animation(.easeOut(duration: DesignTokens.FocusMotion.transitionSeconds), value: isFocused)
    }
}

/// Right-hand panel for Filters and the calendar link. Menu/Back closes it.
private struct TVCalendarPanelView: View {
    let panel: TVCalendarPanel
    var viewModel: CalendarViewModel
    let close: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                    Text(panel == .filters ? "Filters" : "Calendar link")
                        .font(TVTheme.titleFont())
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    switch panel {
                    case .filters: filters
                    case .link: link
                    }
                    TVCalendarPill(title: "Done", action: close)
                }
                .padding(DesignTokens.Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(width: DesignTokens.Shell.canvasWidth * 0.34)
            .background(DesignTokens.Color.backgroundBase.opacity(0.97))
            .focusSection()
        }
        .ignoresSafeArea()
        .onExitCommand(perform: close)
    }

    @ViewBuilder
    private var filters: some View {
        optionGroup("Type") {
            ForEach(CalendarType.allCases, id: \.self) { type in
                TVCalendarPill(title: type.title, selected: viewModel.filters.types.contains(type)) {
                    if viewModel.filters.types.contains(type) {
                        viewModel.filters.types.remove(type)
                    } else {
                        viewModel.filters.types.insert(type)
                    }
                }
            }
        }
        if !viewModel.sources.isEmpty {
            optionGroup("Source") {
                ForEach(viewModel.sources) { source in
                    TVCalendarPill(title: source.name, selected: viewModel.filters.sources.contains(source.sourceInstanceID)) {
                        if viewModel.filters.sources.contains(source.sourceInstanceID) {
                            viewModel.filters.sources.remove(source.sourceInstanceID)
                        } else {
                            viewModel.filters.sources.insert(source.sourceInstanceID)
                        }
                    }
                }
            }
        }
        optionGroup("Status") {
            ForEach(CalendarStatus.allCases, id: \.self) { status in
                TVCalendarPill(title: status.title, selected: viewModel.filters.statuses.contains(status)) {
                    if viewModel.filters.statuses.contains(status) {
                        viewModel.filters.statuses.remove(status)
                    } else {
                        viewModel.filters.statuses.insert(status)
                    }
                }
            }
        }
        optionGroup("Date range") {
            TVCalendarPill(title: "Upcoming 30 days", selected: viewModel.filters.from == viewModel.today) {
                if viewModel.filters.from == nil {
                    viewModel.filters.from = viewModel.today
                    viewModel.filters.to = CalendarDays.adding(days: 30, to: viewModel.today)
                } else {
                    viewModel.filters.from = nil
                    viewModel.filters.to = nil
                }
            }
        }
        TVCalendarPill(title: "Monitored only", selected: viewModel.filters.monitoredOnly) {
            viewModel.filters.monitoredOnly.toggle()
        }
        if !viewModel.filters.isEmpty {
            TVCalendarPill(title: "Reset filters") { viewModel.filters = CalendarFilters() }
        }
    }

    private func optionGroup<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text(title.uppercased())
                .font(TVTheme.captionFont())
                .tracking(0.6)
                .foregroundStyle(DesignTokens.Color.textDisabled)
            content()
        }
    }

    @ViewBuilder
    private var link: some View {
        Text("Subscribe in Apple Calendar or any iCal app by scanning the code with your phone. Keep the link private. A new link stops the old one working.")
            .font(TVTheme.captionFont())
            .foregroundStyle(DesignTokens.Color.textSecondary)
        switch viewModel.feedState {
        case .unknown, .loading:
            Text("Loading\u{2026}").font(TVTheme.bodyFont()).foregroundStyle(DesignTokens.Color.textSecondary)
        case .unsupported:
            Text("This server does not offer calendar links yet.")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
        case .failed(let message):
            Text(message).font(TVTheme.bodyFont()).foregroundStyle(DesignTokens.Color.stateError)
            TVCalendarPill(title: "Try again") { Task { await viewModel.loadFeedStatus() } }
        case .inactive:
            TVCalendarPill(title: "Create calendar link") { Task { await viewModel.createFeed() } }
        case .active:
            Text("You have an active link. It is only shown when created.")
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            TVCalendarPill(title: "Create a new link") { Task { await viewModel.createFeed() } }
            TVCalendarPill(title: "Revoke link") { Task { await viewModel.revokeFeed() } }
        case .created(let url):
            TVLocalQRCodeImage(value: url)
                .frame(width: 260, height: 260)
                .padding(8)
                .background(Color.white)
            Text(url)
                .font(TVTheme.captionFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
            TVCalendarPill(title: "Revoke link") { Task { await viewModel.revokeFeed() } }
        }
    }
}
