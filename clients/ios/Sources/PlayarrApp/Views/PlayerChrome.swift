import AVFoundation
import PlayarrKit
import SwiftUI
import UIKit

// MARK: - Video surface

/// A plain `AVPlayerLayer`-backed surface. Unlike SwiftUI's `VideoPlayer` it
/// draws no controls of its own, so the web-style player chrome is the only UI.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer?
    var fillsScreen = false

    func makeUIView(context: Context) -> PlayerLayerUIView {
        let view = PlayerLayerUIView()
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ view: PlayerLayerUIView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        view.playerLayer.videoGravity = fillsScreen ? .resizeAspectFill : .resizeAspect
    }
}

final class PlayerLayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

// MARK: - Icons (the web PlayerIcons, drawn from the same SVG path data)

enum PlayerGlyph {
    case play, pause, previous, next, audio, subtitles, playlist, info
    case volumeHigh, volumeMuted, fullscreenEnter, fullscreenExit
    case close, minimise, castDevices

    struct Element {
        let path: Path
        let filled: Bool
    }

    private static func line(_ d: String) -> Element { Element(path: SVGPathParser.path(d), filled: false) }
    private static func fill(_ d: String) -> Element { Element(path: SVGPathParser.path(d), filled: true) }
    private static func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ rx: CGFloat, filled: Bool) -> Element {
        Element(path: Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: rx), filled: filled)
    }
    private static func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, filled: Bool) -> Element {
        Element(path: Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r)), filled: filled)
    }

    var elements: [Element] {
        switch self {
        case .play:
            [Self.fill("M7 4.5v15l13-7.5z")]
        case .pause:
            [Self.rect(6, 4.5, 4.5, 15, 1, filled: true), Self.rect(13.5, 4.5, 4.5, 15, 1, filled: true)]
        case .previous:
            [Self.rect(4.5, 5, 2.4, 14, 1, filled: true), Self.fill("M19.5 5.5v13L8.2 12z")]
        case .next:
            [Self.rect(17.1, 5, 2.4, 14, 1, filled: true), Self.fill("M4.5 5.5v13L15.8 12z")]
        case .audio:
            [Self.fill("M5 9.5v5h4l4.5 3.5V6L9 9.5z"), Self.line("M16.5 9a4.5 4.5 0 0 1 0 6"), Self.line("M19 6.5a8 8 0 0 1 0 11")]
        case .subtitles:
            [
                Self.rect(3.5, 5, 17, 14, 2, filled: false),
                Self.line("M6.5 12h4"), Self.line("M13.5 12h4"), Self.line("M6.5 15.5h7"), Self.line("M15.5 15.5h2"),
            ]
        case .playlist:
            [Self.line("M4 6.5h10"), Self.line("M4 11.5h10"), Self.line("M4 16.5h7"), Self.fill("m16 14 4 2.5-4 2.5z")]
        case .info:
            [Self.circle(12, 12, 8.5, filled: false), Self.line("M12 11v5.5"), Self.circle(12, 7.8, 0.9, filled: true)]
        case .volumeHigh:
            [Self.fill("M4 9.5v5h4l5 4V5.5l-5 4z"), Self.line("M17 8.5a5 5 0 0 1 0 7"), Self.line("M19.7 6a9 9 0 0 1 0 12")]
        case .volumeMuted:
            [Self.fill("M4 9.5v5h4l5 4V5.5l-5 4z"), Self.line("M16 10.5 21 15.5"), Self.line("M21 10.5 16 15.5")]
        case .fullscreenEnter:
            [
                Self.line("M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"), Self.line("M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"),
                Self.line("M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"), Self.line("M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"),
            ]
        case .fullscreenExit:
            [
                Self.line("M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4"), Self.line("M15 4v3.5A1.5 1.5 0 0 0 16.5 9H20"),
                Self.line("M20 15h-3.5a1.5 1.5 0 0 0-1.5 1.5V20"), Self.line("M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20"),
            ]
        case .close:
            [Self.line("M6 6l12 12"), Self.line("M18 6 6 18")]
        case .minimise:
            [Self.line("M5 15h4v4"), Self.line("m9 15-5 5"), Self.line("M19 9h-4V5"), Self.line("m15 9 5-5")]
        case .castDevices:
            [
                Self.rect(2.5, 5, 13, 9, 1.2, filled: false), Self.line("M6 18h6M9 14v4"),
                Self.rect(17, 9, 5, 10, 1.2, filled: false),
            ]
        }
    }
}

struct PlayerGlyphView: View {
    let glyph: PlayerGlyph
    var size: CGFloat = 20
    var color: Color = .white

    var body: some View {
        Canvas { context, _ in
            let scale = size / 24
            let transform = CGAffineTransform(scaleX: scale, y: scale)
            for element in glyph.elements {
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

// MARK: - Quality model (web `qualityMatrix.ts` and `playerQualityLabel.ts`)

enum PlayerQuality {
    struct Choice: Identifiable {
        let id: String
        let level: String
        let mbps: Int
    }

    struct Tier: Identifiable {
        let id: String
        let name: String
        let resolution: String
        let choices: [Choice]
    }

    static let levels = ["Low", "Medium", "High"]

    static let tiers: [Tier] = [
        Tier(id: "uhd", name: "UHD", resolution: "2160p", choices: [
            Choice(id: "h264-2160p-12mbps", level: "Low", mbps: 12),
            Choice(id: "h264-2160p-20mbps", level: "Medium", mbps: 20),
            Choice(id: "h264-2160p-35mbps", level: "High", mbps: 35),
        ]),
        Tier(id: "fhd", name: "FHD", resolution: "1080p", choices: [
            Choice(id: "h264-1080p-4mbps", level: "Low", mbps: 4),
            Choice(id: "h264-1080p-8mbps", level: "Medium", mbps: 8),
            Choice(id: "h264-1080p-12mbps", level: "High", mbps: 12),
        ]),
        Tier(id: "hd", name: "HD", resolution: "720p", choices: [
            Choice(id: "h264-720p-2mbps", level: "Low", mbps: 2),
            Choice(id: "h264-720p-4mbps", level: "Medium", mbps: 4),
            Choice(id: "h264-720p-6mbps", level: "High", mbps: 6),
        ]),
        Tier(id: "sd", name: "SD", resolution: "480p", choices: [
            Choice(id: "h264-480p-1mbps", level: "Low", mbps: 1),
            Choice(id: "h264-480p-2mbps", level: "Medium", mbps: 2),
            Choice(id: "h264-480p-3mbps", level: "High", mbps: 3),
        ]),
    ]

    static let matrixIDs: Set<String> = Set(tiers.flatMap { $0.choices.map(\.id) })

    /// "0.3" style figure, or `nil` when unknown or below 0.05 Mbps.
    static func formatMbps(_ bps: Int64?) -> String? {
        guard let bps, bps > 0 else { return nil }
        let mbps = Double(bps) / 1_000_000
        guard mbps >= 0.05 else { return nil }
        return String(format: "%.1f", mbps)
    }

    /// "Original · 24.3 Mbps" when the source bitrate is known, else "Original".
    static func displayLabel(_ option: PlaybackQualityOption?) -> String {
        guard let option, option.id != "original" else {
            if let mbps = formatMbps(option?.videoBitrateBPS) { return "Original · \(mbps) Mbps" }
            return "Original"
        }
        return option.label
    }

    static func badge(_ option: PlaybackQualityOption?) -> String {
        switch option?.height ?? 0 {
        case 2160: "UHD"
        case 1080: "FHD"
        case 720: "HD"
        case 480: "SD"
        default: "HD"
        }
    }

    /// The label as the web renders it inside the 42pt button: "·" stays with the figure after it.
    static func lines(_ label: String) -> [String] {
        var result: [String] = []
        var pendingDot = false
        for word in label.split(separator: " ").map(String.init) {
            if word == "·" { pendingDot = true; continue }
            result.append(pendingDot ? "· \(word)" : word)
            pendingDot = false
        }
        return result
    }
}

func playerTimeString(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    let total = Int(seconds)
    let hours = total / 3600, minutes = (total % 3600) / 60, secs = total % 60
    if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, secs) }
    return String(format: "%d:%02d", minutes, secs)
}

// MARK: - Menu panels (web `.player-quality-menu`)

private let panelFill = Color(red: 18 / 255, green: 14 / 255, blue: 17 / 255).opacity(0.9)

struct PlayerPanel<Content: View>: View {
    let heading: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WMText(heading.uppercased(), 8.64, 650, color: .white.opacity(0.56), lh: 13, ls: 1.296)
                .padding(.top, 8.8)
                .padding(.bottom, 7.2)
                .padding(.leading, 11.2)
            content
        }
        .padding(8.8)
        .background(panelFill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.18), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 35, y: 24)
    }
}

/// One row of the audio, subtitle and queue menus (`.player-quality-option`).
struct PlayerOptionRow: View {
    let title: String
    let detail: String?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2.4) {
                    WMText(title, 11.04, 650, lh: 16.5)
                    if let detail, !detail.isEmpty {
                        WMText(detail, 8.32, 400, color: .white.opacity(0.55), lh: 12.5)
                    }
                }
                Spacer(minLength: 0)
                Text(selected ? "✓" : "")
                    .font(WM.font(13.76))
                    .foregroundStyle(WM.pink)
                    .frame(width: 24)
            }
            .padding(.horizontal, 11.52)
            .padding(.vertical, 9.92)
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .background(selected ? WM.pink.opacity(0.2) : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The quality matrix: the standalone Original row, then UHD/FHD/HD/SD by Low/Medium/High.
struct PlayerQualityMatrix: View {
    let options: [PlaybackQualityOption]
    let selectedID: String
    /// Width of the panel's inner content box.
    let innerWidth: CGFloat
    let onSelect: (String) -> Void

    private var gap: CGFloat { 6 }
    private var headingColumn: CGFloat { (innerWidth - 3 * gap) * 0.72 / 3.72 }
    private var choiceColumn: CGFloat { (innerWidth - 3 * gap) / 3.72 }
    private var available: Set<String> { Set(options.map(\.id)) }
    private var standalone: [PlaybackQualityOption] {
        options.filter { !PlayerQuality.matrixIDs.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !standalone.isEmpty {
                VStack(spacing: 6) {
                    ForEach(standalone) { option in
                        let mbps = PlayerQuality.formatMbps(option.videoBitrateBPS)
                        choice(
                            id: option.id,
                            label: PlayerQuality.displayLabel(option),
                            detail: option.id != "original" && mbps != nil ? "\(mbps ?? "") Mbps" : "Source quality",
                            width: innerWidth
                        )
                    }
                }
                .padding(.bottom, 8)
            }
            VStack(alignment: .leading, spacing: gap) {
                HStack(spacing: gap) {
                    Color.clear.frame(width: headingColumn, height: 23.68)
                    ForEach(PlayerQuality.levels, id: \.self) { level in
                        WMText(level.uppercased(), 7.68, 650, color: .white.opacity(0.54), lh: 11.5, ls: 0.6144)
                            .frame(width: choiceColumn, height: 23.68)
                    }
                }
                ForEach(PlayerQuality.tiers) { tier in
                    HStack(spacing: gap) {
                        VStack(alignment: .leading, spacing: 1.92) {
                            WMText(tier.name, 8.96, 650, lh: 13.44)
                            WMText(tier.resolution, 7.04, 400, color: .white.opacity(0.54), lh: 10.56)
                        }
                        .padding(.horizontal, 4)
                        .frame(width: headingColumn, height: 48, alignment: .leading)
                        ForEach(tier.choices) { item in
                            if available.contains(item.id) {
                                choice(id: item.id, label: "\(item.mbps) Mbps", detail: item.level, width: choiceColumn)
                            } else {
                                Text("—")
                                    .font(WM.font(11.52))
                                    .foregroundStyle(.white.opacity(0.28))
                                    .frame(width: choiceColumn, height: 48)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(.white.opacity(0.1), style: StrokeStyle(lineWidth: 1, dash: [3]))
                                    )
                            }
                        }
                    }
                }
            }
        }
    }

    private func choice(id: String, label: String, detail: String, width: CGFloat) -> some View {
        let selected = id == selectedID
        return Button { onSelect(id) } label: {
            HStack(spacing: 5.6) {
                VStack(alignment: .leading, spacing: 1.92) {
                    WMText(label, 9.28, 650, lh: 13.92)
                    WMText(detail, 7.04, 400, color: .white.opacity(0.54), lh: 10.56)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(selected ? "✓" : "")
                    .font(WM.font(11.84))
                    .foregroundStyle(WM.pink)
                    .frame(width: 16)
            }
            .padding(.horizontal, 9.92)
            .frame(width: width, height: 48)
            .background(
                selected ? WM.pink.opacity(0.22) : Color.white.opacity(0.055),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(selected ? WM.pink.opacity(0.62) : Color.white.opacity(0.1), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
