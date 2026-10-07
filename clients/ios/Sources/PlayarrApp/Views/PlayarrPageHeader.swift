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
                    PlayarrFiltersButton(count: filterCount ?? 0, iconOnly: phone, action: onFilters)
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
    var iconOnly = false
    let action: () -> Void

    var body: some View {
        PlayarrHeaderPill(
            label: "Filters",
            systemImage: "line.3.horizontal.decrease.circle",
            count: count,
            iconOnly: iconOnly,
            accessibilityLabel: count > 0 ? "Filters, \(count) active" : "Filters",
            action: action
        )
    }
}

/// The one header action tile, the web's `.page-filters-button` (the 30 September library Filters launcher): a
/// 14 pt-radius tile with the glyph above a small bold label, at least 62 x 72 pt (44 x 44 pt, icon only, on
/// phones). Filters and the Calendar link are both drawn by this view, so the calendar's header buttons always
/// match the Filters button. Focus draws the ring, never a fill.
struct PlayarrHeaderPill: View {
    let label: String
    let systemImage: String
    var count: Int = 0
    var iconOnly = false
    var accessibilityLabel: String?
    let action: () -> Void

    @Environment(\.isFocused) private var isFocused

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5.6) {
                Image(systemName: systemImage)
                    .font(.system(size: iconOnly ? 18 : 22, weight: .regular))
                if !iconOnly {
                    Text(label)
                        .font(.custom("Avenir Next", fixedSize: 8.3).weight(.bold))
                        .tracking(0.17)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isFocused ? PlayarrStyle.ink : PlayarrStyle.muted)
            .padding(.horizontal, 4)
            .frame(minWidth: iconOnly ? 44 : 62, minHeight: iconOnly ? 44 : 72)
            .background(PlayarrStyle.surfaceStrong.opacity(0.78), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PlayarrStyle.lineStrong.opacity(0.68), lineWidth: 1)
            }
            .overlay {
                if isFocused {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PlayarrStyle.ink, lineWidth: 3).padding(-3.5)
                }
            }
            .scaleEffect(isFocused ? 1.06 : 1)
            .overlay(alignment: .topTrailing) {
                if count > 0 {
                    Text("\(count)")
                        .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                        .foregroundStyle(PlayarrStyle.onAccent)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(PlayarrStyle.pink, in: Capsule())
                        .offset(x: 6, y: -6)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel ?? label)
    }
}
