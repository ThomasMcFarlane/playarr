import PlayarrKit
import SwiftUI

/// Release Calendar: Agenda (master-detail on wide screens), Week and Month, with the shared page
/// header, a Filters sheet and the iCal subscription sheet. Parity with Web `CalendarPage` and the
/// Android calendar; all logic is in `PlayarrKit` and `CalendarViewModel`.
struct CalendarView: View {
    @Environment(\.playarrGoHome) private var goHome
    @State private var viewModel: CalendarViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var showingFilters = false
    @State private var showingSubscription = false
    @State private var detailItem: CalendarItem?

    init(apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository) {
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        #if DEBUG
        // The parity capture freezes the web clock; the native calendar follows the same instant.
        let frozen = ParityLaunch.frozenNow
        _viewModel = State(initialValue: CalendarViewModel(transport: apiClient, now: { frozen ?? Date() }))
        #else
        _viewModel = State(initialValue: CalendarViewModel(transport: apiClient))
        #endif
    }

    var body: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            if phone {
                phoneBody
            } else {
            VStack(alignment: .leading, spacing: 12) {
                header(phone: phone)
                controls(phone: phone)
                if !viewModel.unhealthySources.isEmpty { sourceBanner }
                content(phone: phone)
            }
            .padding(.leading, phone ? 16 : 120)
            .padding(.trailing, phone ? 16 : 40)
            .padding(.top, phone ? 56 : 40)
            .padding(.bottom, phone ? 84 : 24)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            }
        }
        .background(PlayarrStyle.background.ignoresSafeArea())
        .foregroundStyle(PlayarrStyle.ink)
        .navigationBarHidden(true)
        .task { if viewModel.response == nil { await viewModel.load() } }
        .sheet(isPresented: $showingFilters) {
            CalendarFiltersSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $showingSubscription) {
            CalendarSubscriptionSheet(viewModel: viewModel)
        }
        .sheet(item: $detailItem) { item in
            NavigationStack {
                ScrollView {
                    CalendarDetailPane(item: item, apiClient: apiClient, downloadRepository: downloadRepository)
                        .padding(20)
                }
                .background(PlayarrStyle.background)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { detailItem = nil } }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    // MARK: Web mobile layout

    private var phoneRangeLabel: String {
        let window = viewModel.window
        guard let start = CalendarDays.displayDate(window.start), let end = CalendarDays.displayDate(window.end) else {
            return viewModel.windowTitle
        }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = utc.timeZone
        if viewModel.mode == .month, let anchor = CalendarDays.displayDate(viewModel.anchor) {
            formatter.dateFormat = "MMMM yyyy"
            return formatter.string(from: anchor)
        }
        let sameYear = utc.component(.year, from: start) == utc.component(.year, from: end)
        formatter.dateFormat = sameYear ? "d MMM" : "d MMM yyyy"
        let first = formatter.string(from: start)
        formatter.dateFormat = "d MMM yyyy"
        return "\(first) \u{2013} \(formatter.string(from: end))"
    }

    private func roundButton(_ glyph: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WMText(glyph, 11.52, 720, color: WM.inkSoft, lh: 17.28)
                .frame(width: 38, height: 38)
                .background(WM.page, in: Circle())
                .overlay(Circle().stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// Web mobile calendar: header with link and filter buttons, the range picker with
    /// previous, Today and next controls, then the agenda (numbers from the web layout).
    private var phoneBody: some View {
        let top = WM.topInset + 2
        return ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                if !viewModel.unhealthySources.isEmpty { sourceBanner }
                switch viewModel.loadState {
                case .loading:
                    CalendarSkeleton()
                case .failed(let message):
                    PlayarrFailureView(title: "Couldn\u{2019}t load the calendar", message: message) {
                        Task { await viewModel.load() }
                    }
                case .loaded:
                    if viewModel.dayGroups.isEmpty {
                        phoneEmpty
                    } else if viewModel.mode == .agenda {
                        phoneAgenda(groups: viewModel.dayGroups)
                    } else {
                        loaded(phone: true)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 212)
            .padding(.bottom, 120)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            WMHeaderCircleButton(width: 42, height: 38, glyph: "\u{2190}", action: goHome)
                .offset(x: 16, y: top)
            WMText("Release Calendar", 17.6, 580, lh: 26.4, ls: -0.792)
                .frame(height: 38)
                .offset(x: 68, y: top)
            Button { showingSubscription = true } label: {
                Image(systemName: "link")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(WM.inkSoft)
                    .frame(width: 44, height: 38)
                    .background(WM.chip.opacity(0.66), in: Capsule())
                    .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .offset(x: 230, y: top)
            Button { showingFilters = true } label: {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(WM.inkSoft)
                    .frame(width: 44, height: 38)
                    .background(WM.chip.opacity(0.66), in: Capsule())
                    .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .offset(x: 274, y: top)

            Menu {
                Picker("View", selection: Binding(
                    get: { viewModel.mode },
                    set: { newMode in Task { await viewModel.setMode(newMode) } }
                )) {
                    Text("Agenda").tag(CalendarViewMode.agenda)
                    Text("Week").tag(CalendarViewMode.week)
                    Text("Month").tag(CalendarViewMode.month)
                }
            } label: {
                HStack(spacing: 8) {
                    Text(phoneRangeLabel)
                        .font(WM.font(16, 640))
                        .foregroundStyle(WM.ink)
                        .multilineTextAlignment(.center)
                        .frame(width: 139)
                    Text("\u{25BE}\u{FE0E}").font(WM.font(11.52, 720)).foregroundStyle(WM.ink)
                }
                .frame(width: 198, height: 74)
            }
            .offset(x: 16, y: 94)

            roundButton("\u{2190}", label: "Previous period") { Task { await viewModel.step(-1) } }
                .offset(x: 223, y: 89)
            Button { Task { await viewModel.goToToday() } } label: {
                WMText("Today", 11.52, 720, color: WM.inkSoft, lh: 17.28)
                    .frame(width: 82, height: 46)
                    .background(WM.page, in: Capsule())
                    .overlay(Capsule().stroke(WM.ink, lineWidth: 3))
            }
            .buttonStyle(.plain)
            .offset(x: 267, y: 85)
            roundButton("\u{2192}", label: "Next period") { Task { await viewModel.step(1) } }
                .offset(x: 223, y: 138)
        }
        .ignoresSafeArea()
    }

    private func chipLabel(_ text: String, size: CGFloat = 10.4, ls: CGFloat = 1.6, weight: Int = 400) -> some View {
        WMText(text, size, weight, color: WM.muted, lh: 15.6, ls: ls)
    }

    private func releaseTypeLabel(_ type: String) -> String {
        switch type {
        case "air": "Airs"
        case "cinema": "In cinemas"
        case "digital": "Digital release"
        case "physical": "Physical release"
        default: "Releases"
        }
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "episode": "Episodes"
        case "movie": "Movies"
        case "album": "Albums"
        case "book": "Books"
        default: "Releases"
        }
    }

    /// Web mobile agenda: the selected release's detail block, then the day groups.
    private func phoneAgenda(groups: [CalendarDayGroup]) -> some View {
        let item = viewModel.selectedItem ?? groups.first?.items.first
        return ScrollView(.vertical) {
            ZStack(alignment: .topLeading) {
                if let item, let entry = item.entries.first {
                    VStack(alignment: .leading, spacing: 0) {
                        chipLabel("\(kindLabel(entry.mediaKind)) \u{00B7} \(releaseTypeLabel(entry.releaseType))".uppercased(), ls: 1.8, weight: 700)
                        WMText(item.title, 20.8, 700, lh: 28, ls: -0.6).padding(.top, 21.4)
                        WMText(
                            [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " \u{00B7} "),
                            16, 400, lh: 24
                        )
                        .padding(.top, 16)
                        chipLabel("RELEASE").padding(.top, 16.5)
                        WMText(
                            "\(entry.releaseAt.map { Self.releaseFormatter.string(from: $0) } ?? entry.date)",
                            16, 400, lh: 24
                        )
                        chipLabel("STATUS").padding(.top, 11.5)
                        WMText(statusLabel(entry), 16, 700, lh: 17)
                            .padding(.horizontal, 8)
                            .background(WM.adaptive(light: (214, 220, 240), dark: (58, 52, 86)), in: Capsule())
                            .padding(.top, 6)
                        chipLabel("REPORTED BY").padding(.top, 12)
                        if let source = entry.sources.first {
                            HStack(spacing: 5) {
                                WMText(source.sourceName, 16, 400, lh: 24).fixedSize()
                                WMText("(\(source.sourceKind))", 16, 400, color: WM.muted, lh: 24).fixedSize()
                            }
                        }
                        phoneActions(item: item, entry: entry).padding(.top, 16)
                    }
                    .padding(.leading, 0)
                    .offset(y: -27)
                }
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(groups) { group in
                        WMText(Self.groupFormatter.string(from: CalendarDays.displayDate(group.day) ?? Date()), 16, 700, lh: 24)
                            .padding(.leading, 14)
                        ForEach(group.items) { row in
                            phoneAgendaCard(row, selected: row.id == item?.id)
                        }
                    }
                }
                .padding(.top, 322)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(.bottom, 130)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -16)
        .padding(.leading, 16)
    }

    private func statusLabel(_ entry: CalendarEntry) -> String {
        switch entry.libraryState {
        case .inLibrary: "In library"
        case .monitored: "Monitored"
        case .notMonitored: "Not monitored"
        }
    }

    private func phoneActions(item: CalendarItem, entry: CalendarEntry) -> some View {
        HStack(spacing: 10) {
            if let mediaWork = entry.workID {
                NavigationLink {
                    WorkDetailView(
                        viewModel: WorkDetailViewModel(apiClient: apiClient, workID: mediaWork),
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                } label: {
                    WMText("Play", 14.4, 700, color: WM.shell, lh: 21.6)
                        .frame(width: 66, height: 44)
                        .background(WM.adaptive(light: (104, 92, 99), dark: (244, 240, 241)), in: Capsule())
                }
                .buttonStyle(.plain)
                NavigationLink {
                    WorkDetailView(
                        viewModel: WorkDetailViewModel(apiClient: apiClient, workID: mediaWork),
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                } label: {
                    WMText(entry.mediaKind == "episode" ? "Open series" : "Open", 14.4, 700, color: WM.inkSoft, lh: 21.6)
                        .frame(width: entry.mediaKind == "episode" ? 108 : 70, height: 44)
                        .overlay(Capsule().stroke(WM.line.opacity(0.22), lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 8) {
                WMText("+", 14.4, 700, color: WM.inkSoft, lh: 21.6).fixedSize()
                WMText("Add to watchlist", 14.4, 700, color: WM.inkSoft, lh: 21.6).fixedSize()
            }
            .frame(width: 147, height: 44)
            .overlay(Capsule().stroke(WM.line.opacity(0.22), lineWidth: 1.5))
        }
    }

    private func phoneAgendaCard(_ item: CalendarItem, selected: Bool) -> some View {
        let entry = item.entries.first
        return Button {
            viewModel.select(item)
        } label: {
            HStack(alignment: .top, spacing: 14) {
                Group {
                    if let workID = entry?.workID {
                        WMRemoteImage(
                            apiClient: apiClient,
                            sources: [WMRemoteImage.Source(path: "/api/v1/artwork/work/\(workID.uuidString)/poster")]
                        )
                    } else {
                        WM.artFill
                    }
                }
                .frame(width: 38, height: 60)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    WMText(item.title, 16, 700, lh: 22)
                    if let entry {
                        WMText(
                            [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " \u{00B7} "),
                            16, 400, color: WM.inkSoft, lh: 22
                        )
                        HStack(spacing: 10) {
                            WMText(calendarTimeLabel24(entry), 14.4, 400, color: WM.muted, lh: 20).fixedSize()
                            WMText(releaseTypeLabel(entry.releaseType), 14.4, 400, color: WM.muted, lh: 20).fixedSize()
                            WMText(kindLabel(entry.mediaKind), 14.4, 400, color: WM.muted, lh: 20).fixedSize()
                            WMText(statusLabel(entry), 14.4, 700, lh: 20)
                                .padding(.horizontal, 8)
                                .background(WM.adaptive(light: (214, 220, 240), dark: (58, 52, 86)), in: Capsule())
                                .fixedSize()
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(width: 345, height: 90, alignment: .topLeading)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selected ? WM.ink : WM.line.opacity(0.14), lineWidth: selected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .padding(.leading, 4)
    }

    private func calendarTimeLabel24(_ entry: CalendarEntry) -> String {
        guard let at = entry.releaseAt else { return "" }
        return Self.timeFormatter.string(from: at)
    }

    private static let releaseFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEEE, d MMMM yyyy 'at' HH:mm"
        return formatter
    }()

    private static let groupFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEEE d MMMM"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private var phoneEmpty: some View {
        VStack(alignment: .leading, spacing: 0) {
            WMText(
                viewModel.filters.isEmpty ? "Nothing scheduled" : "No releases match these filters",
                16, 700, lh: 24
            )
            Text("No releases from your connected sources fall in this period.")
                .font(WM.font(16))
                .foregroundStyle(WM.muted)
                .frame(width: 358, alignment: .topLeading)
                .padding(.top, 10)
            Text("Select a release to see its details.")
                .font(WM.font(16))
                .foregroundStyle(WM.muted)
                .frame(width: 358, alignment: .topLeading)
                .padding(.top, 36)
        }
    }

    // MARK: Header and controls

    private func header(phone: Bool) -> some View {
        PlayarrPageHeader(
            title: "Calendar",
            detail: viewModel.windowTitle,
            phone: phone,
            filterCount: viewModel.filters.activeCount,
            onFilters: { showingFilters = true }
        ) {
            Button {
                showingSubscription = true
            } label: {
                Label("Calendar link", systemImage: "link")
                    .labelStyle(.iconOnly)
                    .frame(width: 40, height: 40)
                    .background(PlayarrStyle.surfaceStrong.opacity(0.72), in: Circle())
                    .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Calendar link")
        }
        // Keep clear of the profile button the shell floats at the top right on phones.
        .padding(.trailing, phone ? 52 : 0)
    }

    private func controls(phone: Bool) -> some View {
        HStack(spacing: 10) {
            Picker("View", selection: Binding(
                get: { viewModel.mode },
                set: { newMode in Task { await viewModel.setMode(newMode) } }
            )) {
                Text("Agenda").tag(CalendarViewMode.agenda)
                Text("Week").tag(CalendarViewMode.week)
                Text("Month").tag(CalendarViewMode.month)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 280)

            Spacer(minLength: 0)

            Button { Task { await viewModel.step(-1) } } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous period")
            Button("Today") { Task { await viewModel.goToToday() } }
            Button { Task { await viewModel.step(1) } } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next period")
        }
        .buttonStyle(.bordered)
        .tint(PlayarrStyle.inkSoft)
    }

    private var sourceBanner: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(viewModel.unhealthySources) { source in
                Text("\(source.name): \(sourceProblem(source))")
                    .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
            }
        }
        .foregroundStyle(PlayarrStyle.danger)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }

    private func sourceProblem(_ source: CalendarSourceStatus) -> String {
        switch source.status {
        case "unreachable": return "could not be reached, so its releases may be missing"
        case "rejected": return "refused the stored credentials"
        default: return "failed, so its releases may be missing"
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(phone: Bool) -> some View {
        switch viewModel.loadState {
        case .loading:
            CalendarSkeleton()
        case .failed(let message):
            PlayarrFailureView(title: "Couldn\u{2019}t load the calendar", message: message) {
                Task { await viewModel.load() }
            }
        case .loaded:
            loaded(phone: phone)
        }
    }

    @ViewBuilder
    private func loaded(phone: Bool) -> some View {
        switch viewModel.mode {
        case .agenda:
            agenda(phone: phone)
        case .week:
            dayList(groups: viewModel.dayGroups, phone: phone)
        case .month:
            monthView(phone: phone)
        }
    }

    private func agenda(phone: Bool) -> some View {
        let groups = viewModel.dayGroups
        return Group {
            if groups.isEmpty {
                emptyState
            } else if phone {
                dayList(groups: groups, phone: true)
            } else {
                // Wide screens: details on the left, the list on the right.
                HStack(alignment: .top, spacing: 24) {
                    ScrollView {
                        if let item = viewModel.selectedItem ?? groups.first?.items.first {
                            CalendarDetailPane(item: item, apiClient: apiClient, downloadRepository: downloadRepository)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    dayList(groups: groups, phone: false)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func dayList(groups: [CalendarDayGroup], phone: Bool) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14, pinnedViews: []) {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(dayHeading(group.day, today: viewModel.today))
                            .font(.custom("Avenir Next", fixedSize: 11).weight(.heavy))
                            .tracking(0.6)
                            .foregroundStyle(group.day == viewModel.today ? PlayarrStyle.pink : PlayarrStyle.muted)
                        if group.items.isEmpty {
                            Text("Nothing scheduled")
                                .font(.custom("Avenir Next", fixedSize: 12))
                                .foregroundStyle(PlayarrStyle.muted)
                        }
                        ForEach(group.items) { item in
                            CalendarItemRow(item: item, selected: viewModel.selectedKey == item.id) {
                                viewModel.select(item)
                                if phone { detailItem = item }
                            }
                        }
                    }
                }
            }
        }
    }

    private func monthView(phone: Bool) -> some View {
        let window = viewModel.window
        let days = window.days
        let rows = stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
        let groups = Dictionary(uniqueKeysWithValues: viewModel.dayGroups.map { ($0.day, $0) })
        let selectedDay = viewModel.selectedDay ?? viewModel.today
        return ScrollView {
            VStack(spacing: 4) {
                ForEach(rows, id: \.first) { row in
                    HStack(spacing: 4) {
                        ForEach(row, id: \.self) { day in
                            monthCell(day: day, count: groups[day]?.entryCount ?? 0, selected: day == selectedDay)
                        }
                    }
                }
                if let group = groups[selectedDay], !group.items.isEmpty {
                    dayList(groups: [group], phone: phone).frame(minHeight: 160)
                } else {
                    Text("Nothing scheduled on \(dayHeading(selectedDay, today: viewModel.today).capitalized)")
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.muted)
                        .padding(.top, 12)
                }
            }
        }
    }

    private func monthCell(day: String, count: Int, selected: Bool) -> some View {
        let dayNumber = Int(day.suffix(2)) ?? 0
        let inMonth = String(day.prefix(7)) == String(viewModel.anchor.prefix(7))
        return Button {
            viewModel.selectedDay = day
        } label: {
            VStack(spacing: 3) {
                Text("\(dayNumber)")
                    .font(.custom("Avenir Next", fixedSize: 13).weight(day == viewModel.today ? .heavy : .medium))
                    .foregroundStyle(day == viewModel.today ? PlayarrStyle.pink : (inMonth ? PlayarrStyle.ink : PlayarrStyle.muted))
                Circle()
                    .fill(count > 0 ? PlayarrStyle.pink : .clear)
                    .frame(width: 5, height: 5)
                if count > 0 {
                    Text("\(count)").font(.custom("Avenir Next", fixedSize: 9)).foregroundStyle(PlayarrStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                selected ? PlayarrStyle.ink.opacity(0.1) : PlayarrStyle.surfaceStrong.opacity(0.4),
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(dayHeading(day, today: viewModel.today)), \(count) releases")
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.filters.isEmpty ? "No releases in this period" : "No releases match these filters")
                .font(.custom("Avenir Next", fixedSize: 16).weight(.bold))
            if !viewModel.filters.isEmpty {
                Button("Clear filters") { viewModel.filters = CalendarFilters() }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// "TODAY", "TOMORROW", otherwise "MON 6 OCT".
func dayHeading(_ day: String, today: String) -> String {
    if day == today { return "TODAY" }
    if CalendarDays.adding(days: 1, to: today) == day { return "TOMORROW" }
    guard let date = CalendarDays.displayDate(day) else { return day }
    var style = Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated)
    style.timeZone = TimeZone(identifier: "UTC") ?? .current
    return date.formatted(style).uppercased()
}

private struct CalendarItemRow: View {
    let item: CalendarItem
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .frame(width: 22)
                    .foregroundStyle(PlayarrStyle.inkSoft)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.custom("Avenir Next", fixedSize: 14).weight(.semibold))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.custom("Avenir Next", fixedSize: 11))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                CalendarStateBadge(state: aggregateState)
            }
            .padding(10)
            .background(
                selected ? PlayarrStyle.ink.opacity(0.09) : PlayarrStyle.surfaceStrong.opacity(0.5),
                in: RoundedRectangle(cornerRadius: 12)
            )
        }
        .buttonStyle(.plain)
    }

    private var first: CalendarEntry? { item.entries.first }

    private var symbol: String {
        switch first?.kind {
        case .episode: return "tv"
        case .movie: return "film"
        case .album: return "music.note"
        case .book: return "book"
        case nil: return "calendar"
        }
    }

    private var subtitle: String {
        switch item {
        case .series(_, _, let entries, let codes):
            return "\(codes) \u{00B7} \(entries.count) episodes"
        case .single(let entry):
            return [entry.episodeCode, entry.subtitle, calendarTimeLabel(entry)].compactMap { $0 }.joined(separator: " \u{00B7} ")
        }
    }

    private var aggregateState: CalendarLibraryState {
        let states = item.entries.map(\.libraryState)
        if states.allSatisfy({ $0 == .inLibrary }) { return .inLibrary }
        if states.contains(.monitored) || states.contains(.inLibrary) { return .monitored }
        return .notMonitored
    }
}

func calendarTimeLabel(_ entry: CalendarEntry) -> String? {
    guard let at = entry.releaseAt else { return nil }
    return at.formatted(date: .omitted, time: .shortened)
}

struct CalendarStateBadge: View {
    let state: CalendarLibraryState

    var body: some View {
        Text(label)
            .font(.custom("Avenir Next", fixedSize: 9).weight(.heavy))
            .tracking(0.4)
            .foregroundStyle(state == .inLibrary ? PlayarrStyle.onAccent : PlayarrStyle.inkSoft)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                state == .inLibrary ? PlayarrStyle.accent : PlayarrStyle.ink.opacity(0.08),
                in: Capsule()
            )
    }

    private var label: String {
        switch state {
        case .inLibrary: return "IN LIBRARY"
        case .monitored: return "MONITORED"
        case .notMonitored: return "NOT MONITORED"
        }
    }
}

/// Fills the same area as the loaded view so the page does not jump when data arrives.
private struct CalendarSkeleton: View {
    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<6, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(PlayarrStyle.ink.opacity(0.06))
                    .frame(height: 52)
            }
            Spacer(minLength: 0)
        }
        .accessibilityLabel("Loading the calendar")
    }
}

/// Details for one agenda item: titles, release time, library state, sources, lag and Open.
struct CalendarDetailPane: View {
    let item: CalendarItem
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(item.title)
                .font(.custom("Avenir Next", fixedSize: 24).weight(.medium))
            if case .series(_, _, let entries, let codes) = item {
                Text("\(codes) \u{00B7} \(entries.count) episodes")
                    .font(.custom("Avenir Next", fixedSize: 13).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                ForEach(entries) { entry in
                    HStack {
                        Text([entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " "))
                            .font(.custom("Avenir Next", fixedSize: 12))
                        Spacer()
                        CalendarStateBadge(state: entry.libraryState)
                    }
                }
            } else if let entry = item.entries.first {
                let subtitle = [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " ")
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.custom("Avenir Next", fixedSize: 13).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                }
                CalendarStateBadge(state: entry.libraryState)
            }
            if let entry = item.entries.first {
                Text(releaseLine(entry))
                    .font(.custom("Avenir Next", fixedSize: 12))
                    .foregroundStyle(PlayarrStyle.muted)
                if let lag = entry.averageLagSeconds, lag > 0 {
                    Text("Usually available \(calendarLagText(seconds: lag)) after release")
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                let names = Array(Set(item.entries.flatMap(\.sources).map(\.sourceName))).sorted()
                if !names.isEmpty {
                    Text("Source: \(names.joined(separator: ", "))")
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                if let workID = item.entries.compactMap(\.workID).first {
                    NavigationLink {
                        WorkDetailView(
                            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: workID),
                            apiClient: apiClient,
                            downloadRepository: downloadRepository
                        )
                    } label: {
                        Text("Open").frame(minWidth: 120)
                    }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
                    .padding(.top, 6)
                } else {
                    Text("Not in your library yet")
                        .font(.custom("Avenir Next", fixedSize: 12).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func releaseLine(_ entry: CalendarEntry) -> String {
        let kind: String
        switch entry.releaseType {
        case "air": kind = "Airs"
        case "cinema": kind = "In cinemas"
        case "digital": kind = "Digital release"
        case "physical": kind = "Physical release"
        default: kind = "Releases"
        }
        let when = calendarTimeLabel(entry).map { " at \($0)" } ?? ""
        return "\(kind) \(dayHeading(entry.date, today: "").capitalized)\(when)"
    }
}
