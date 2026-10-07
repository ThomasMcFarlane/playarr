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
            await model.setMode(.month)
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
            Text(model.windowTitle)
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
                monthGrid(model)
            }
        }
    }

    /// Web `.calendar-view-month`: weekday labels at y 236, a 7 x N grid of 241.4 x 138.9 cells from y 266.8.
    private func monthGrid(_ model: CalendarViewModel) -> some View {
        let groups = model.dayGroups
        let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        let anchorMonth = String(model.anchor.prefix(7))
        return ZStack(alignment: .topLeading) {
            ForEach(Array(weekdays.enumerated()), id: \.offset) { index, name in
                Text(name.uppercased())
                    .font(TVTheme.font(size: 12, css: 400))
                    .tracking(0.96)
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: 153.6 + CGFloat(index) * 241.4, y: 236, w: 241.4, h: 30.8, alignment: .center)
            }
            ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                let col = CGFloat(index % 7)
                let row = CGFloat(index / 7)
                let x = 153.6 + col * 241.4
                let y = 266.8 + row * 138.9
                let outside = !group.day.hasPrefix(anchorMonth)
                let isToday = group.day == model.today
                ZStack(alignment: .topLeading) {
                    Rectangle()
                        .fill(outside ? DesignTokens.Color.backgroundRaised.opacity(0.4) : Color.clear)
                        .overlay(Rectangle().stroke(DesignTokens.Color.borderDefault.opacity(0.25), lineWidth: 1))
                        .frame(width: 241.4, height: 138.9)
                    if isToday {
                        Rectangle()
                            .stroke(DesignTokens.Color.textPrimary, lineWidth: 2.5)
                            .frame(width: 241.4, height: 138.9)
                    }
                    Text(String(Int(group.day.suffix(2)) ?? 0))
                        .font(TVTheme.font(size: 12.8, css: 640))
                        .foregroundStyle(outside ? DesignTokens.Color.textDisabled : DesignTokens.Color.textPrimary)
                        .placed(x: 5.8, y: 5.8, w: 229.8, h: 19.2)
                    ForEach(Array(group.items.prefix(3).enumerated()), id: \.offset) { itemIndex, item in
                        Text(Self.title(of: item))
                            .font(TVTheme.font(size: 12, css: 400))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .lineLimit(1)
                            .padding(.leading, 9)
                            .frame(width: 229.8, height: 24, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(DesignTokens.Color.backgroundRaised)
                            )
                            .overlay(alignment: .leading) {
                                Rectangle().fill(Color(red: 0.36, green: 0.52, blue: 0.9)).frame(width: 3)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                            .placed(x: 5.8, y: 32.1 + CGFloat(itemIndex) * 28, w: 229.8, h: 24)
                    }
                }
                .frame(width: 241.4, height: 138.9, alignment: .topLeading)
                .placed(x: x, y: y, w: 241.4, h: 138.9, alignment: .topLeading)
            }
        }
    }

    private func agenda(_ model: CalendarViewModel) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                ForEach(model.dayGroups, id: \.day) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(group.day)
                            .font(TVTheme.font(size: 17.66, weight: .semibold))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                        ForEach(group.items, id: \.id) { item in
                            Text(Self.title(of: item))
                                .font(TVTheme.font(size: 15, weight: .regular))
                                .foregroundStyle(DesignTokens.Color.textSecondary)
                        }
                    }
                }
            }
            .padding(.bottom, 80)
        }
        .frame(width: 1500, height: 780, alignment: .topLeading)
        .placed(x: 153.6, y: 260, w: 1500, h: 780, alignment: .topLeading)
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
                .overlay(Circle().stroke(DesignTokens.Color.borderDefault.opacity(0.35), lineWidth: 1))
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
                .overlay(Capsule().stroke(DesignTokens.Color.borderDefault.opacity(0.35), lineWidth: 1))
        )
        .placed(x: x, y: 56.2, w: width, h: 50)
    }
}
