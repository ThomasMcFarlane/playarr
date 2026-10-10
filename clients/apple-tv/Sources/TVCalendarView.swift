import PlayarrKit
import SwiftUI

/// Release Calendar on the web TV grid: header with period controls, the month button and the
/// agenda for the window. All filtering and grouping comes from `CalendarViewModel` (shared with iOS).
struct TVCalendarView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: CalendarViewModel?
    /// The open side panel (web: the action column's Calendar link and Filters drawers).
    @State private var panel: Panel?
    @FocusState private var focusedEntry: String?

    private enum Panel { case link, filters }

    var body: some View {
        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundElevated.ignoresSafeArea()
            if let viewModel {
                content(viewModel)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        .task(id: environment.serverURL) {
            // Parity captures freeze the clock and the zone (the web reference does the same); users get their own.
            let model = CalendarViewModel(
                transport: environment.apiClient,
                zone: TVParityLaunch.isLive ? (TimeZone(identifier: "UTC") ?? .current) : .current,
                firstWeekday: 2,
                now: { TVParityLaunch.isLive ? TVParityLaunch.frozenNow : Date() }
            )
            viewModel = model
            await model.setMode(.agenda)
            await model.load()
        }
    }

    @ViewBuilder
    private func content(_ model: CalendarViewModel) -> some View {
        if model.mode == .agenda, let item = selectedAgendaItem(model), let entry = item.entries.first {
            TVKeyArt(url: entry.posterURL.flatMap { environment.apiClient.resolvedURL(forPath: $0) })
            TVStageWash()
            agendaDetail(entry, item: item, today: model.today)
        }

        TVPageHeader(title: "Calendar")

        // Web header controls, top right: the date range button, previous, Today, next (one group).
        rangeButton(model)
        roundControl("\u{2190}", x: 1628.5) { Task { await model.step(-1) } }
        pillControl("Today", x: 1693.8, width: 84) { Task { await model.goToToday() } }
        roundControl("\u{2192}", x: 1793.2) { Task { await model.step(1) } }

        // Side-panel buttons stack in the shell action column, in registration order.
        pill("Calendar link", symbol: "bell", slot: 0) {
            panel = .link
            Task { await model.loadFeedStatus() }
        }
        pill("Filters", symbol: "line.3.horizontal.decrease", slot: 1) { panel = .filters }

        switch model.loadState {
        case .loading:
            skeleton(model.mode)
        case .failed(let message):
            Text(message)
                .font(TVTheme.font(size: 19.2, weight: .regular))
                .foregroundStyle(DesignTokens.Color.stateError)
                .placed(x: 153.6, y: 260, w: 900)
        case .loaded:
            switch model.mode {
            case .agenda:
                if model.filteredEntries.isEmpty {
                    Text("Nothing scheduled")
                        .font(TVTheme.font(size: 22.4, weight: .bold))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .placed(x: 783.4, y: 170, w: 600, h: 33.6)
                } else {
                    agendaList(model)
                }
            case .week:
                weekView(model)
            case .month:
                monthView(model)
            }
        }

        switch panel {
        case .filters:
            TVDrawer(kicker: "Calendar", title: "Filters", onClose: { panel = nil }) {
                TVChoiceSection(
                    title: "View",
                    options: [(CalendarViewMode.agenda, "Agenda"), (.week, "Week"), (.month, "Month")],
                    selection: Binding(get: { model.mode }, set: { mode in Task { await model.setMode(mode) } })
                )
            }
            .zIndex(30)
        case .link:
            TVDrawer(kicker: "Calendar", title: "Calendar link", onClose: { panel = nil }) {
                calendarLink(model)
            }
            .zIndex(30)
        case nil:
            EmptyView()
        }
    }

    // MARK: Header

    /// Web `formatRangeButtonLabel`: "11 Oct \u{2013} 9 Nov" (agenda), "5 \u{2013} 11 Oct" (week), "Oct 2026" (month).
    private static func rangeLabel(_ model: CalendarViewModel) -> String {
        guard let start = CalendarDays.displayDate(model.window.start),
              let end = CalendarDays.displayDate(model.window.end) else { return model.windowTitle }
        switch model.mode {
        case .month:
            return CalendarDays.displayDate(model.anchor).map { format($0, "MMM yyyy") } ?? model.windowTitle
        case .week:
            let sameMonth = format(start, "MMM") == format(end, "MMM")
            return sameMonth ? "\(format(start, "d")) \u{2013} \(format(end, "d MMM"))"
                : "\(format(start, "d MMM")) \u{2013} \(format(end, "d MMM"))"
        case .agenda:
            return "\(format(start, "d MMM")) \u{2013} \(format(end, "d MMM"))"
        }
    }

    /// The range button cycles the view (Agenda, Week, Month); the Filters drawer sets it directly.
    private func rangeButton(_ model: CalendarViewModel) -> some View {
        let label = Self.rangeLabel(model)
        let font = TVFontLoader.uiFont(mono: false, size: 14.72, weight: 720)
        let width = ceil((label as NSString).size(withAttributes: [.font: font]).width) + 40
        return pillControl(label, x: 1628.5 - 15.4 - width, width: width) {
            let next: CalendarViewMode = model.mode == .agenda ? .week : model.mode == .week ? .month : .agenda
            Task { await model.setMode(next) }
        }
    }

    private func roundControl(_ glyph: String, x: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph)
                .font(TVTheme.font(size: 14.72, css: 720))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(width: 50, height: 50)
                .background(Circle().fill(DesignTokens.Color.backgroundElevated))
                .overlay(Circle().stroke(DesignTokens.Stage.line.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 25))
        .focusEffectDisabled()
        .disabled(TVParityLaunch.frozen)
        .placed(x: x, y: 56.2, w: 50, h: 50)
    }

    private func pillControl(_ label: String, x: CGFloat, width: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TVHeaderPill(label: label, symbol: "", width: width, control: true)
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 25))
        .focusEffectDisabled()
        .disabled(TVParityLaunch.frozen)
        .placed(x: x, y: 56.2, w: width, h: 50)
    }

    // MARK: Agenda

    private func selectedAgendaItem(_ model: CalendarViewModel) -> CalendarItem? {
        let groups = model.dayGroups.filter { !$0.items.isEmpty }
        if let focusedEntry, let match = groups.lazy.flatMap(\.items).first(where: { $0.id == focusedEntry }) { return match }
        return model.selectedItem ?? groups.first?.items.first
    }

    /// Web agenda list (`ListPanel`): day headings and entry cards from x 783.4, 1033.4 wide; the details panel on the
    /// left follows focus as UP/DOWN moves (owner rule), Select opens the title.
    private func agendaList(_ model: CalendarViewModel) -> some View {
        let groups = model.dayGroups.filter { !$0.items.isEmpty }
        return ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(groups, id: \.day) { group in
                    dayHeading(group.day, today: model.today)
                        .frame(height: 44, alignment: .leading)
                        .padding(.bottom, 32)
                    ForEach(group.items, id: \.id) { item in
                        entryButton(item, width: 1033.4, today: model.today)
                            .padding(.bottom, 13.7)
                    }
                    Spacer().frame(height: 18.3)
                }
            }
            .padding(.top, 162 - 130)
            .padding(.bottom, 200)
        }
        // The list starts under the header row so the header controls stay reachable with UP (focus search).
        .mask(Self.topFade)
        .placed(x: 783.4, y: 130, w: 1033.4 + 30, h: 950, alignment: .topLeading)
    }

    private func dayHeading(_ day: String, today: String) -> some View {
        HStack(spacing: 10) {
            Text(Self.dayHeading(day))
                .font(TVTheme.font(size: 18.4, css: 640))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            if day == today {
                Text("TODAY")
                    .font(TVTheme.font(size: 11.2, css: 640))
                    .tracking(0.896)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(.horizontal, 9)
                    .frame(height: 22)
                    .overlay(Capsule().stroke(DesignTokens.Color.textPrimary.opacity(0.6), lineWidth: 1))
            }
        }
    }

    /// Web scroll edge fade at the top: content fades out before the header line.
    static let topFade = LinearGradient(
        stops: [.init(color: .clear, location: 0), .init(color: .black, location: 30 / 950), .init(color: .black, location: 1)],
        startPoint: .top, endPoint: .bottom
    )

    private static func dayHeading(_ day: String) -> String {
        guard let date = CalendarDays.displayDate(day) else { return day }
        return format(date, "EEEE d MMMM")
    }

    /// A focusable entry card (web `.calendar-entry`, a solid media card): the card focus (lift, shadow, glow).
    private func entryButton(_ item: CalendarItem, width: CGFloat, today: String) -> some View {
        let focused = focusedEntry == item.id
        return NavigationLink {
            if let workID = item.entries.first?.workID {
                TVWorkDetailLoader(workID: workID)
            } else {
                Text("This title is not in your catalogue yet.")
                    .font(TVTheme.font(size: 19.2, css: 400))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        } label: {
            entryCard(item, width: width, today: today)
                .modifier(TVCardFocusGlow(focused: focused, cornerRadius: 12))
                .shadow(color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(focused ? 0.3 : 0), radius: 24, y: 24)
                .offset(y: focused ? -7 : 0)
                .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.26), value: focused)
        }
        .buttonStyle(TVFocusableCardButtonStyle())
        .focusEffectDisabled()
        .focused($focusedEntry, equals: item.id)
        .disabled(TVParityLaunch.frozen)
    }

    private func entryCard(_ item: CalendarItem, width: CGFloat, today: String) -> some View {
        let entry = item.entries.first
        let code = item.entries.count > 1
            ? (item.entries.count == 1 ? nil : "\(item.entries.count) episodes")
            : entry.flatMap { Self.episodeCode($0) }
        let subtitle = [code, item.entries.count > 1 ? nil : entry?.subtitle].compactMap { $0 }.joined(separator: " \u{00B7} ")
        let available = item.entries.allSatisfy(\.hasFile)
        return HStack(alignment: .center, spacing: 14.4) {
            posterView(entry)
                .frame(width: 40, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            VStack(alignment: .leading, spacing: 2.4) {
                Text(Self.title(of: item))
                    .font(TVTheme.font(size: 19.2, css: 640))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .frame(height: 28.8)
                Text(subtitle)
                    .font(TVTheme.font(size: 19.2, css: 400))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                    .lineLimit(1)
                    .frame(height: 28.8)
                HStack(spacing: 12) {
                    Text(entry?.releaseAt.map { Self.format($0, "HH:mm") } ?? "All day")
                    Text(entry.map { Self.releaseLabel($0) } ?? "")
                    Text(entry.map { Self.kindLabel($0) } ?? "")
                    TVStatusPill(tone: Self.tone(of: item, today: today))
                }
                .font(TVTheme.font(size: 12.8, css: 400))
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(height: 26.6)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .frame(width: width, height: 106.9)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DesignTokens.Stage.surfaceStrong))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DesignTokens.Stage.line.opacity(0.3), lineWidth: 1))
        // The left border shows availability: we have it (playable) or not (owner rule).
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 12, style: .continuous)
                .fill(available ? DesignTokens.Stage.success : DesignTokens.Stage.inkMuted)
                .frame(width: 4)
        }
    }

    /// Web `entryPillTone` / `itemPillTone`: have it, not out yet, out but absent, or nothing to report.
    static func tone(of item: CalendarItem, today: String) -> TVStatusPill.Tone {
        let tones = item.entries.map { entry -> TVStatusPill.Tone in
            if entry.hasFile { return .available }
            if entry.date > today { return .upcoming }
            return entry.monitored ? .missing : .neutral
        }
        for tone in [TVStatusPill.Tone.missing, .upcoming, .neutral] where tones.contains(tone) { return tone }
        return .available
    }

    // MARK: Week

    /// Web week view: one 440-wide column per day (pitch 460) on a horizontal track; LEFT/RIGHT between days, UP/DOWN
    /// between entries (owner rule).
    private func weekView(_ model: CalendarViewModel) -> some View {
        let byDay = Dictionary(uniqueKeysWithValues: model.dayGroups.map { ($0.day, $0.items) })
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 20) {
                ForEach(model.window.days, id: \.self) { day in
                    VStack(alignment: .leading, spacing: 13.6) {
                        dayHeading(day, today: model.today)
                            .frame(height: 27.6, alignment: .leading)
                            .padding(.bottom, -15.2) // 6.4 to the first card (spacing 13.6, list inset 8)
                        let items = byDay[day] ?? []
                        if items.isEmpty {
                            Text("Nothing scheduled")
                                .font(TVTheme.font(size: 12.8, css: 400))
                                .foregroundStyle(DesignTokens.Color.textDisabled)
                        }
                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(alignment: .leading, spacing: 13.6) {
                                ForEach(items, id: \.id) { item in
                                    entryButton(item, width: 440, today: model.today)
                                }
                            }
                            .padding(.vertical, 8)
                        }
                        .scrollClipDisabled()
                        .frame(width: 440, height: 1080 - 208 - 40, alignment: .topLeading)
                        .mask(Self.topFade)
                    }
                    .frame(width: 440, alignment: .topLeading)
                    .focusSection()
                }
            }
            .padding(.leading, 153.6)
            .padding(.trailing, 120)
            .padding(.top, 174 - 140)
        }
        .scrollClipDisabled()
        .placed(x: 0, y: 140, w: 1920, h: 940, alignment: .topLeading)
    }

    // MARK: Month

    /// Web month grid: weekday row at y 174, then 7 columns of 237.6 wide cells from (153.6, 204.8) filling the space to
    /// y 961.3; up to four text lines with an availability dot, the day number and "+N more" at the foot. Select opens
    /// the agenda at that day (web).
    private func monthView(_ model: CalendarViewModel) -> some View {
        let days = model.window.days
        let rows = max(1, days.count / 7)
        let cellH = (961.3 - 204.8) / CGFloat(rows)
        let byDay = Dictionary(uniqueKeysWithValues: model.dayGroups.map { ($0.day, $0.items) })
        let month = String(model.anchor.prefix(7))
        return ZStack(alignment: .topLeading) {
            ForEach(Array(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].enumerated()), id: \.offset) { index, name in
                Text(name.uppercased())
                    .font(TVTheme.font(size: 12, css: 400))
                    .tracking(0.96)
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .frame(width: 237.6, height: 30.8)
                    .placed(x: 153.6 + 237.6 * CGFloat(index), y: 174, w: 237.6, h: 30.8)
            }
            ForEach(Array(days.enumerated()), id: \.element) { index, day in
                monthCell(day: day, items: byDay[day] ?? [], outside: !day.hasPrefix(month), height: cellH, model: model)
                    .placed(x: 153.6 + 237.6 * CGFloat(index % 7), y: 204.8 + cellH * CGFloat(index / 7), w: 237.6, h: cellH)
            }
        }
    }

    private func monthCell(day: String, items: [CalendarItem], outside: Bool, height: CGFloat, model: CalendarViewModel) -> some View {
        let shown = Array(items.prefix(4))
        return Button {
            Task {
                await model.setMode(.agenda)
                await model.goTo(day)
            }
        } label: {
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(outside ? DesignTokens.Stage.surfaceSoft.opacity(0.4) : Color.clear)
                    .overlay(Rectangle().stroke(DesignTokens.Stage.line.opacity(0.25), lineWidth: 0.5))
                VStack(alignment: .leading, spacing: 10.4) {
                    ForEach(shown, id: \.id) { item in
                        HStack(spacing: 7.2) {
                            Circle().fill(Self.toneColour(Self.tone(of: item, today: model.today))).frame(width: 8.8, height: 8.8)
                            Text(item.entries.count > 1 ? "\(Self.title(of: item)) \u{00B7} \(item.entries.count)\u{00D7}" : Self.title(of: item))
                                .font(TVTheme.font(size: 12.48, css: item.entries.count > 1 ? 680 : 400))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .lineLimit(1)
                        }
                        .frame(height: 15)
                    }
                }
                .padding(.leading, 11.4)
                .padding(.top, 7)
                .padding(.trailing, 8)
                HStack(spacing: 6) {
                    Text(String(Int(day.suffix(2)) ?? 0))
                        .font(TVTheme.font(size: 12.8, css: 640))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                    if items.count > shown.count {
                        Text("+\(items.count - shown.count) more")
                            .font(TVTheme.font(size: 12.48, css: 400))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                    }
                }
                .padding(.leading, 11.8)
                .frame(maxHeight: .infinity, alignment: .bottomLeading)
                .padding(.bottom, 9.4)
            }
            .frame(width: 237.6, height: height)
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 0))
        .focusEffectDisabled()
        .disabled(TVParityLaunch.frozen)
    }

    static func toneColour(_ tone: TVStatusPill.Tone) -> Color {
        switch tone {
        case .available: return DesignTokens.Stage.success
        case .upcoming: return DesignTokens.Stage.brandPink
        case .missing: return DesignTokens.Stage.danger
        case .neutral: return DesignTokens.Stage.inkSoft
        }
    }

    // MARK: Loading and the calendar link

    /// Skeletons keep the final geometry (owner rule): grey day headings and cards for the list views, cells for the month.
    @ViewBuilder
    private func skeleton(_ mode: CalendarViewMode) -> some View {
        let block = DesignTokens.Stage.surfaceSoft
        if mode == .month {
            ForEach(0..<35, id: \.self) { index in
                Rectangle().fill(block.opacity(0.35))
                    .padding(1)
                    .placed(x: 153.6 + 237.6 * CGFloat(index % 7), y: 204.8 + 151.3 * CGFloat(index / 7), w: 237.6, h: 151.3)
            }
        } else {
            ForEach(0..<5, id: \.self) { index in
                RoundedRectangle(cornerRadius: 12).fill(block.opacity(0.5))
                    .placed(x: 783.4, y: 238 + 120.6 * CGFloat(index), w: 1033.4, h: 106.9)
            }
        }
    }

    @ViewBuilder
    private func calendarLink(_ model: CalendarViewModel) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add your releases to Google, Apple or Outlook Calendar with this private link. Anyone with the link can see your releases, so keep it secret.")
                .font(TVTheme.font(size: 12.48, css: 400))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            switch model.feedState {
            case .unknown, .loading:
                Text("Checking subscription\u{2026}").font(TVTheme.font(size: 12.48, css: 400)).foregroundStyle(DesignTokens.Color.textDisabled)
            case .inactive:
                Text("No subscription link").font(TVTheme.font(size: 12.48, css: 640)).foregroundStyle(DesignTokens.Color.textPrimary)
                linkButton("Create subscription link") { Task { await model.createFeed() } }
            case .active:
                Text("Subscription link active").font(TVTheme.font(size: 12.48, css: 640)).foregroundStyle(DesignTokens.Color.textPrimary)
                Text("For security the link is not shown again. Regenerate it to get a new one.")
                    .font(TVTheme.font(size: 12.48, css: 400)).foregroundStyle(DesignTokens.Color.textDisabled)
                    .fixedSize(horizontal: false, vertical: true)
                linkButton("Reset link") { Task { await model.createFeed() } }
                linkButton("Revoke link") { Task { await model.revokeFeed() } }
            case .created(let url):
                Text("Scan to add to your phone's calendar").font(TVTheme.font(size: 12.48, css: 640)).foregroundStyle(DesignTokens.Color.textPrimary)
                TVLocalQRCodeImage(value: url).frame(width: 200, height: 200)
                Text(url).font(TVTheme.mono(size: 10, css: 500)).foregroundStyle(DesignTokens.Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            case .unsupported:
                Text("This server does not offer calendar links.").font(TVTheme.font(size: 12.48, css: 400)).foregroundStyle(DesignTokens.Color.textDisabled)
            case .failed(let message):
                Text(message).font(TVTheme.font(size: 12.48, css: 400)).foregroundStyle(DesignTokens.Color.stateError)
            }
        }
        .frame(width: 268, alignment: .leading)
    }

    private func linkButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(TVTheme.font(size: 12.48, css: 720))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(width: 268, height: 50)
                .background(Capsule().fill(DesignTokens.Color.backgroundElevated))
                .overlay(Capsule().stroke(DesignTokens.Stage.line.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 25))
        .focusEffectDisabled()
    }

    private static func episodeCode(_ entry: CalendarEntry) -> String? {
        guard let season = entry.seasonNumber, let episode = entry.episodeNumber else { return nil }
        return String(format: "S%02dE%02d", season, episode)
    }

    private static func releaseLabel(_ entry: CalendarEntry) -> String {
        switch entry.releaseType {
        case "air": return "Airs"
        case "cinema": return "In cinemas"
        case "digital": return "Digital"
        case "physical": return "Physical"
        default: return "Release"
        }
    }

    private static func kindLabel(_ entry: CalendarEntry) -> String {
        switch entry.mediaKind {
        case "episode": return "Episodes"
        case "movie": return "Movies"
        case "album": return "Albums"
        case "book": return "Books"
        default: return entry.mediaKind.capitalized
        }
    }

    /// Web agenda details panel (`ItemDetails`, stage): kicker, the big title, code and release time, the status pill
    /// and the server's actions.
    private func agendaDetail(_ entry: CalendarEntry, item: CalendarItem, today: String) -> some View {
        let title = Self.title(of: item)
        let lines = max(1, TVTextWrap.lines(title, weight: 560, size: 69.12, kern: -4.98, width: 379.5).count)
        let metaY = 291.5 + 62.2 * CGFloat(lines) + 21.6
        let code = item.entries.count > 1 ? "\(item.entries.count) episodes" : Self.episodeCode(entry)
        let codeLine = [code, item.entries.count > 1 ? nil : (entry.subtitle ?? "TBA")].compactMap { $0 }.joined(separator: " \u{00B7} ")
        let when = entry.releaseAt.map { Self.format($0, "EEEE, d MMMM yyyy 'at' HH:mm") }
            ?? CalendarDays.displayDate(entry.date).map { Self.format($0, "EEEE, d MMMM yyyy") } ?? entry.date
        let soft = DesignTokens.Color.textPrimary.opacity(0.86)
        return ZStack(alignment: .topLeading) {
            Text("\(Self.kindLabel(entry)) \u{00B7} \(Self.releaseLabel(entry))".uppercased())
                .font(TVTheme.font(size: 12.288, css: 860))
                .tracking(0.98)
                .foregroundStyle(DesignTokens.Stage.brandInk)
                .placed(x: 153.6, y: 263.2, w: 455, h: 18.4)
            TVHeroTitle(title: title)
                .placed(x: 153.6, y: 291.5, w: 379.5, h: 62.2 * CGFloat(lines), alignment: .topLeading)
            HStack(spacing: 12.8) {
                Text(codeLine)
                Text(when)
            }
            .font(TVTheme.font(size: 13.056, css: 600))
            .foregroundStyle(soft)
            .placed(x: 153.6, y: metaY, h: 19.6)
            TVStatusPill(tone: Self.tone(of: item, today: today))
                .placed(x: 153.6, y: metaY + 36.9, h: 26.6)
            actionButtons(entry, y: metaY + 36.9 + 26.6 + 23.7)
        }
    }

    /// The server's actions for the entry, rendered as given (`CalendarAction`: enabled, reason, active). A server
    /// without computed actions gets the earlier behaviour: open when the title is in the catalogue, else request
    /// and watchlist.
    private func actionButtons(_ entry: CalendarEntry, y: CGFloat) -> some View {
        var plan: [(label: String, width: CGFloat, primary: Bool, enabled: Bool)] = []
        var hints: [String] = []
        let play = entry.action(.play) ?? entry.action(.resume)
        if let play, play.enabled {
            let resume = play.kind == .resume
            plan.append((resume ? "Resume" : "Play", resume ? 96 : 72, true, true))
        }
        let open = entry.actions.isEmpty ? (entry.workID != nil ? CalendarAction(action: "open") : nil) : entry.action(.open)
        let hasOpen = open?.enabled == true
        if hasOpen {
            let label = entry.mediaKind == "episode" ? "Open series" : "Open"
            plan.append((label, entry.mediaKind == "episode" ? 123.1 : 72, plan.isEmpty, true))
        }
        if !hasOpen, plan.isEmpty { hints.append("This title is not in your catalogue yet.") }
        let request = entry.actions.isEmpty ? (hasOpen ? nil : CalendarAction(action: "request")) : entry.action(.request)
        if let request {
            if request.active {
                plan.append(("Requested", 118, false, false))
            } else {
                plan.append(("Request", 96, plan.isEmpty, request.enabled))
                if !request.enabled, let reason = request.reason { hints.append(reason) }
            }
        }
        let watchlist = entry.actions.isEmpty ? (hasOpen ? nil : CalendarAction(action: "watchlist")) : entry.action(.watchlist)
        if let watchlist {
            if watchlist.enabled {
                plan.append((watchlist.active ? "\u{2212}  Remove from watchlist" : "+  Add to watchlist", watchlist.active ? 215 : 179.3, false, true))
            } else if let reason = watchlist.reason {
                hints.append(reason)
            }
        }
        var x: CGFloat = 153.6
        var placed: [(String, CGFloat, CGFloat, Bool, Bool)] = []
        for item in plan {
            placed.append((item.label, x, item.width, item.primary, item.enabled))
            x += item.width + 9.6
        }
        return ZStack(alignment: .topLeading) {
            ForEach(Array(placed.enumerated()), id: \.offset) { _, item in
                button(item.0, x: item.1, width: item.2, primary: item.3, y: y)
                    .opacity(item.4 ? 1 : 0.5)
            }
            ForEach(Array(hints.enumerated()), id: \.offset) { index, hint in
                Text(hint)
                    .font(TVTheme.font(size: 12.48, css: 400))
                    .foregroundStyle(DesignTokens.Stage.inkMuted)
                    .placed(x: 153.6, y: y + 58 + 14 + CGFloat(index) * 24, w: 570, h: 18.7)
            }
        }
    }

    private func button(_ label: String, x: CGFloat, width: CGFloat, primary: Bool, y: CGFloat) -> some View {
        Text(label)
            .font(TVTheme.font(size: 14.72, css: primary ? 720 : 900))
            .foregroundStyle(primary ? DesignTokens.Stage.onAccent : DesignTokens.Color.textSecondary)
            .frame(width: width, height: 58)
            .background(
                Capsule()
                    .fill(primary ? DesignTokens.Stage.accent : DesignTokens.Color.backgroundElevated)
                    .overlay(Capsule().stroke(DesignTokens.Stage.inkMuted.opacity(primary ? 0 : 0.35), lineWidth: 1))
            )
            .placed(x: x, y: y, w: width, h: 58)
    }

    private static func title(of item: CalendarItem) -> String {
        switch item {
        case .single(let entry): return entry.title
        case .series(_, let title, _, _): return title
        }
    }

    static func format(_ date: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TVParityLaunch.isLive ? TimeZone(identifier: "UTC") : .current
        f.dateFormat = pattern
        return f.string(from: date)
    }

    @ViewBuilder
    private func posterView(_ entry: CalendarEntry?) -> some View {
        ZStack {
            DesignTokens.Color.backgroundRaised
            if let id = entry?.workID {
                TVAuthedImage(load: {
                    try await environment.apiClient.fetchArtwork(workID: id, kind: .poster)
                }) { Color.clear }
            }
        }
    }

    /// A shell action column tile (web `.page-filters-button`): the shared TVHeaderPill as a focusable button.
    private func pill(_ label: String, symbol: String, slot: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TVHeaderPill(label: label, symbol: symbol, width: TVShellActionColumn.width)
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 14))
        .focusEffectDisabled()
        .disabled(TVParityLaunch.frozen)
        .placed(x: TVShellActionColumn.x, y: TVShellActionColumn.y(slot: slot), w: TVShellActionColumn.width, h: TVHeaderPill.height)
    }
}
