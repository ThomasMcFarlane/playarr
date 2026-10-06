import SwiftUI

/// Building blocks for screens laid out on the web TV grid (1920x1080 stage, CSS pixels
/// measured from the web client's layout). Elements are placed by their CSS box (x, y, w, h);
/// text is centred vertically in its box, as a CSS line box does.
extension View {
    /// Places the view's box at (x, y) inside a top-leading ZStack.
    func placed(
        x: CGFloat,
        y: CGFloat,
        w: CGFloat? = nil,
        h: CGFloat? = nil,
        alignment: Alignment = .leading
    ) -> some View {
        frame(width: w, height: h, alignment: alignment).offset(x: x, y: y)
    }
}

/// Web `.tv-rail-panel` / `.tv-rail-surface`: frosted gradient across the right of the stage.
struct TVRailPanelGradient: View {
    var width: CGFloat

    var body: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.35), location: 0.12),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.55), location: 0.34),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.72), location: 0.62),
                .init(color: DesignTokens.Color.backgroundRaised.opacity(0.78), location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(width: width)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Web page header: round back button, h1 and an optional detail after a hairline divider.
struct TVPageHeader: View {
    var title: String
    var detail: String? = nil
    /// Settings shows the back button focused (white disc, dark arrow).
    var backFocused = false
    /// Gap between the title and the detail text (23 on lists, 47 on detail pages).
    var detailGap: CGFloat = 23
    var showsDivider = true

    var body: some View {
        ZStack(alignment: .topLeading) {
            let size: CGFloat = backFocused ? 52.8 : 50
            let origin: CGFloat = backFocused ? 152.2 : 153.6
            Circle()
                .fill(backFocused ? DesignTokens.Color.textPrimary : DesignTokens.Color.backgroundElevated.opacity(0.7))
                .overlay(
                    Circle().stroke(
                        DesignTokens.Color.borderDefault.opacity(backFocused ? 0 : 0.35),
                        lineWidth: 1
                    )
                )
                .overlay(
                    Text("\u{2190}")
                        .font(TVTheme.font(size: 17.3, weight: .semibold))
                        .foregroundStyle(backFocused ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textSecondary)
                )
                .placed(x: origin, y: backFocused ? 54.8 : 56.2, w: size, h: size)
            HStack(spacing: 0) {
                Text(title)
                    .font(TVTheme.font(size: 33.6, weight: .medium))
                    .tracking(-1.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .fixedSize()
                if let detail {
                    if showsDivider {
                        Rectangle()
                            .fill(DesignTokens.Color.borderDefault.opacity(0.55))
                            .frame(width: 1, height: 14)
                            .padding(.horizontal, (detailGap - 1) / 2)
                    } else {
                        Spacer().frame(width: detailGap)
                    }
                    Text(detail.uppercased())
                        .font(TVTheme.font(size: 11.1, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .fixedSize()
                }
            }
            .placed(x: 226.6, y: 56.2, h: 50.4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Loads artwork that needs the signed-in session (chapter and episode stills) and shows it
/// `scaledToFill`; `placeholder` shows while loading or when the server has no frame.
struct TVAuthedImage<Placeholder: View>: View {
    let load: () async throws -> Data
    @ViewBuilder var placeholder: () -> Placeholder
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder()
            }
        }
        .task {
            if let data = try? await load(), let decoded = UIImage(data: data) {
                image = decoded
            }
        }
    }
}

/// Greedy word wrap using the real font metrics, so multi-line titles break where the web's do.
enum TVTextWrap {
    static func lines(_ text: String, fontName: String, size: CGFloat, kern: CGFloat, width: CGFloat) -> [String] {
        guard let font = UIFont(name: fontName, size: size) else { return [text] }
        func measure(_ value: String) -> CGFloat {
            (value as NSString).size(withAttributes: [.font: font, .kern: kern]).width
        }
        var lines: [String] = []
        var current = ""
        for word in text.split(separator: " ").map(String.init) {
            let candidate = current.isEmpty ? word : current + " " + word
            if measure(candidate) > width, !current.isEmpty {
                lines.append(current)
                current = word
            } else {
                current = candidate
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines.isEmpty ? [text] : lines
    }
}

/// Date and runtime strings as the web client shows them (en-GB, `1 Jun 2020`, `1 min`, `1h 44m`).
enum TVWebFormat {
    static func date(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_GB")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: String(iso.prefix(10))) else { return nil }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_GB")
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "d MMM yyyy"
        return out.string(from: date)
    }

    static func year(_ iso: String?) -> String? {
        guard let iso, iso.count >= 4 else { return nil }
        return String(iso.prefix(4))
    }

    static func runtime(ms: Int64?) -> String? {
        guard let ms, ms > 0 else { return nil }
        let minutes = max(1, Int((Double(ms) / 60_000).rounded()))
        let hours = minutes / 60
        let rest = minutes % 60
        if hours <= 0 { return "\(minutes) min" }
        return rest > 0 ? "\(hours)h \(rest)m" : "\(hours)h"
    }

    static func clock(ms: Int64) -> String {
        let total = Int(ms / 1000)
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }
}
