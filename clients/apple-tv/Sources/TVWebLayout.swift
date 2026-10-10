import PlayarrKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

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

    /// `placed` with real layout (padding, not an offset): the focus engine sees the view where it is drawn. Use it for
    /// focusable controls and the containers that hold them.
    func pinned(
        x: CGFloat,
        y: CGFloat,
        w: CGFloat? = nil,
        h: CGFloat? = nil,
        alignment: Alignment = .leading
    ) -> some View {
        frame(width: w, height: h, alignment: alignment)
            .padding(.leading, x)
            .padding(.top, y)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Web `.tv-rail-panel` / `.tv-rail-surface`: frosted gradient across the right of the stage.
/// Light follows the CSS (`--tv-rail-frost` is 48% surface-soft over surface-strong, alphas 68/88/96/100);
/// dark keeps the calibrated soft-surface ramp.
struct TVRailPanelGradient: View {
    var width: CGFloat
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LinearGradient(stops: stops, startPoint: .leading, endPoint: .trailing)
            .frame(width: width)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var stops: [Gradient.Stop] {
        if scheme == .light {
            let frost = Color(red: 239.6 / 255, green: 238.2 / 255, blue: 238.7 / 255)
            return [
                .init(color: frost.opacity(0), location: 0),
                .init(color: frost.opacity(0.68), location: 0.12),
                .init(color: frost.opacity(0.88), location: 0.34),
                .init(color: frost.opacity(0.96), location: 0.62),
                .init(color: frost, location: 1),
            ]
        }
        return [
            .init(color: DesignTokens.Color.backgroundRaised.opacity(0), location: 0),
            .init(color: DesignTokens.Color.backgroundRaised.opacity(0.35), location: 0.12),
            .init(color: DesignTokens.Color.backgroundRaised.opacity(0.55), location: 0.34),
            .init(color: DesignTokens.Color.backgroundRaised.opacity(0.72), location: 0.62),
            .init(color: DesignTokens.Color.backgroundRaised.opacity(0.78), location: 1),
        ]
    }
}

/// Web `.tv-key-art img` filter: dark `grayscale contrast(.82) brightness(.6)` at 0.72, light
/// `grayscale contrast(.88) brightness(1.1)` at 0.4.
struct TVKeyArtFilter: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        if scheme == .light {
            content
                .saturation(0)
                .contrast(0.88)
                .opacity(0.4)
        } else {
            content
                .saturation(0)
                .contrast(DesignTokens.Shell.keyArtContrast)
                .colorMultiply(Color(white: DesignTokens.Shell.keyArtBrightness))
                .opacity(DesignTokens.Shell.keyArtOpacity)
        }
    }
}

/// Web page header: round back button, h1 and an optional detail after a hairline divider.
struct TVPageHeader: View {
    var title: String
    /// The web `.page-subtitle`: the one small subtitle style, under the title (never beside it).
    var detail: String? = nil
    /// Settings shows the back button focused (white disc, dark arrow).
    var backFocused = false

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
            Text(title)
                .font(TVTheme.font(size: 33.6, css: 580))
                .tracking(-1.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .fixedSize()
                .placed(x: 226.6, y: 56.2, h: 50)
            if let detail {
                Text(detail.uppercased())
                    .font(TVTheme.font(size: 12.29, css: 820))
                    .tracking(0.98)
                    .foregroundStyle(DesignTokens.Stage.brandInk)
                    .lineLimit(1)
                    .fixedSize()
                    .placed(x: 226.6, y: 111.8, h: 18.4)
            }
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
                Image(uiImage: image).resizable().interpolation(.high).scaledToFill()
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
    static func lines(_ text: String, weight: CGFloat, size: CGFloat, kern: CGFloat, width: CGFloat) -> [String] {
        let font = TVFontLoader.uiFont(mono: false, size: size, weight: weight)
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

/// Web `.app-user-identity`: avatar and name in a pill at (58.5, 997.3), version in monospace below.
struct TVWebProfileChip: View {
    var name: String
    var version: String
    var userID: String = ""
    var presetName: String? = nil
    var customAvatar: UIImage? = nil

    /// Width of the name at 11.14px / 690 with 0.22px tracking (the capsule grows with it).
    private var nameWidth: CGFloat {
        let font = TVFontLoader.uiFont(mono: false, size: 11.14, weight: 690)
        return ceil((name as NSString).size(withAttributes: [.font: font, .kern: 0.22]).width)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Capsule()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.66))
                .overlay(Capsule().stroke(DesignTokens.Color.borderDefault.opacity(0.35), lineWidth: 1))
                .placed(x: 58.5, y: 997.3, w: 64.9 + nameWidth, h: 48.2)
            TVProfileAvatar(userID: userID, size: 34, presetName: presetName, customImage: customAvatar)
                .placed(x: 65.6, y: 1004.4, w: 34, h: 34)
            Text(name)
                .font(TVTheme.font(size: 11.14, css: 690))
                .tracking(0.22)
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .lineLimit(1)
                .fixedSize()
                .placed(x: 110, y: 1013, w: nameWidth, h: 16.7)
            Text(version)
                .font(TVTheme.mono(size: 8, css: 700))
                .tracking(0.32)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 66.3, y: 1050.5, h: 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/// Web `.tv-key-art`: the 1038 x 1190 picture at (-20, -23), filtered, fading out to the right,
/// plus its `::after` wash (surface from the left and bottom edges).
struct TVKeyArt: View {
    var url: URL?

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Color.clear
                    }
                }
                .frame(width: 1038.3, height: 1190.6)
                .clipped()
                .modifier(TVKeyArtFilter())
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: DesignTokens.Shell.keyArtMaskSolidEnd),
                            .init(color: .clear, location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .offset(x: -20, y: -22.9)
            }
            keyArtAfter.frame(width: 1920, height: 1080)
        }
        // The picture is taller than the stage: pin the layout to the stage so nothing shifts.
        .frame(width: 1920, height: 1080, alignment: .topLeading)
        .clipped()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var keyArtAfter: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated, location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.22),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated, location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.22),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.82),
                    .init(color: DesignTokens.Color.backgroundElevated, location: 1),
                ],
                startPoint: .bottom,
                endPoint: .top
            )
        }
        .allowsHitTesting(false)
    }
}

/// Web `.tv-stage-wash`: the surface colour washing in from the left and, lighter, from the right.
struct TVStageWash: View {
    var body: some View {
        ZStack {
            LinearGradient(
                stops: [
                    // Web `.tv-stage-wash`: surface 94% at 0, 90% at 36%, clear at 52%.
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.94), location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.90), location: 0.36),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.52),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.50), location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.34),
                ],
                startPoint: .trailing,
                endPoint: .leading
            )
        }
        .allowsHitTesting(false)
    }
}

/// The big title of Home, Library and detail: wraps at 379.5 like the web and keeps 62.2px lines.
struct TVHeroTitle: View {
    var title: String
    var cssWeight: CGFloat = 560

    var body: some View {
        let lines = TVTextWrap.lines(title, weight: cssWeight, size: 69.12, kern: -4.98, width: 379.5)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(TVTheme.font(size: 69.12, css: cssWeight))
                    .tracking(-4.98)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(width: 379.5, height: 62.2, alignment: .leading)
            }
        }
    }
}

/// Chrome shows a decoded video frame through its own colour conversion; the server's JPEG frame is
/// converted differently (a BT.601 against BT.709 luma split that moves only the green channel).
/// This applies the fitted correction so the parity route's picture matches what the browser shows.
enum TVVideoFrameColour {
    static func matchingBrowser(_ data: Data) -> Data {
        guard let image = CIImage(data: data) else { return data }
        let filter = CIFilter.colorMatrix()
        filter.inputImage = image
        filter.rVector = CIVector(x: 1, y: 0, z: 0, w: 0)
        filter.gVector = CIVector(x: 0.094, y: 0.847, z: 0.055, w: 0)
        filter.bVector = CIVector(x: 0, y: 0, z: 1, w: 0)
        filter.aVector = CIVector(x: 0, y: 0, z: 0, w: 1)
        // No colour management: the matrix is fitted on gamma-encoded values.
        let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
        guard let output = filter.outputImage,
              let cg = context.createCGImage(output, from: output.extent) else { return data }
        return UIImage(cgImage: cg).pngData() ?? data
    }
}


/// Web control focus (`--page-focus-ring`): a 3 px ring 2 px outside the control, never a fill. Buttons, pills, tiles.
struct TVRingButtonStyle: ButtonStyle {
    var cornerRadius: CGFloat = 14

    func makeBody(configuration: Configuration) -> some View {
        Ring(label: configuration.label, cornerRadius: cornerRadius)
    }

    private struct Ring<Label: View>: View {
        let label: Label
        let cornerRadius: CGFloat
        @Environment(\.isFocused) private var isFocused

        var body: some View {
            label.overlay(
                RoundedRectangle(cornerRadius: cornerRadius + 5, style: .continuous)
                    .stroke(DesignTokens.Stage.focusRing, lineWidth: 3)
                    .padding(-5)
                    .opacity(isFocused ? 1 : 0)
            )
        }
    }
}

/// A shell action column tile (Filters, Calendar link) that opens its side panel.
struct TVActionTile: View {
    let label: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            TVHeaderPill(label: label, symbol: symbol, width: TVShellActionColumn.width)
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 14))
        .focusEffectDisabled()
    }
}

/// The one shared right-side panel (web `.tv-filter-drawer`): 360 wide, full height from the first frame, kicker,
/// title and close button, then the page's sections. Menu closes it; focus stays inside while it is open.
struct TVDrawer<Content: View>: View {
    let kicker: String
    let title: String
    let onClose: () -> Void
    @ViewBuilder var content: () -> Content
    /// Focus moves into the drawer when it opens (web: the panel takes focus; Back closes it).
    @FocusState private var closeFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 3.2) {
                    Text(kicker.uppercased())
                        .font(TVTheme.font(size: 9.6, css: 720))
                        .tracking(0.672)
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .frame(height: 14.4)
                    Text(title)
                        .font(TVTheme.font(size: 38.4, css: 590))
                        .tracking(-2.1)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(2)
                        .frame(width: 204, alignment: .leading)
                }
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Text("\u{00D7}")
                        .font(TVTheme.font(size: 26.88, css: 720))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .frame(width: 48, height: 50)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DesignTokens.Stage.surfaceSoft))
                }
                .buttonStyle(TVRingButtonStyle(cornerRadius: 14))
                .focusEffectDisabled()
                .focused($closeFocused)
                .accessibilityLabel("Close")
            }
            .padding(.top, 54)
            content()
                .padding(.top, 34)
            Spacer(minLength: 0)
        }
        .padding(.leading, 46)
        .padding(.trailing, 46)
        .frame(width: 360, height: 1080, alignment: .topLeading)
        .background(DesignTokens.Stage.surfaceStrong.opacity(0.94))
        .focusSection()
        .onExitCommand(perform: onClose)
        .task { closeFocused = true }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .ignoresSafeArea()
    }
}

/// A drawer section (web `FilterSection` with the shared choice control): label, then one button per option.
struct TVChoiceSection<Value: Hashable>: View {
    let title: String
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        VStack(alignment: .leading, spacing: 11.9) {
            Text(title.uppercased())
                .font(TVTheme.font(size: 9.6, css: 720))
                .tracking(0.672)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(height: 14.4)
            HStack(spacing: 8) {
                ForEach(options, id: \.value) { option in
                    let active = option.value == selection
                    Button { selection = option.value } label: {
                        Text(option.label)
                            .font(TVTheme.font(size: 10.56, css: 680))
                            .foregroundStyle(active ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textDisabled)
                            .frame(width: (268 - 8 * CGFloat(options.count - 1)) / CGFloat(options.count), height: 56)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(active ? DesignTokens.Color.textPrimary : DesignTokens.Stage.surfaceSoft.opacity(0.64))
                            )
                            .scaleEffect(active ? 1.025 : 1)
                    }
                    .buttonStyle(TVRingButtonStyle(cornerRadius: 12))
                    .focusEffectDisabled()
                }
            }
        }
        .padding(.bottom, 30.3)
    }
}


/// Web media actions (`MediaContextMenu`): a long press (650 ms) on a media card opens its actions in the shared drawer.
struct TVOpenActionsKey: EnvironmentKey {
    static let defaultValue: (Work) -> Void = { _ in }
}

extension EnvironmentValues {
    var openActions: (Work) -> Void {
        get { self[TVOpenActionsKey.self] }
        set { self[TVOpenActionsKey.self] = newValue }
    }
}

/// A pushed page of the stage (shell navigation path).
enum TVRoute: Hashable {
    case work(Work)
    case playlist(id: UUID, name: String)
}

/// The title whose actions drawer is open (nil when closed): its card takes focus back when the drawer closes.
struct TVActionsWorkIDKey: EnvironmentKey {
    static let defaultValue: UUID? = nil
}

extension EnvironmentValues {
    var actionsWorkID: UUID? {
        get { self[TVActionsWorkIDKey.self] }
        set { self[TVActionsWorkIDKey.self] = newValue }
    }
}

struct TVOpenRouteKey: EnvironmentKey {
    static let defaultValue: (TVRoute) -> Void = { _ in }
}

extension EnvironmentValues {
    var openRoute: (TVRoute) -> Void {
        get { self[TVOpenRouteKey.self] }
        set { self[TVOpenRouteKey.self] = newValue }
    }
}

/// A media card's button: Select opens the title; holding Select for 650 ms opens its actions instead (web long
/// press), and the release that follows does not also open the title.
struct TVCardButton<Label: View>: View {
    let work: Work
    var route: TVRoute? = nil
    @ViewBuilder var label: () -> Label
    @Environment(\.openActions) private var openActions
    @Environment(\.openRoute) private var openRoute
    @Environment(\.actionsWorkID) private var actionsWorkID
    @State private var longPressed = false
    @FocusState private var focused: Bool

    var body: some View {
        Button {
            if longPressed { longPressed = false } else { openRoute(route ?? .work(work)) }
        } label: {
            label()
        }
        .focused($focused)
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.65).onEnded { _ in
            longPressed = true
            openActions(work)
        })
        // Web: closing the actions drawer returns focus to the card that opened it.
        .onChange(of: actionsWorkID) { previous, current in
            if previous == work.id, current == nil { focused = true }
        }
    }
}

/// One action row (web `.media-context-actions` button): 268 x 68, brand glyph and a bold label, control focus ring.
struct TVActionRow: View {
    let glyph: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Text(glyph)
                    .font(TVTheme.font(size: 19.52, css: 400))
                    .foregroundStyle(DesignTokens.Stage.brandPink)
                    .frame(width: 42, alignment: .leading)
                Text(label)
                    .font(TVTheme.font(size: 19.2, css: 700))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.leading, 18)
            .frame(width: 268, height: 68)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DesignTokens.Stage.surfaceSoft))
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 14))
        .focusEffectDisabled()
    }
}


/// Web `MultiSelect` in a drawer section: the field shows "Any language" or the chosen names; Select opens the
/// options (name and title count), each toggles; any chosen code matches.
struct TVMultiSelectSection: View {
    let title: String
    let facets: [LanguageFacet]?
    let loaded: Bool
    @Binding var selection: [String]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 11.9) {
            Text(title.uppercased())
                .font(TVTheme.font(size: 9.6, css: 720))
                .tracking(0.672)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(height: 14.4)
            if !loaded {
                RoundedRectangle(cornerRadius: 12).fill(DesignTokens.Stage.surfaceSoft.opacity(0.5)).frame(width: 268, height: 58.8)
            } else if (facets ?? []).isEmpty, selection.isEmpty {
                Text("No languages to filter by.")
                    .font(TVTheme.font(size: 11.84, css: 400))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            } else {
                Button { open.toggle() } label: {
                    HStack {
                        Text(summary)
                            .font(TVTheme.font(size: 11.84, css: 680))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(open ? "\u{2303}" : "\u{2304}")
                            .font(TVTheme.font(size: 11.84, css: 680))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                    }
                    .padding(.horizontal, 19.4)
                    .frame(width: 268, height: 58.8)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DesignTokens.Stage.surfaceSoft.opacity(0.64)))
                }
                .buttonStyle(TVRingButtonStyle(cornerRadius: 12))
                .focusEffectDisabled()
                if open {
                    ForEach(options) { facet in
                        let chosen = selection.contains(facet.code)
                        Button {
                            if chosen { selection.removeAll { $0 == facet.code } } else { selection.append(facet.code) }
                        } label: {
                            HStack {
                                Text(chosen ? "\u{2713}" : "")
                                    .frame(width: 18, alignment: .leading)
                                Text(facet.displayName).lineLimit(1)
                                Spacer(minLength: 0)
                                if let count = facet.count {
                                    Text("\(count)").foregroundStyle(DesignTokens.Color.textDisabled)
                                }
                            }
                            .font(TVTheme.font(size: 11.84, css: chosen ? 760 : 520))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .padding(.horizontal, 14)
                            .frame(width: 268, height: 44)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(chosen ? DesignTokens.Stage.surfaceSoft : Color.clear))
                        }
                        .buttonStyle(TVRingButtonStyle(cornerRadius: 10))
                        .focusEffectDisabled()
                    }
                }
            }
        }
        .padding(.bottom, 30.3)
    }

    /// The facets plus any chosen code the facets no longer list (web `languageOptions`).
    private var options: [LanguageFacet] {
        var rows = facets ?? []
        for code in selection where !rows.contains(where: { $0.code == code }) {
            rows.append(LanguageFacet(code: code, name: nil, count: nil))
        }
        return rows
    }

    private var summary: String {
        if selection.isEmpty { return "Any language" }
        return selection.map { code in options.first { $0.code == code }?.displayName ?? code }.joined(separator: ", ")
    }
}
