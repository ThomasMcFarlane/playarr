import PlayarrKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The six preset profile avatars of the web client (`ProfileAvatar.tsx`), drawn natively.
/// The preset follows the web's `defaultProfileAvatarPreset(userId)` hash, so a user shows the
/// same face on every client. A custom photo (the account's resized JPEG, saved from another device)
/// replaces the artwork, clipped to the circle.
struct TVProfileAvatar: View {
    var userID: String
    var size: CGFloat
    /// The server-backed preset id, which wins over the hash of the user id.
    var presetName: String? = nil
    /// The account's decoded custom photo; when set it is drawn instead of a preset.
    var customImage: UIImage? = nil

    private enum Element {
        case path(String, fill: Color?, stroke: Color?, width: CGFloat, round: Bool)
        case circle(CGFloat, CGFloat, CGFloat, Color)
        case rect(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, Color)
    }

    private struct Preset {
        var start: Color
        var end: Color
        var elements: [Element]
    }

    static let order = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"]

    static func presetIndex(for userID: String) -> Int {
        var hash: UInt32 = 0
        for scalar in userID.utf16 {
            hash = hash &* 31 &+ UInt32(scalar)
        }
        return Int(hash % UInt32(order.count))
    }

    private static func hex(_ value: UInt32) -> Color {
        Color(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }

    private static func preset(_ index: Int) -> Preset {
        let h = hex
        switch order[index] {
        case "astronaut":
            return Preset(start: h(0x5267ad), end: h(0x222d5f), elements: [
                .circle(50, 42, 29, h(0xeef5ff)),
                .circle(50, 42, 21, h(0x21315f)),
                .path("M31 77c4-13 14-20 19-20s15 7 19 20", fill: h(0xeef5ff), stroke: nil, width: 0, round: false),
                .circle(43, 39, 3, .white),
                .circle(57, 39, 3, .white),
                .path("M44 49c4 3 8 3 12 0", fill: nil, stroke: .white, width: 3, round: true),
                .path("M21 25l-7-6m65 6 7-6", fill: nil, stroke: h(0xd7e5ff), width: 4, round: true),
            ])
        case "cat":
            return Preset(start: h(0xe37c68), end: h(0x9c3f66), elements: [
                .path("M24 37 18 15l25 13h14l25-13-6 22c8 7 12 17 10 28-3 17-18 25-36 25S17 82 14 65c-2-11 2-21 10-28Z", fill: h(0xffe0bd), stroke: nil, width: 0, round: false),
                .path("m24 28-2-8 11 6m43 2 2-8-11 6", fill: h(0xef8c92), stroke: nil, width: 0, round: false),
                .path("M32 52h8m20 0h8", fill: nil, stroke: h(0x4b3550), width: 5, round: true),
                .path("m46 62 4 3 4-3m-4 3v6", fill: nil, stroke: h(0x4b3550), width: 3, round: true),
                .path("M35 65 15 60m20 11-20 5m50-11 20-5m-20 11 20 5", fill: nil, stroke: h(0xfff2df), width: 2.5, round: true),
            ])
        case "dinosaur":
            return Preset(start: h(0x55a46e), end: h(0x237265), elements: [
                .path("m28 29-9-14 17 4 5-12 10 13 12-9 2 17c14 5 23 16 23 29 0 18-16 31-38 31S12 75 12 57c0-12 6-22 16-28Z", fill: h(0xbde78b), stroke: nil, width: 0, round: false),
                .circle(38, 49, 5, h(0x254b45)),
                .circle(65, 49, 5, h(0x254b45)),
                .circle(39, 47, 1.5, .white),
                .circle(66, 47, 1.5, .white),
                .path("M38 66c8 7 17 7 25 0", fill: nil, stroke: h(0x254b45), width: 4, round: true),
                .path("m45 67 3 7 4-6 4 6 3-7", fill: .white, stroke: nil, width: 0, round: false),
            ])
        case "robot":
            return Preset(start: h(0x5d9caf), end: h(0x365383), elements: [
                .path("M50 20V9m0 0 7-5M50 9l-7-5", fill: nil, stroke: h(0xe8fbff), width: 4, round: true),
                .rect(17, 20, 66, 62, 17, h(0xdff7f7)),
                .rect(26, 34, 48, 31, 10, h(0x294263)),
                .circle(40, 49, 5, h(0x72e3d3)),
                .circle(60, 49, 5, h(0x72e3d3)),
                .path("M40 72h20", fill: nil, stroke: h(0x6a91a3), width: 4, round: true),
                .path("M17 43H9v18h8m66-18h8v18h-8", fill: nil, stroke: h(0xdff7f7), width: 6, round: true),
            ])
        case "pirate":
            return Preset(start: h(0xd39a48), end: h(0x91464c), elements: [
                .circle(50, 53, 34, h(0xf3c49e)),
                .path("M18 35c7-20 54-25 68 2-23-8-44-6-68-2Z", fill: h(0x802f4b), stroke: nil, width: 0, round: false),
                .path("M21 31 12 17c15-4 29 1 38 11", fill: h(0xc84b58), stroke: nil, width: 0, round: false),
                .circle(38, 52, 4, h(0x3a2935)),
                .path("M58 52h13m-7-8v16", fill: nil, stroke: h(0x3a2935), width: 4, round: true),
                .path("M53 44c9-5 19-3 25 4", fill: nil, stroke: h(0x3a2935), width: 4, round: false),
                .path("M39 68c9 7 19 7 27-1", fill: nil, stroke: h(0x7e3e3f), width: 4, round: true),
            ])
        default:
            return Preset(start: h(0x8b71c5), end: h(0x4a477f), elements: [
                .path("M50 10c25 0 39 17 35 39-4 21-22 39-35 43-13-4-31-22-35-43C11 27 25 10 50 10Z", fill: h(0xc7f0bd), stroke: nil, width: 0, round: false),
                .path("M25 43c9-8 18-8 24 1-5 14-17 18-24-1Zm50 0c-9-8-18-8-24 1 5 14 17 18 24-1Z", fill: h(0x292949), stroke: nil, width: 0, round: false),
                .circle(38, 45, 2, .white),
                .circle(62, 45, 2, .white),
                .path("M42 72c5 2 11 2 16 0", fill: nil, stroke: h(0x4b765d), width: 3, round: true),
                .circle(18, 20, 3, h(0xe8dcff)),
                .circle(83, 17, 2, h(0xe8dcff)),
            ])
        }
    }

    var body: some View {
        if let customImage {
            Image(uiImage: customImage)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            presetBody
        }
    }

    @ViewBuilder
    private var presetBody: some View {
        let index = presetName.flatMap { Self.order.firstIndex(of: $0) } ?? Self.presetIndex(for: userID)
        let preset = Self.preset(index)
        let art = size * 0.84
        let scale = art / 100
        ZStack {
            Circle().fill(
                LinearGradient(
                    colors: [preset.start, preset.end],
                    startPoint: UnitPoint(x: 0.1006, y: -0.0705),
                    endPoint: UnitPoint(x: 0.8994, y: 1.0705)
                )
            )
            Circle().fill(
                RadialGradient(
                    colors: [Color.white.opacity(0.28), .clear],
                    center: UnitPoint(x: 0.34, y: 0.26),
                    startRadius: 0,
                    endRadius: size * 0.267
                )
            )
            Canvas { context, canvasSize in
                let origin = CGPoint(x: (canvasSize.width - art) / 2, y: (canvasSize.height - art) / 2)
                for element in preset.elements {
                    switch element {
                    case .circle(let cx, let cy, let r, let color):
                        let rect = CGRect(x: origin.x + (cx - r) * scale, y: origin.y + (cy - r) * scale, width: 2 * r * scale, height: 2 * r * scale)
                        context.fill(Path(ellipseIn: rect), with: .color(color))
                    case .rect(let x, let y, let w, let h, let rx, let color):
                        let rect = CGRect(x: origin.x + x * scale, y: origin.y + y * scale, width: w * scale, height: h * scale)
                        context.fill(Path(roundedRect: rect, cornerSize: CGSize(width: rx * scale, height: rx * scale)), with: .color(color))
                    case .path(let d, let fill, let stroke, let width, let round):
                        var path = TVSVGPath.parse(d)
                        path = path.applying(CGAffineTransform(scaleX: scale, y: scale).concatenating(CGAffineTransform(translationX: origin.x, y: origin.y)))
                        if let fill { context.fill(path, with: .color(fill)) }
                        if let stroke {
                            context.stroke(
                                path,
                                with: .color(stroke),
                                style: StrokeStyle(lineWidth: width * scale, lineCap: round ? .round : .butt, lineJoin: round ? .round : .miter)
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

/// A small SVG path parser (M, L, H, V, C, S, Z in absolute and relative form) for the avatar artwork.
/// What a profile's avatar shows, by the web client's rules: the account's server preference when it is
/// usable (a known preset id, or a JPEG data URL), otherwise the preset picked from a hash of the user id.
enum TVProfileAvatarSource: Equatable {
    case preset(index: Int)
    case custom(dataURL: String)

    private static let jpegPrefix = "data:image/jpeg;base64,"

    static func resolve(preference: ProfileAvatarPreference?, userID: String) -> TVProfileAvatarSource {
        if let preference {
            switch preference.kind {
            case .preset:
                if let index = TVProfileAvatar.order.firstIndex(of: preference.value) { return .preset(index: index) }
            case .custom:
                if preference.value.prefix(jpegPrefix.count).lowercased() == jpegPrefix { return .custom(dataURL: preference.value) }
            }
        }
        return .preset(index: TVProfileAvatar.presetIndex(for: userID))
    }

    /// Decodes a custom photo's JPEG data URL; `nil` when it is not a decodable JPEG.
    static func image(fromDataURL dataURL: String) -> UIImage? {
        guard dataURL.prefix(jpegPrefix.count).lowercased() == jpegPrefix,
              let data = Data(base64Encoded: String(dataURL.dropFirst(jpegPrefix.count)), options: .ignoreUnknownCharacters)
        else { return nil }
        return UIImage(data: data)
    }
}

enum TVSVGPath {
    static func parse(_ d: String) -> Path {
        var path = Path()
        var tokens: [Token] = []
        let chars = Array(d)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c.isLetter {
                tokens.append(.command(c)); i += 1
            } else if c == "-" || c == "." || c.isNumber {
                var j = i
                if chars[j] == "-" { j += 1 }
                var seenDot = false
                while j < chars.count {
                    if chars[j].isNumber { j += 1 } else if chars[j] == ".", !seenDot { seenDot = true; j += 1 } else { break }
                }
                tokens.append(.number(CGFloat(Double(String(chars[i..<j])) ?? 0)))
                i = j
            } else {
                i += 1
            }
        }
        var cursor = 0
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var command: Character = "M"
        func number() -> CGFloat? {
            if cursor < tokens.count, case .number(let v) = tokens[cursor] { cursor += 1; return v }
            return nil
        }
        func hasNumber() -> Bool {
            if cursor < tokens.count, case .number = tokens[cursor] { return true }
            return false
        }
        while cursor < tokens.count {
            if case .command(let c) = tokens[cursor] { command = c; cursor += 1 }
            let relative = command.isLowercase
            switch command.uppercased() {
            case "M":
                guard let x = number(), let y = number() else { return path }
                current = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                start = current
                path.move(to: current)
                lastControl = nil
                // Further pairs are implicit line-tos.
                command = relative ? "l" : "L"
            case "L":
                guard let x = number(), let y = number() else { return path }
                current = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                path.addLine(to: current)
                lastControl = nil
            case "H":
                guard let x = number() else { return path }
                current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                guard let y = number() else { return path }
                current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: current)
                lastControl = nil
            case "C":
                guard let x1 = number(), let y1 = number(), let x2 = number(), let y2 = number(), let x = number(), let y = number() else { return path }
                let o = relative ? current : .zero
                let c1 = CGPoint(x: o.x + x1, y: o.y + y1)
                let c2 = CGPoint(x: o.x + x2, y: o.y + y2)
                let end = CGPoint(x: o.x + x, y: o.y + y)
                path.addCurve(to: end, control1: c1, control2: c2)
                lastControl = c2
                current = end
            case "S":
                guard let x2 = number(), let y2 = number(), let x = number(), let y = number() else { return path }
                let o = relative ? current : .zero
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = CGPoint(x: o.x + x2, y: o.y + y2)
                let end = CGPoint(x: o.x + x, y: o.y + y)
                path.addCurve(to: end, control1: c1, control2: c2)
                lastControl = c2
                current = end
            case "Z":
                path.closeSubpath()
                current = start
                lastControl = nil
            default:
                return path
            }
        }
        return path
    }

    private enum Token {
        case command(Character)
        case number(CGFloat)
    }
}
