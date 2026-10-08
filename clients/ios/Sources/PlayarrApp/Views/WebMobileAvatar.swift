import SwiftUI

/// The six illustrated profile avatars of Playarr Web (`ProfileAvatar.tsx`), drawn from the same SVG
/// shapes on a 100-unit canvas over the same two-colour gradient.
struct WMAvatarPreset {
    enum Shape {
        case circle(CGFloat, CGFloat, CGFloat, fill: String)
        case rect(CGFloat, CGFloat, CGFloat, CGFloat, rx: CGFloat, fill: String)
        case path(String, fill: String?, stroke: String?, width: CGFloat)
    }

    let id: String
    let start: String
    let end: String
    let shapes: [Shape]

    static let all: [WMAvatarPreset] = [astronaut, cat, dinosaur, robot, pirate, alien]

    static func preset(_ id: String) -> WMAvatarPreset {
        all.first(where: { $0.id == id }) ?? astronaut
    }

    static let astronaut = WMAvatarPreset(
        id: "astronaut", start: "#5267ad", end: "#222d5f",
        shapes: [
            .circle(50, 42, 29, fill: "#eef5ff"),
            .circle(50, 42, 21, fill: "#21315f"),
            .path("M31 77c4-13 14-20 19-20s15 7 19 20", fill: "#eef5ff", stroke: nil, width: 0),
            .circle(43, 39, 3, fill: "#ffffff"),
            .circle(57, 39, 3, fill: "#ffffff"),
            .path("M44 49c4 3 8 3 12 0", fill: nil, stroke: "#ffffff", width: 3),
            .path("M21 25l-7-6m65 6 7-6", fill: nil, stroke: "#d7e5ff", width: 4),
        ]
    )

    static let cat = WMAvatarPreset(
        id: "cat", start: "#e37c68", end: "#9c3f66",
        shapes: [
            .path("M24 37 18 15l25 13h14l25-13-6 22c8 7 12 17 10 28-3 17-18 25-36 25S17 82 14 65c-2-11 2-21 10-28Z", fill: "#ffe0bd", stroke: nil, width: 0),
            .path("m24 28-2-8 11 6m43 2 2-8-11 6", fill: "#ef8c92", stroke: nil, width: 0),
            .path("M32 52h8m20 0h8", fill: nil, stroke: "#4b3550", width: 5),
            .path("m46 62 4 3 4-3m-4 3v6", fill: nil, stroke: "#4b3550", width: 3),
            .path("M35 65 15 60m20 11-20 5m50-11 20-5m-20 11 20 5", fill: nil, stroke: "#fff2df", width: 2.5),
        ]
    )

    static let dinosaur = WMAvatarPreset(
        id: "dinosaur", start: "#55a46e", end: "#237265",
        shapes: [
            .path("m28 29-9-14 17 4 5-12 10 13 12-9 2 17c14 5 23 16 23 29 0 18-16 31-38 31S12 75 12 57c0-12 6-22 16-28Z", fill: "#bde78b", stroke: nil, width: 0),
            .circle(38, 49, 5, fill: "#254b45"),
            .circle(65, 49, 5, fill: "#254b45"),
            .circle(39, 47, 1.5, fill: "#ffffff"),
            .circle(66, 47, 1.5, fill: "#ffffff"),
            .path("M38 66c8 7 17 7 25 0", fill: nil, stroke: "#254b45", width: 4),
            .path("m45 67 3 7 4-6 4 6 3-7", fill: "#ffffff", stroke: nil, width: 0),
        ]
    )

    static let robot = WMAvatarPreset(
        id: "robot", start: "#5d9caf", end: "#365383",
        shapes: [
            .path("M50 20V9m0 0 7-5M50 9l-7-5", fill: nil, stroke: "#e8fbff", width: 4),
            .rect(17, 20, 66, 62, rx: 17, fill: "#dff7f7"),
            .rect(26, 34, 48, 31, rx: 10, fill: "#294263"),
            .circle(40, 49, 5, fill: "#72e3d3"),
            .circle(60, 49, 5, fill: "#72e3d3"),
            .path("M40 72h20", fill: nil, stroke: "#6a91a3", width: 4),
            .path("M17 43H9v18h8m66-18h8v18h-8", fill: nil, stroke: "#dff7f7", width: 6),
        ]
    )

    static let pirate = WMAvatarPreset(
        id: "pirate", start: "#d39a48", end: "#91464c",
        shapes: [
            .circle(50, 53, 34, fill: "#f3c49e"),
            .path("M18 35c7-20 54-25 68 2-23-8-44-6-68-2Z", fill: "#802f4b", stroke: nil, width: 0),
            .path("M21 31 12 17c15-4 29 1 38 11", fill: "#c84b58", stroke: nil, width: 0),
            .circle(38, 52, 4, fill: "#3a2935"),
            .path("M58 52h13m-7-8v16", fill: nil, stroke: "#3a2935", width: 4),
            .path("M53 44c9-5 19-3 25 4", fill: nil, stroke: "#3a2935", width: 4),
            .path("M39 68c9 7 19 7 27-1", fill: nil, stroke: "#7e3e3f", width: 4),
        ]
    )

    static let alien = WMAvatarPreset(
        id: "alien", start: "#8b71c5", end: "#4a477f",
        shapes: [
            .path("M50 10c25 0 39 17 35 39-4 21-22 39-35 43-13-4-31-22-35-43C11 27 25 10 50 10Z", fill: "#c7f0bd", stroke: nil, width: 0),
            .path("M25 43c9-8 18-8 24 1-5 14-17 18-24-1Zm50 0c-9-8-18-8-24 1 5 14 17 18 24-1Z", fill: "#292949", stroke: nil, width: 0),
            .circle(38, 45, 2, fill: "#ffffff"),
            .circle(62, 45, 2, fill: "#ffffff"),
            .path("M42 72c5 2 11 2 16 0", fill: nil, stroke: "#4b765d", width: 3),
            .circle(18, 20, 3, fill: "#e8dcff"),
            .circle(83, 17, 2, fill: "#e8dcff"),
        ]
    )
}

extension Color {
    /// `#rrggbb`.
    init(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let value = UInt32(digits, radix: 16) ?? 0
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}

/// Round avatar: gradient disc with the highlight and the illustration at 84% of the size.
struct WMAvatarPresetView: View {
    let presetID: String
    let size: CGFloat

    var body: some View {
        let preset = WMAvatarPreset.preset(presetID)
        ZStack {
            Circle().fill(
                LinearGradient(
                    colors: [Color(hex: preset.start), Color(hex: preset.end)],
                    startPoint: UnitPoint(x: 0.2, y: 0.06),
                    endPoint: UnitPoint(x: 0.8, y: 0.94)
                )
            )
            Circle().fill(
                RadialGradient(
                    colors: [Color.white.opacity(0.28), Color.white.opacity(0)],
                    center: UnitPoint(x: 0.34, y: 0.26),
                    startRadius: 0,
                    endRadius: size * 0.27
                )
            )
            Canvas { context, canvasSize in
                let side = canvasSize.width * 0.84
                let origin = (canvasSize.width - side) / 2
                let scale = side / 100
                let transform = CGAffineTransform(translationX: origin, y: origin).scaledBy(x: scale, y: scale)
                for shape in preset.shapes {
                    switch shape {
                    case .circle(let cx, let cy, let r, let fill):
                        let path = Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
                        context.fill(path.applying(transform), with: .color(Color(hex: fill)))
                    case .rect(let x, let y, let w, let h, let rx, let fill):
                        let path = Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: rx)
                        context.fill(path.applying(transform), with: .color(Color(hex: fill)))
                    case .path(let d, let fill, let stroke, let width):
                        let path = SVGPathParser.path(d).applying(transform)
                        if let fill { context.fill(path, with: .color(Color(hex: fill))) }
                        if let stroke {
                            context.stroke(
                                path, with: .color(Color(hex: stroke)),
                                style: StrokeStyle(lineWidth: width * scale, lineCap: .round, lineJoin: .round)
                            )
                        }
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}
