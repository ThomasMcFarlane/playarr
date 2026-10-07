import AVFoundation
import PlayarrKit
import SwiftUI
import UIKit

/// Everything the player chrome shows, so playback and the parity route draw the same view.
struct TVPlayerChromeState {
    var position: Double
    var duration: Double
    var isPlaying: Bool
    var qualityLabel: String
    var selectedQualityID: String
    var menuOpen: Bool
}

/// Renders an `AVPlayer` without any system transport controls (the chrome is drawn in SwiftUI).
struct TVVideoSurface: UIViewRepresentable {
    let player: AVPlayer?

    func makeUIView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        view.playerLayer.videoGravity = .resizeAspect
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ view: PlayerLayerView, context: Context) {
        view.playerLayer.player = player
    }

    final class PlayerLayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

/// The web TV player chrome (`.player-controls`): minimise and close at the top right, scrubber,
/// transport row and the quality matrix, laid out from the web client's measured geometry.
struct TVPlayerChrome: View {
    var state: TVPlayerChromeState
    var onClose: () -> Void = {}
    var onTogglePlay: () -> Void = {}
    var onToggleQualityMenu: () -> Void = {}
    /// Static drawing for the parity route (no focus effects).
    var frozen = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(
                colors: [Color.black.opacity(0), Color.black.opacity(0.82)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(width: 1920, height: 518.4)
            .placed(x: 0, y: 561.6, w: 1920, h: 518.4)

            topButtons
            scrubber
            transport
            rightGroup
            if state.menuOpen { qualityMenu }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: Top right

    private var topButtons: some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 8.8) {
                Image(systemName: "arrow.down.right.and.arrow.up.left")
                    .font(.system(size: 14, weight: .semibold))
                Text("Minimise")
                    .font(TVTheme.font(size: 11.2, weight: .bold))
                    .tracking(0.22)
            }
            .foregroundStyle(Color.white)
            .frame(width: 124, height: 48)
            .background(Capsule().fill(Color(red: 12 / 255, green: 10 / 255, blue: 11 / 255).opacity(0.58)))
            .placed(x: 1678, y: 37.8, w: 124, h: 48)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Color(red: 12 / 255, green: 10 / 255, blue: 11 / 255).opacity(0.58)))
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .focusable(!frozen)
            .placed(x: 1814, y: 37.8, w: 48, h: 48)
        }
    }

    // MARK: Scrubber

    private var scrubber: some View {
        let fraction = state.duration > 0 ? min(max(state.position / state.duration, 0), 1) : 0
        let progress = 1780 * fraction
        return ZStack(alignment: .topLeading) {
            Capsule().fill(Color.white.opacity(0.2)).placed(x: 70, y: 936, w: 1780, h: 6)
            Capsule().fill(Color.white.opacity(0.34)).placed(x: 70, y: 936, w: 491.8, h: 6)
            Capsule().fill(DesignTokens.Color.brandPrimary).placed(x: 70, y: 936, w: max(progress, 0), h: 6)
            Circle().fill(DesignTokens.Color.brandPrimary).placed(x: 70 + progress - 7.5, y: 931.5, w: 15, h: 15)
        }
    }

    // MARK: Transport

    private func icon(_ symbol: String, x: CGFloat, y: CGFloat = 980, opacity: Double = 0.92) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .regular))
            .foregroundStyle(Color.white.opacity(opacity))
            .frame(width: 20, height: 20)
            .placed(x: x, y: y, w: 20, h: 20, alignment: .center)
    }

    private static func clock(_ seconds: Double) -> String {
        let total = max(0, Int(seconds))
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    private var transport: some View {
        ZStack(alignment: .topLeading) {
            icon("backward.end", x: 90, opacity: 0.3)
            Button(action: onTogglePlay) {
                Image(systemName: state.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(Color.white)
                    .frame(width: 64, height: 64)
                    .background(Circle().fill(Color.white.opacity(0.14)))
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .focusable(!frozen)
            .placed(x: 147.6, y: 958, w: 64, h: 64)
            icon("forward.end", x: 247.2, opacity: 0.3)
            Text(Self.clock(state.position))
                .font(TVTheme.font(size: 10.88, weight: .regular))
                .foregroundStyle(Color.white)
                .placed(x: 302.8, y: 981.8, w: 30, h: 16.3)
            Text("/")
                .font(TVTheme.font(size: 10.88, weight: .regular))
                .foregroundStyle(Color(red: 119 / 255, green: 107 / 255, blue: 113 / 255))
                .placed(x: 330.6, y: 981.8, w: 8, h: 16.3)
            Text(Self.clock(state.duration))
                .font(TVTheme.font(size: 10.88, weight: .regular))
                .foregroundStyle(Color.white)
                .placed(x: 340.2, y: 981.8, w: 30, h: 16.3)
        }
    }

    private var rightGroup: some View {
        ZStack(alignment: .topLeading) {
            icon("speaker.wave.2.fill", x: 1323.5)
            icon("captions.bubble", x: 1401.1)
            icon("list.bullet", x: 1478.7)
            Button(action: onToggleQualityMenu) {
                HStack(spacing: 11.8) {
                    Text("HD")
                        .font(TVTheme.font(size: 7.68, weight: .bold))
                        .tracking(0.31)
                        .foregroundStyle(Color.white)
                        .frame(width: 28, height: 20)
                    Text(state.qualityLabel)
                        .font(TVTheme.font(size: 10.56, weight: .bold))
                        .tracking(0.11)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                }
                .padding(.horizontal, 15.5)
                .frame(width: 173.4, height: 60.5, alignment: .leading)
                .background(Capsule().fill(Color.white.opacity(state.menuOpen ? 0.15 : 0)))
            }
            .buttonStyle(TVFocusableCardButtonStyle())
            .focusable(!frozen)
            .placed(x: 1527.8, y: 959.8, w: 173.4, h: 60.5)
            icon("info.circle", x: 1730.4)
            icon("airplayvideo", x: 1808)
        }
    }

    // MARK: Quality matrix

    private static let tiers: [(name: String, height: String, mbps: [Int])] = [
        ("UHD", "2160p", [12, 20, 35]),
        ("FHD", "1080p", [4, 8, 12]),
        ("HD", "720p", [2, 4, 6]),
        ("SD", "480p", [1, 2, 3]),
    ]

    private var qualityMenu: some View {
        let white54 = Color.white.opacity(0.54)
        let columns: [(String, CGFloat)] = [("Low", 1203.3), ("Medium", 1365.9), ("High", 1528.5)]
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 18 / 255, green: 14 / 255, blue: 17 / 255).opacity(0.9))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.white.opacity(0.08), lineWidth: 1))
                .placed(x: 1074.8, y: 540, w: 620, h: 408)
            Text("QUALITY")
                .font(TVTheme.font(size: 8.64, weight: .heavy))
                .tracking(1.3)
                .foregroundStyle(Color.white.opacity(0.56))
                .placed(x: 1084.6, y: 549.8, w: 600, h: 28.9)
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(DesignTokens.Color.brandPrimary.opacity(0.22))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(DesignTokens.Color.brandPrimary.opacity(0.55), lineWidth: 1)
                )
                .placed(x: 1084.6, y: 578.7, w: 600.4, h: 60)
            Text(state.qualityLabel)
                .font(TVTheme.font(size: 12.48, weight: .bold))
                .foregroundStyle(Color.white)
                .placed(x: 1095.5, y: 591.4, w: 300, h: 18.7)
            Text("Source quality")
                .font(TVTheme.font(size: 9.28, weight: .regular))
                .foregroundStyle(white54)
                .placed(x: 1095.5, y: 612, w: 300, h: 13.9)
            Text("\u{2713}")
                .font(TVTheme.font(size: 11.84, weight: .regular))
                .foregroundStyle(DesignTokens.Color.brandPrimary)
                .placed(x: 1658.1, y: 599.8, w: 16, h: 17.8)
            ForEach(columns, id: \.0) { column in
                Text(column.0.uppercased())
                    .font(TVTheme.font(size: 10.24, weight: .heavy))
                    .tracking(0.82)
                    .foregroundStyle(white54)
                    .placed(x: column.1, y: 646.7, w: 156.6, h: 27.5, alignment: .center)
            }
            ForEach(Array(Self.tiers.enumerated()), id: \.offset) { row, tier in
                let top = 680.2 + CGFloat(row) * 66
                Text(tier.name)
                    .font(TVTheme.font(size: 12.16, weight: .heavy))
                    .foregroundStyle(Color.white)
                    .placed(x: 1088.6, y: top + 13, w: 104.7, h: 18.2)
                Text(tier.height)
                    .font(TVTheme.font(size: 9.28, weight: .regular))
                    .foregroundStyle(white54)
                    .placed(x: 1088.6, y: top + 33.1, w: 104.7, h: 13.9)
                ForEach(Array(columns.enumerated()), id: \.offset) { column, spec in
                    ZStack(alignment: .topLeading) {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.055))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
                            )
                            .frame(width: 156.6, height: 60)
                        Text("\(tier.mbps[column]) Mbps")
                            .font(TVTheme.font(size: 12.48, weight: .bold))
                            .foregroundStyle(Color.white)
                            .placed(x: 10.9, y: 12.7, w: 130, h: 18.7)
                        Text(spec.0)
                            .font(TVTheme.font(size: 9.28, weight: .regular))
                            .foregroundStyle(white54)
                            .placed(x: 10.9, y: 33.3, w: 130, h: 13.9)
                    }
                    .frame(width: 156.6, height: 60, alignment: .topLeading)
                    .placed(x: spec.1, y: top, w: 156.6, h: 60)
                }
            }
        }
    }
}
