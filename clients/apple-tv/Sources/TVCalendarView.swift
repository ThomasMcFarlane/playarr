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
        roundControl("\u{2190}", x: 1357.8, y: 56.2, size: 50) { Task { await model.step(-1) } }
        todayControl(x: 1413.4, y: 54.8) { Task { await model.goToToday() } }
        roundControl("\u{2192}", x: 1511.3, y: 56.2, size: 50) { Task { await model.step(1) } }
        pill("Calendar link", symbol: "bell", x: 1586.3, width: 151.6)
        pill("Filters", symbol: "line.3.horizontal.decrease", x: 1737.9, width: 105.3)

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
                agenda(model)
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
                .frame(width: 92.3, height: 52.8)
                .background(Capsule().fill(DesignTokens.Color.backgroundElevated))
                // Web: the Today control holds focus on load (white ring).
                .overlay(Capsule().stroke(DesignTokens.Color.textPrimary, lineWidth: 2.5))
        }
        .buttonStyle(.plain)
        .focusable(!TVParityLaunch.frozen)
        .focusEffectDisabled(TVParityLaunch.frozen)
        .placed(x: x, y: y, w: 92.3, h: 52.8)
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
