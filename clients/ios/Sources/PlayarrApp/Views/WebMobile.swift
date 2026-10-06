import PlayarrKit
import SwiftUI
import UIKit

/// Design tokens and primitives that reproduce Playarr Web's mobile layout
/// (390x844 CSS viewport) on iPhone. Numbers come from the web client's
/// computed layout (see `scripts/parity/apple/capture-web.mjs`, which dumps
/// every element's box and styles next to each reference capture).
enum WM {
    // Theme-adaptive tokens: the same values as the web's light and dark themes.
    static let shell = PlayarrStyle.background
    static let page = PlayarrStyle.surface
    static let ink = PlayarrStyle.ink
    static let inkSoft = PlayarrStyle.inkSoft
    static let muted = PlayarrStyle.muted
    static let pink = PlayarrStyle.pink
    static let artFill = adaptive(light: (223, 220, 221), dark: (49, 42, 48))
    static let chip = PlayarrStyle.surfaceStrong
    static let line = adaptive(light: (56, 38, 33), dark: (223, 220, 221))

    static func adaptive(light: (CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat)) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: value.0 / 255, green: value.1 / 255, blue: value.2 / 255, alpha: 1)
        })
    }

    /// CSS font weight to the nearest Avenir Next face, using the CSS font
    /// matching order (above 500 look upwards first).
    static func weight(_ css: Int) -> Font.Weight {
        switch css {
        case ..<450: .regular
        case 450...500: .medium
        case 501...599: .semibold
        case 600...699: .bold
        case 700...: .heavy
        default: .regular
        }
    }

    static func font(_ size: CGFloat, _ css: Int = 400) -> Font {
        #if DEBUG
        // The committed web references were rendered on a host without Avenir Next, so the browser
        // fell back to a metric-compatible Arial. The parity run draws the same face to compare
        // layout rather than typeface; the shipped app always uses Avenir Next.
        if ParityLaunch.isActive {
            return .custom(css >= 600 ? "Arial-BoldMT" : "ArialMT", fixedSize: size)
        }
        #endif
        return .custom("Avenir Next", fixedSize: size).weight(weight(css))
    }

    /// `--mobile-top-inset`: max(14px, safe-area-inset-top). The parity
    /// capture runs the web with no safe area, so it uses the 14px floor.
    @MainActor static var topInset: CGFloat {
        #if DEBUG
        if ParityLaunch.isActive { return 14 }
        #endif
        return max(14, safeArea.top)
    }

    /// Bottom offset of the floating nav: max(8px, safe-area-inset-bottom).
    @MainActor static var bottomInset: CGFloat {
        #if DEBUG
        if ParityLaunch.isActive { return 8 }
        #endif
        return max(8, safeArea.bottom)
    }

    @MainActor static var safeArea: UIEdgeInsets {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.safeAreaInsets ?? .zero
    }
}

/// One line of text with a CSS-style line box (height) and letter spacing.
struct WMText: View {
    let text: String
    let size: CGFloat
    let weight: Int
    let color: Color
    let lineHeight: CGFloat
    let tracking: CGFloat

    init(
        _ text: String,
        _ size: CGFloat,
        _ weight: Int = 400,
        color: Color = WM.ink,
        lh: CGFloat,
        ls: CGFloat = 0
    ) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
        self.lineHeight = lh
        self.tracking = ls
    }

    var body: some View {
        Text(text)
            .font(WM.font(size, weight))
            .tracking(tracking)
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(height: lineHeight, alignment: .leading)
    }
}

// MARK: - Icons (the web NavIcons, drawn from the same SVG path data)

private enum SVGToken {
    case command(Character)
    case number(CGFloat)
}

enum SVGPathParser {
    static func path(_ d: String) -> Path {
        let tokens = tokenize(d)
        var index = 0
        var path = Path()
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastControl: CGPoint?
        var lastWasCubic = false

        func number() -> CGFloat {
            guard index < tokens.count, case .number(let value) = tokens[index] else { return 0 }
            index += 1
            return value
        }
        func hasNumber() -> Bool {
            guard index < tokens.count, case .number = tokens[index] else { return false }
            return true
        }

        while index < tokens.count {
            guard case .command(var command) = tokens[index] else {
                index += 1
                continue
            }
            index += 1
            repeat {
                let relative = command.isLowercase
                let upper = Character(command.uppercased())
                var cubic = false
                switch upper {
                case "M":
                    let x = number(), y = number()
                    current = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                    path.move(to: current)
                    subpathStart = current
                    command = relative ? "l" : "L"
                case "L":
                    let x = number(), y = number()
                    current = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                    path.addLine(to: current)
                case "H":
                    let x = number()
                    current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                    path.addLine(to: current)
                case "V":
                    let y = number()
                    current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                    path.addLine(to: current)
                case "C":
                    let x1 = number(), y1 = number(), x2 = number(), y2 = number(), x = number(), y = number()
                    let base = relative ? current : .zero
                    let c1 = CGPoint(x: base.x + x1, y: base.y + y1)
                    let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                    let end = CGPoint(x: base.x + x, y: base.y + y)
                    path.addCurve(to: end, control1: c1, control2: c2)
                    lastControl = c2
                    current = end
                    cubic = true
                case "S":
                    let x2 = number(), y2 = number(), x = number(), y = number()
                    let base = relative ? current : .zero
                    let c1 = (lastWasCubic ? lastControl : nil).map {
                        CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y)
                    } ?? current
                    let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                    let end = CGPoint(x: base.x + x, y: base.y + y)
                    path.addCurve(to: end, control1: c1, control2: c2)
                    lastControl = c2
                    current = end
                    cubic = true
                case "A":
                    let rx = number(), ry = number(), rotation = number()
                    let large = number() != 0, sweep = number() != 0
                    let x = number(), y = number()
                    let end = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                    addArc(&path, from: current, to: end, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep)
                    current = end
                case "Z":
                    path.closeSubpath()
                    current = subpathStart
                default:
                    index = tokens.count
                }
                lastWasCubic = cubic
            } while hasNumber()
        }
        return path
    }

    private static func tokenize(_ d: String) -> [SVGToken] {
        var tokens: [SVGToken] = []
        var buffer = ""
        func flush() {
            if !buffer.isEmpty, let value = Double(buffer) { tokens.append(.number(CGFloat(value))) }
            buffer = ""
        }
        for character in d {
            if character.isLetter {
                flush()
                tokens.append(.command(character))
            } else if character == "-" {
                flush()
                buffer = "-"
            } else if character == "." {
                if buffer.contains(".") { flush() }
                buffer.append(character)
            } else if character == " " || character == "," || character == "\n" {
                flush()
            } else {
                buffer.append(character)
            }
        }
        flush()
        return tokens
    }

    /// SVG endpoint arc to cubic Bezier segments (SVG 1.1, appendix F.6).
    private static func addArc(
        _ path: inout Path, from p0: CGPoint, to p1: CGPoint,
        rx rxIn: CGFloat, ry ryIn: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool
    ) {
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 || p0 == p1 {
            path.addLine(to: p1)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            let scale = lambda.squareRoot()
            rx *= scale
            ry *= scale
        }
        let numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let sign: CGFloat = large == sweep ? -1 : 1
        let coefficient = sign * max(0, numerator / denominator).squareRoot()
        let cxp = coefficient * rx * y1p / ry
        let cyp = coefficient * -(ry * x1p / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2
        let theta1 = atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
        let theta2 = atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx)
        var delta = theta2 - theta1
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
        let step = delta / CGFloat(segments)
        let t = 4 / 3 * tan(step / 4)
        func point(_ angle: CGFloat) -> (CGPoint, CGPoint) {
            // Position and derivative direction on the rotated ellipse.
            let ca = cos(angle), sa = sin(angle)
            let x = cx + rx * ca * cosPhi - ry * sa * sinPhi
            let y = cy + rx * ca * sinPhi + ry * sa * cosPhi
            let tx = -rx * sa * cosPhi - ry * ca * sinPhi
            let ty = -rx * sa * sinPhi + ry * ca * cosPhi
            return (CGPoint(x: x, y: y), CGPoint(x: tx, y: ty))
        }
        var angle = theta1
        for _ in 0..<segments {
            let (a, da) = point(angle)
            let (b, db) = point(angle + step)
            path.addCurve(
                to: b,
                control1: CGPoint(x: a.x + t * da.x, y: a.y + t * da.y),
                control2: CGPoint(x: b.x - t * db.x, y: b.y - t * db.y)
            )
            angle += step
        }
    }
}

enum WMIcon {
    case downloads, search, home, series, movies, sites, music, playlists, watchlist, calendar

    struct Element {
        let path: Path
        let filled: Bool
    }

    private static func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> Element {
        Element(path: Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r)), filled: false)
    }

    private static func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ rx: CGFloat) -> Element {
        Element(path: Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: rx), filled: false)
    }

    private static func line(_ d: String) -> Element { Element(path: SVGPathParser.path(d), filled: false) }
    private static func fill(_ d: String) -> Element { Element(path: SVGPathParser.path(d), filled: true) }

    var elements: [Element] {
        switch self {
        case .home:
            [Self.line("M3 11.5 12 4l9 7.5"), Self.line("M5.5 9.5V20h13V9.5"), Self.line("M10 20v-6h4v6")]
        case .search:
            [Self.circle(10.5, 10.5, 6.5), Self.line("m15.5 15.5 4.5 4.5")]
        case .series:
            [Self.rect(4, 4, 16, 16, 2), Self.line("M8 9h8M8 13h8M8 17h5"), Self.line("m10 1 2 3 2-3")]
        case .movies:
            [Self.rect(3, 5, 18, 14, 2), Self.line("m7 5 2-3M13 5l2-3M19 5l2-3"), Self.fill("m10 10 5 2.5-5 2.5z")]
        case .sites:
            [
                Self.circle(12, 12, 8.5),
                Self.line("M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"),
            ]
        case .music:
            [Self.line("M9 18V6l10-2v12"), Self.circle(6.5, 18.5, 2.5), Self.circle(16.5, 16.5, 2.5), Self.line("M9 10l10-2")]
        case .downloads:
            [
                Self.line("M12 3v12"), Self.line("m7 10.5 5 4.5 5-4.5"),
                Self.line("M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5"),
            ]
        case .playlists:
            [
                Self.line("M5 6h10M5 10h10M5 14h6"), Self.line("M17 13.5v6"), Self.line("m17 13.5 4-1.5v5.5"),
                Self.circle(15.5, 19.5, 1.5), Self.circle(19.5, 17.5, 1.5),
            ]
        case .watchlist:
            [Self.line("M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"), Self.line("M12 7.5v5M9.5 10h5")]
        case .calendar:
            [Self.rect(3.5, 5, 17, 15, 2), Self.line("M3.5 10h17M8 3v4M16 3v4")]
        }
    }
}

struct WMIconView: View {
    let icon: WMIcon
    let color: Color
    var size: CGFloat = 21

    var body: some View {
        Canvas { context, _ in
            let scale = size / 24
            let transform = CGAffineTransform(scaleX: scale, y: scale)
            for element in icon.elements {
                let path = element.path.applying(transform)
                if element.filled {
                    context.fill(path, with: .color(color))
                } else {
                    context.stroke(
                        path, with: .color(color),
                        style: StrokeStyle(lineWidth: 1.8 * scale, lineCap: .round, lineJoin: .round)
                    )
                }
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Key art and chip shadow

/// The web's page backdrop: the featured title's artwork, drawn grey at low strength under a
/// wash that fades to the page colour (`.tv-key-art` and `.tv-stage-wash`).
struct WMKeyArt: View {
    let work: Work?
    let apiClient: PlayarrAPIClient
    var imageHeight: CGFloat = 483
    var fadeStart: CGFloat = 219
    var fadeEnd: CGFloat = 456
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let work {
                PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                    .saturation(0)
                    .opacity(scheme == .dark ? 0.085 : 0.22)
                    .frame(width: 406, height: imageHeight)
                    .offset(x: -8, y: -9)
            }
            LinearGradient(
                stops: [
                    .init(color: WM.page.opacity(0), location: fadeStart / 844),
                    .init(color: WM.page, location: fadeEnd / 844),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(width: 390, height: 844, alignment: .topLeading)
        .clipped()
        .allowsHitTesting(false)
    }
}

/// Soft shadow under the web's pill buttons in the light theme.
struct WMChipShadow: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.shadow(color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(scheme == .dark ? 0 : 0.1), radius: 10, y: 5)
    }
}

extension View {
    func wmChipShadow() -> some View { modifier(WMChipShadow()) }
}

// MARK: - Cards

struct WMUnseenDot: View {
    var body: some View {
        Circle()
            .fill(WM.pink)
            .frame(width: 9, height: 9)
            .overlay(Circle().strokeBorder(Color.white.opacity(0.94), lineWidth: 2))
            .shadow(color: Color(red: 31 / 255, green: 14 / 255, blue: 20 / 255).opacity(0.45), radius: 4.5, y: 2)
    }
}

extension Work {
    /// Singular kind used under web cards ("Movie · 2020").
    var singularKindYearLabel: String {
        let singular: String
        switch kind {
        case .movie: singular = "Movie"
        case .series: singular = "Series"
        case .site: singular = "Site"
        case .artist: singular = "Artist"
        case .author: singular = "Author"
        }
        guard let year = releaseDate?.prefix(4), year.count == 4, Int(year) != nil else { return singular }
        return "\(singular) · \(year)"
    }
}

/// Home rail card (`tv-home-card`): 179x101 art, title and meta lines.
struct WMRailCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var unseen = true
    var focused = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                .frame(width: 179, height: 101)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if unseen { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
                }
            WMText(work.title, 12.48, 630, lh: 18.72).padding(.top, 10)
            WMText(work.singularKindYearLabel, 9.92, 400, color: WM.muted, lh: 14.88).padding(.top, 2.28)
        }
        .frame(width: 179, height: 147, alignment: .topLeading)

    }
}

/// Library grid card (`tv-title-card`): two columns of 173x97 art with a title line.
struct WMLibraryCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var unseen = true
    var focused = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                .frame(width: 173, height: 97.3)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if unseen { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
                }
            WMText(work.title, 8.8, 610, lh: 13.2, ls: -0.132).padding(.top, 12)
        }
        .frame(width: 173, height: 122.5, alignment: .topLeading)

    }
}

/// Search result card (`tv-search-result`): 173x97 art, bold title, uppercase kind line.
struct WMSearchCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var focused = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                .frame(width: 173, height: 97.3)
                .background(WM.chip)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topTrailing) { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
            WMText(work.title, 12.16, 650, lh: 18.24).padding(.top, 11)
            WMText(work.singularKindYearLabel.uppercased(), 9.28, 720, color: WM.muted, lh: 13.92, ls: 0.3)
                .padding(.top, 2)
        }
        .frame(width: 173, height: 142.5, alignment: .topLeading)

    }
}

/// `app-user-identity`-style round header button.
struct WMHeaderCircleButton: View {
    let width: CGFloat
    let height: CGFloat
    let glyph: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(glyph)
                .font(WM.font(12.8, 720))
                .foregroundStyle(WM.inkSoft)
                .frame(width: width, height: height)
                .background(WM.chip.opacity(0.66), in: Ellipse())
                .overlay(Ellipse().stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// Page header used by the library screens: back button, title, count, trailing action.
struct WMLibraryHeader: View {
    let title: String
    let detail: String?
    let onBack: () -> Void
    let onFilters: () -> Void

    var body: some View {
        let top = WM.topInset + 2
        ZStack(alignment: .topLeading) {
            WMHeaderCircleButton(width: 42, height: 38, glyph: "←", action: onBack)
                .offset(x: 16, y: top)
            HStack(spacing: 10) {
                WMText(title, 17.6, 580, lh: 26.4, ls: -0.792)
                if let detail {
                    WMText(detail, 8, 680, color: WM.muted, lh: 12, ls: 0.36)
                }
            }
            .frame(height: 38)
            .offset(x: 68, y: top)
            Button(action: onFilters) {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(WM.inkSoft)
                    .frame(width: 44, height: 38)
                    .background(WM.chip.opacity(0.66), in: Capsule())
                    .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .offset(x: 274, y: top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Environment

private struct PlayarrGoHomeKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    /// Set by the app shell: what the web header's back arrow does on a top-level page.
    var playarrGoHome: () -> Void {
        get { self[PlayarrGoHomeKey.self] }
        set { self[PlayarrGoHomeKey.self] = newValue }
    }
}
