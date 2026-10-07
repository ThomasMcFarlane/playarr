import PlayarrKit
import SwiftUI

/// Release Calendar on the web TV grid: header with period controls, the month button and the
/// agenda for the window. All filtering and grouping comes from `CalendarViewModel` (shared with iOS).
struct TVCalendarView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var viewModel: CalendarViewModel?

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
            // Parity captures freeze the clock (the web reference does the same).
            let model = CalendarViewModel(
                transport: environment.apiClient,
                zone: TimeZone(identifier: "UTC") ?? .current,
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
        TVPageHeader(title: "Release Calendar")

        // Period controls: previous, Today (focused ring), next, Calendar link, Filters.
        roundControl("\u{2190}", x: 1367.4, y: 56.2, size: 50) { Task { await model.step(-1) } }
        todayControl(x: 1423.1, y: 54.8) { Task { await model.goToToday() } }
        roundControl("\u{2192}", x: 1516.5, y: 56.2, size: 50) { Task { await model.step(1) } }
        pill("Calendar link", symbol: "bell", x: 1591.5, width: 147.5)
        pill("Filters", symbol: "line.3.horizontal.decrease", x: 1739, width: 104.2)

        // Month button.
        HStack(spacing: 0) {
            Text(Self.rangeTitle(model))
                .font(TVTheme.font(size: 24, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text("\u{25BE}")
                .font(TVTheme.font(size: 14.72, weight: .bold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(.leading, 10)
        }
        .placed(x: 174.6, y: 162, h: 62)

        switch model.loadState {
        case .loading:
            ProgressView().tint(DesignTokens.Color.brandPrimary).placed(x: 153.6, y: 260)
        case .failed(let message):
            Text(message)
                .font(TVTheme.font(size: 19.2, weight: .regular))
                .foregroundStyle(DesignTokens.Color.stateError)
                .placed(x: 153.6, y: 260, w: 900)
        case .loaded:
            if model.filteredEntries.isEmpty {
                Text("Nothing scheduled")
                    .font(TVTheme.font(size: 22.4, weight: .bold))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .placed(x: 153.6, y: 260, w: 600, h: 33.6)
                Text("No releases from your connected sources fall in this period.")
                    .font(TVTheme.font(size: 19.2, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: 153.6, y: 303.2, w: 1100, h: 28.8)
            } else {
                agendaView(model)
            }
        }
    }

    /// "7 Oct \u{2013} 5 Nov 2026": the agenda window.
    private static func rangeTitle(_ model: CalendarViewModel) -> String {
        guard let start = CalendarDays.displayDate(model.window.start),
              let end = CalendarDays.displayDate(model.window.end) else { return model.windowTitle }
        let short = DateFormatter()
        short.locale = Locale(identifier: "en_GB")
        short.timeZone = TimeZone(identifier: "UTC")
        short.dateFormat = "d MMM"
        let long = DateFormatter()
        long.locale = Locale(identifier: "en_GB")
        long.timeZone = TimeZone(identifier: "UTC")
        long.dateFormat = "d MMM yyyy"
        return "\(short.string(from: start)) \u{2013} \(long.string(from: end))"
    }

    private static func format(_ date: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = pattern
        return f.string(from: date)
    }

    private static func entries(of item: CalendarItem) -> [CalendarEntry] { item.entries }

    /// Web TV `.calendar-view-agenda`: the selected release on the left, the days with their releases on the right.
    @ViewBuilder
    private func agendaView(_ model: CalendarViewModel) -> some View {
        let groups = model.dayGroups.filter { !$0.items.isEmpty }
        let selectedItem = model.selectedItem ?? groups.first?.items.first
        if let selectedItem, let entry = Self.entries(of: selectedItem).first {
            agendaDetail(entry, title: Self.title(of: selectedItem))
        }
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(groups, id: \.day) { group in
                    VStack(alignment: .leading, spacing: 6.4) {
                        Text(Self.dayHeading(group.day))
                            .font(TVTheme.font(size: 18.4, css: 640))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .frame(height: 27.6, alignment: .leading)
                        ForEach(group.items, id: \.id) { item in
                            agendaCard(item, selected: item.id == selectedItem?.id)
                        }
                    }
                }
            }
            .padding(.bottom, 80)
        }
        .frame(width: 1060, height: 800, alignment: .topLeading)
        .placed(x: 786.4, y: 240, w: 1060, h: 800, alignment: .topLeading)
    }

    private static func dayHeading(_ day: String) -> String {
        guard let date = CalendarDays.displayDate(day) else { return day }
        return format(date, "EEEE d MMMM")
    }

    private func agendaCard(_ item: CalendarItem, selected: Bool) -> some View {
        let entry = Self.entries(of: item).first
        let code = entry.flatMap { Self.episodeCode($0) }
        let subtitle = [code, entry?.subtitle].compactMap { $0 }.joined(separator: " \u{00B7} ")
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(DesignTokens.Color.backgroundInputDisabled)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(selected ? DesignTokens.Color.textPrimary : DesignTokens.Stage.inkMuted.opacity(0.2), lineWidth: selected ? 3 : 1)
                )
                .frame(width: 1048.8, height: 99.6)
            posterView(entry)
                .frame(width: 40, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .placed(x: 16, y: 19.8, w: 40, h: 60)
            Text(Self.title(of: item))
                .font(TVTheme.font(size: 19.2, css: 640))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
                .placed(x: 70.4, y: 9, w: 900, h: 28.8)
            Text(subtitle)
                .font(TVTheme.font(size: 19.2, css: 400))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .lineLimit(1)
                .placed(x: 70.4, y: 40.2, w: 900, h: 28.8)
            HStack(spacing: 12) {
                if let at = entry?.releaseAt {
                    Text(Self.format(at, "HH:mm"))
                }
                Text(entry.map { Self.releaseLabel($0) } ?? "")
                Text(entry.map { Self.kindLabel($0) } ?? "")
                if entry?.monitored == true {
                    Text("Monitored")
                        .font(TVTheme.font(size: 12.8, css: 640))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(.horizontal, 10)
                        .frame(height: 19.2)
                        .background(Capsule().fill(Color(red: 0.357, green: 0.498, blue: 0.82).opacity(0.24)))
                }
            }
            .font(TVTheme.font(size: 12.8, css: 400))
            .foregroundStyle(DesignTokens.Color.textDisabled)
            .placed(x: 70.4, y: 71.4, h: 19.2)
        }
        .frame(width: 1048.8, height: 99.6, alignment: .topLeading)
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

    private func agendaDetail(_ entry: CalendarEntry, title: String) -> some View {
        let code = Self.episodeCode(entry)
        let subtitle = [code, entry.subtitle].compactMap { $0 }.joined(separator: " \u{00B7} ")
        return ZStack(alignment: .topLeading) {
            Text("\(Self.kindLabel(entry)) \u{00B7} \(Self.releaseLabel(entry))".uppercased())
                .font(TVTheme.font(size: 11.84, css: 760))
                .tracking(2.13)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 153.6, y: 240, w: 500, h: 17.8)
            Text(title)
                .font(TVTheme.font(size: 38.4, css: 590))
                .tracking(-1.536)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(2)
                .placed(x: 153.6, y: 272.2, w: 570, h: 57.6)
            Text(subtitle)
                .font(TVTheme.font(size: 19.2, css: 400))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .placed(x: 153.6, y: 344.2, w: 570, h: 28.8)
            detailLabel("Release", y: 387.3)
            Text(entry.releaseAt.map { Self.format($0, "EEEE, d MMMM yyyy 'at' HH:mm") } ?? CalendarDays.displayDate(entry.date).map { Self.format($0, "EEEE, d MMMM yyyy") } ?? entry.date)
                .font(TVTheme.font(size: 19.2, css: 400))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .placed(x: 153.6, y: 405.6, w: 570, h: 26)
            detailLabel("Status", y: 443)
            if entry.monitored {
                Text("Monitored")
                    .font(TVTheme.font(size: 19.2, css: 640))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .padding(.horizontal, 12)
                    .frame(height: 26)
                    .background(Capsule().fill(Color(red: 0.357, green: 0.498, blue: 0.82).opacity(0.24)))
                    .placed(x: 153.6, y: 461.3, h: 26)
            }
            detailLabel("Reported by", y: 498.7)
            if let source = entry.sources.first {
                HStack(spacing: 8) {
                    Text(source.sourceName)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                    Text("(\(source.sourceKind))")
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                }
                .font(TVTheme.font(size: 19.2, css: 400))
                .placed(x: 153.6, y: 515.9, h: 28.8)
            }
            actionButtons(entry)
        }
    }

    private func detailLabel(_ text: String, y: CGFloat) -> some View {
        Text(text.uppercased())
            .font(TVTheme.font(size: 11.52, css: 400))
            .tracking(1.152)
            .foregroundStyle(DesignTokens.Color.textDisabled)
            .placed(x: 153.6, y: y, w: 571, h: 17.3)
    }

    private func actionButtons(_ entry: CalendarEntry) -> some View {
        let y: CGFloat = 559.1
        let openX: CGFloat = entry.hasFile ? 153.6 + 84 : 153.6
        return ZStack(alignment: .topLeading) {
            if entry.hasFile {
                button("Play", x: 153.6, width: 72, primary: true, y: y)
            }
            button("Open series", x: openX, width: 123.1, primary: !entry.hasFile, y: y)
            button("+  Add to watchlist", x: openX + 132.7, width: 179.3, primary: false, y: y)
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

    private func roundControl(_ glyph: String, x: CGFloat, y: CGFloat, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph)
                .font(TVTheme.font(size: 14.72, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(width: size, height: size)
                .background(Circle().fill(DesignTokens.Color.backgroundElevated))
                .overlay(Circle().stroke(DesignTokens.Stage.inkMuted.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .focusable(!TVParityLaunch.frozen)
        .focusEffectDisabled(TVParityLaunch.frozen)
        .placed(x: x, y: y, w: size, h: size)
    }

    private func todayControl(x: CGFloat, y: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("Today")
                .font(TVTheme.font(size: 14.72, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(width: 87.8, height: 52.8)
                .background(Capsule().fill(DesignTokens.Color.backgroundElevated))
                // Web: the Today control holds focus on load (white ring).
                .overlay(Capsule().stroke(DesignTokens.Color.textPrimary, lineWidth: 2.5))
        }
        .buttonStyle(.plain)
        .focusable(!TVParityLaunch.frozen)
        .focusEffectDisabled(TVParityLaunch.frozen)
        .placed(x: x, y: y, w: 87.8, h: 52.8)
    }

    private func pill(_ label: String, symbol: String, x: CGFloat, width: CGFloat) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .regular))
            Text(label)
                .font(TVTheme.font(size: 13.44, weight: .semibold))
        }
        .foregroundStyle(DesignTokens.Color.textSecondary)
        .frame(width: width, height: 50)
        .background(
            Capsule()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.7))
                .overlay(Capsule().stroke(DesignTokens.Stage.inkMuted.opacity(0.35), lineWidth: 1))
        )
        .placed(x: x, y: 56.2, w: width, h: 50)
    }
}
