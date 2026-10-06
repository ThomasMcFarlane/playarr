import SwiftUI

/// Shared page header: title, optional detail line, trailing actions, and a Filters button with an
/// active-filter count badge. Every page that offers filters uses this one component so the button
/// looks and behaves the same everywhere (Web `PageHeader`, Android `PlayarrPageScaffold`).
struct PlayarrPageHeader<Trailing: View>: View {
    let title: String
    var detail: String?
    var phone: Bool
    var filterCount: Int?
    var onFilters: (() -> Void)?
    private let trailing: Trailing

    init(
        title: String,
        detail: String? = nil,
        phone: Bool,
        filterCount: Int? = nil,
        onFilters: (() -> Void)? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.detail = detail
        self.phone = phone
        self.filterCount = filterCount
        self.onFilters = onFilters
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: phone ? 8 : 14) {
                Text(title)
                    .font(.custom("Avenir Next", fixedSize: phone ? 22 : 32).weight(.medium))
                    .tracking(phone ? -1 : -1.5)
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                trailing
                if let onFilters {
                    PlayarrFiltersButton(count: filterCount ?? 0, action: onFilters)
                }
            }
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.custom("Avenir Next", fixedSize: 12).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineLimit(2)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

extension PlayarrPageHeader where Trailing == EmptyView {
    init(title: String, detail: String? = nil, phone: Bool, filterCount: Int? = nil, onFilters: (() -> Void)? = nil) {
        self.init(title: title, detail: detail, phone: phone, filterCount: filterCount, onFilters: onFilters) {
            EmptyView()
        }
    }
}

/// The one Filters button: same label, size and badge on every page.
struct PlayarrFiltersButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease.circle")
                Text("Filters")
                if count > 0 {
                    Text("\(count)")
                        .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                        .foregroundStyle(PlayarrStyle.onAccent)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(PlayarrStyle.pink, in: Capsule())
                }
            }
            .font(.custom("Avenir Next", fixedSize: 12).weight(.bold))
            .foregroundStyle(PlayarrStyle.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(PlayarrStyle.surfaceStrong.opacity(0.72), in: Capsule())
            .overlay { Capsule().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(count > 0 ? "Filters, \(count) active" : "Filters")
    }
}
