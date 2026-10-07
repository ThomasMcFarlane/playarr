import PlayarrKit
import SwiftUI

/// The detail panels of the Preferences page (web `/settings/<section>`), laid out from the web TV's measured
/// geometry on a 1920x1080 canvas (absolute x/y of each element, panel column at x 773.8).
struct TVSettingsPanel: View {
    var section: Int
    @Environment(TVAppEnvironment.self) private var environment
    @State private var avatarOverride: String?

    private typealias Stage = DesignTokens.Stage
    private var ink: Color { Stage.ink }
    private var soft: Color { Stage.inkSoft }
    private var muted: Color { Stage.inkMuted }
    private let left: CGFloat = 773.8

    var body: some View {
        ZStack(alignment: .topLeading) {
            switch section {
            case 1: avatar
            case 2: language
            case 3: player
            case 4: server
            case 5: lock
            case 6: invite
            case 7: latency
            case 8: remote
            case 9: yourData
            default: EmptyView()
            }
        }
        .frame(width: 1920, height: 1080, alignment: .topLeading)
    }

    // MARK: Building blocks

    /// Chrome snaps box edges to device pixels: x rounds to nearest, y rounds half down (a 396.5 edge draws at 396).
    private func snap(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
        let x0 = x.rounded(), x1 = (x + w).rounded()
        let y0 = ceil(y - 0.5), y1 = ceil(y + h - 0.5)
        return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
    }

    private func text(
        _ string: String, x: CGFloat, y: CGFloat, w: CGFloat? = nil, h: CGFloat, size: CGFloat, css: CGFloat,
        color: Color, tracking: CGFloat = 0, mono: Bool = false, lines: Int = 1, lineHeight: CGFloat? = nil,
        alignment: Alignment = .leading
    ) -> some View {
        let font = mono ? TVTheme.mono(size: size, css: css) : TVTheme.font(size: size, css: css)
        let natural = TVFontLoader.uiFont(mono: mono, size: size, weight: css).lineHeight
        return Text(string)
            .font(font)
            .tracking(tracking)
            .lineSpacing(max(0, (lineHeight ?? natural) - natural))
            .foregroundStyle(color)
            .lineLimit(lines)
            .multilineTextAlignment(alignment == .center ? .center : .leading)
            .padding(.top, lines > 1 ? max(0, ((lineHeight ?? natural) - natural) / 2) : 0)
            .frame(width: w, height: h, alignment: lines > 1 ? .topLeading : alignment)
            .offset(x: x, y: y)
    }

    private func label(_ string: String, y: CGFloat, w: CGFloat = 995) -> some View {
        text(string.uppercased(), x: left, y: y, w: w, h: 16.8, size: 11.2, css: 720, color: muted, tracking: 0.896)
    }

    private func heading(_ string: String, y: CGFloat) -> some View {
        text(string, x: left, y: y, w: 995, h: 33.7, size: 22.464, css: 700, color: ink)
    }

    private func muted19(_ string: String, y: CGFloat, lines: Int = 1) -> some View {
        text(string, x: left, y: y, w: 995, h: lines == 1 ? 28.8 : 57.6, size: 19.2, css: 400, color: muted, lines: lines, lineHeight: 28.8)
    }

    private func hint(_ string: String, y: CGFloat, w: CGFloat = 995) -> some View {
        text(string, x: left, y: y, w: w, h: 18.7, size: 12.48, css: 400, color: muted)
    }

    private func box(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, fill: Color, border: Color?, radius: CGFloat = 0) -> some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(fill)
            .overlay {
                if let border {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(border, lineWidth: 1)
                }
            }
            .frame(width: snap(x, y, w, h).width, height: snap(x, y, w, h).height)
            .offset(x: snap(x, y, w, h).minX, y: snap(x, y, w, h).minY)
    }

    private func pill(_ title: String, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, primary: Bool, opacity: Double = 1) -> some View {
        ZStack {
            Capsule().fill(primary ? Stage.accent : Stage.surface)
            if !primary { Capsule().strokeBorder(Stage.cellBorder, lineWidth: 1) }
            Text(title)
                .font(TVTheme.font(size: h >= 50 ? 14.72 : 11.52, css: 720))
                .tracking(h >= 50 ? 0.147 : 0.115)
                .foregroundStyle(primary ? Stage.onAccent : soft)
        }
        .frame(width: snap(x, y, w, h).width, height: snap(x, y, w, h).height)
        .opacity(opacity)
        .offset(x: snap(x, y, w, h).minX, y: snap(x, y, w, h).minY)
    }

    private func field(_ placeholder: String, value: String? = nil, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat = 62) -> some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(Stage.fieldFill)
            Rectangle().strokeBorder(Stage.fieldBorder, lineWidth: 1)
            Text(value ?? placeholder)
                .font(TVTheme.font(size: 19.2, css: 400))
                .foregroundStyle(value == nil ? muted : ink)
                .padding(.leading, 17.2)
        }
        .frame(width: snap(x, y, w, h).width, height: snap(x, y, w, h).height)
        .offset(x: snap(x, y, w, h).minX, y: snap(x, y, w, h).minY)
    }

    private func choiceBox(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, selected: Bool, radius: CGFloat, bar: CGFloat = 3) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return shape
            .fill(selected ? Stage.brandPink.opacity(0.12) : Color.clear)
            .background(shape.fill(Stage.surface))
            .overlay(shape.strokeBorder(selected ? Stage.brandPink : Stage.cellBorder, lineWidth: 1))
            .overlay(alignment: .leading) {
                if selected { Rectangle().fill(Stage.brandPink).frame(width: bar) }
            }
            .clipShape(shape)
            .frame(width: snap(x, y, w, h).width, height: snap(x, y, w, h).height)
            .offset(x: snap(x, y, w, h).minX, y: snap(x, y, w, h).minY)
    }

    // MARK: 02 Profile avatar

    private static let presets = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"]

    private var avatar: some View {
        let frames: [(CGFloat, CGFloat)] = [(959.3 - 185.5, 210), (959.3, 210), (1144.8, 210), (1330.3, 210), (773.8, 395.5), (959.3, 395.5)]
        let current = avatarOverride ?? environment.currentAvatarPreset
            ?? Self.presets[TVProfileAvatar.presetIndex(for: environment.currentUserID)]
        return ZStack(alignment: .topLeading) {
            ForEach(Array(Self.presets.enumerated()), id: \.offset) { index, preset in
                let active = preset == current
                let side: CGFloat = active ? 173.3 : 163.5
                let origin = frames[index]
                let centreX = origin.0 + 163.5 / 2
                let centreY = origin.1 + 163.5 / 2
                Button {
                    avatarOverride = preset
                    Task {
                        _ = try? await environment.apiClient.updateProfileAvatar(
                            UpdateProfileAvatarRequest(preference: ProfileAvatarPreference(kind: .preset, value: preset))
                        )
                        await environment.refreshShellState()
                    }
                } label: {
                    ZStack {
                        if active {
                            Circle().strokeBorder(Stage.brandPink, lineWidth: 2)
                        }
                        TVProfileAvatar(userID: environment.currentUserID, size: active ? 154.2 : 145.5, presetName: preset)
                    }
                    .frame(width: side, height: side)
                }
                .buttonStyle(TVFocusableCardButtonStyle())
                .focusable(!TVParityLaunch.frozen)
                .frame(width: side, height: side)
                .offset(x: centreX - side / 2, y: centreY - side / 2)
            }
            text(
                "Custom photo selection is not available here, but a photo already saved to your profile will still appear.",
                x: left, y: 591.4, w: 995, h: 28.8, size: 19.2, css: 400, color: muted
            )
        }
    }

    // MARK: 03 Language

    private var language: some View {
        let name = Locale.current.localizedString(forLanguageCode: Locale.current.language.languageCode?.identifier ?? "en") ?? "English"
        return ZStack(alignment: .topLeading) {
            box(x: left, y: 210, w: 168, h: 48, fill: Stage.bg, border: Stage.controlBorder)
            Image(systemName: "globe")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(soft)
                .frame(width: 16, height: 16)
                .offset(x: 793.1, y: 226)
            text("Auto", x: 818.7, y: 225.4, w: 82, h: 17.3, size: 11.52, css: 720, color: ink)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(muted)
                .frame(width: 12, height: 12)
                .offset(x: 910.4, y: 228)
            hint("Playarr detected \(name) from this device. Choose a language above to override it.", y: 288.2)
        }
    }

    // MARK: 04 Player

    private static let tiers: [(String, String, [Int])] = [
        ("UHD", "2160p", [12, 20, 35]), ("FHD", "1080p", [4, 8, 12]), ("HD", "720p", [2, 4, 6]), ("SD", "480p", [1, 2, 3]),
    ]

    private var player: some View {
        let columns: [(String, CGFloat)] = [("Low", 968.8), ("Medium", 1237.5), ("High", 1506.1)]
        return ZStack(alignment: .topLeading) {
            Group {
            text("Default quality", x: left, y: 210, w: 995, h: 39.6, size: 26.4, css: 560, color: ink, tracking: -0.8)
            text("Start playback at this quality when the server can provide it.", x: left, y: 255.2, w: 995, h: 20.3, size: 13.12, css: 400, color: muted)
            choiceBox(x: left, y: 295, w: 995, h: 60, selected: true, radius: 10)
            text("Original", x: 784.7, y: 307.7, w: 200, h: 18.7, size: 12.48, css: 700, color: ink)
            text("Best available source", x: 784.7, y: 328.3, w: 300, h: 13.9, size: 9.28, css: 400, color: muted)
            text("\u{2713}", x: 1741.8, y: 316.1, w: 16, h: 17.8, size: 11.84, css: 400, color: Stage.brandPink)
            }
            Group {
            ForEach(columns, id: \.0) { column in
                text(column.0.uppercased(), x: column.1, y: 363, w: 262.6, h: 27.5, size: 10.24, css: 760, color: muted, tracking: 0.8192, alignment: .center)
            }
            ForEach(Array(Self.tiers.enumerated()), id: \.offset) { row, tier in
                let top = 396.5 + CGFloat(row) * 66
                text(tier.0, x: 777.8, y: top + 13, w: 181.1, h: 18.2, size: 12.16, css: 760, color: ink)
                text(tier.1, x: 777.8, y: top + 33.1, w: 181.1, h: 13.9, size: 9.28, css: 400, color: muted)
                ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
                    choiceBox(x: column.1, y: top, w: 262.6, h: 60, selected: false, radius: 10)
                    text("\(tier.2[index]) Mbps", x: column.1 + 11, y: top + 12.7, w: 200, h: 18.7, size: 12.48, css: 700, color: soft)
                    text(column.0, x: column.1 + 11, y: top + 33.3, w: 200, h: 13.9, size: 9.28, css: 400, color: muted)
                }
            }
            }
            Group {
            text("Default subtitles", x: left, y: 716, w: 995, h: 39.6, size: 26.4, css: 560, color: ink, tracking: -0.8)
            text("Keep subtitles off, show forced dialogue only, or turn them on automatically.", x: left, y: 761.2, w: 995, h: 20.3, size: 13.12, css: 400, color: muted)
            ForEach(Array(["Off", "Forced only", "Always on"].enumerated()), id: \.offset) { index, title in
                let x = left + CGFloat(index) * 251.7
                choiceBox(x: x, y: 800.9, w: 239.7, h: 68, selected: index == 0, radius: 0, bar: 4)
                text(title, x: x + 15.3, y: 824.4, w: 209, h: 21.1, size: 14.08, css: 700, color: index == 0 ? ink : soft)
            }
            }
            Group {
            text("Default audio track", x: left, y: 930.4, w: 995, h: 39.6, size: 26.4, css: 560, color: ink, tracking: -0.8)
            text("Prefer this audio language whenever a matching track is available.", x: left, y: 975.6, w: 995, h: 20.3, size: 13.12, css: 400, color: muted)
            ForEach(Array([("English", "en"), ("Spanish", "es")].enumerated()), id: \.offset) { index, item in
                let x = left + CGFloat(index) * 503.4
                choiceBox(x: x, y: 1015.4, w: 491.5, h: 62, selected: index == 0, radius: 0, bar: 4)
                text(item.0, x: x + 17, y: 1035.3, w: 300, h: 22.1, size: 14.72, css: 680, color: index == 0 ? ink : soft)
                text(item.1, x: x + 491.5 - 17 - 12.6, y: 1037, w: 40, h: 13.9, size: 9.28, css: 720, color: index == 0 ? Stage.brandPink : muted, tracking: 0.7424, mono: true)
            }
            }
        }
    }

    // MARK: 05 Server connection

    private var server: some View {
        let address = environment.serverURL.absoluteString
        return ZStack(alignment: .topLeading) {
            box(x: left, y: 210, w: 900, h: 100.9, fill: Stage.surface, border: Stage.fieldFill)
            Group {
            text("Playarr Server", x: 793.1, y: 227, w: 400, h: 28.8, size: 19.2, css: 700, color: ink)
            text(environment.profileName ?? "", x: 793.1, y: 259, w: 400, h: 15.8, size: 10.56, css: 400, color: muted)
            text(address, x: 793.1, y: 278, w: 400, h: 15.8, size: 10.56, css: 400, color: muted)
            ZStack {
                Rectangle().strokeBorder(Stage.fieldFill, lineWidth: 1)
                Text("PRIMARY").font(TVTheme.mono(size: 10.56, css: 400)).foregroundStyle(muted)
            }
            .frame(width: 67.1, height: 31.3)
            .offset(x: 1587.2, y: 244.8)
            }
            Group {
            label("Add another server", y: 341.1, w: 900)
            field("Server address or URL", x: left, y: 365.1, w: 399.5)
            field("", value: environment.profileName ?? "", x: 1174.3, y: 365.1, w: 199.8)
            field("Password", x: 1375, y: 365.1, w: 199.8)
            pill("Connect", x: 1575.8, y: 365.1, w: 98, h: 62, primary: true)
            hint("Credentials and requests go directly from this browser to that server.", y: 427.1, w: 900)
            }
            Group {
            pill("Test connection", x: left, y: 476, w: 114.6, h: 38, primary: false)
            hint("\(address) remains the primary server for profile and player preferences.", y: 544.3)
            Rectangle().fill(Stage.cellBorder).frame(width: 900, height: 1).offset(x: left, y: 592.2)
            text("\u{25B8}", x: left, y: 610.2, w: 12, h: 17.3, size: 9, css: 400, color: soft)
            text("TV app connection details", x: left + 12.4, y: 610.2, w: 600, h: 17.3, size: 11.52, css: 720, color: soft)
            }
        }
    }

    // MARK: 06 Profile lock

    private var lock: some View {
        ZStack(alignment: .topLeading) {
            label("New PIN", y: 210, w: 420)
            field("", x: left, y: 234, w: 325.2)
            ForEach(0..<4, id: \.self) { dot in
                Circle().fill(muted).frame(width: 8, height: 8).offset(x: 789 + CGFloat(dot) * 18.2, y: 261)
            }
            pill("Set PIN", x: 1099.9, y: 234, w: 93.8, h: 62, primary: true, opacity: 0.45)
            muted19("PIN lock is off.", y: 329.8)
        }
    }

    // MARK: 07 Invite a friend

    private var invite: some View {
        ZStack(alignment: .topLeading) {
            muted19("You have not requested an invite yet.", y: 210)
            label("Who is this for, and what should they have access to? (optional)", y: 269)
            box(x: left, y: 285.8, w: 995, h: 62, fill: Color.clear, border: Stage.inputBorder)
            text("For example: For Sam \u{2014} films and television series, please.", x: left + 17, y: 292, w: 900, h: 18.7, size: 12.48, css: 400, color: muted)
            pill("Request invite QR", x: left, y: 391, w: 995, h: 58, primary: true)
            pill("Enable approval notifications", x: left, y: 479.3, w: 187.3, h: 38, primary: false)
        }
    }

    // MARK: 08 Request latency

    private var latency: some View {
        ZStack(alignment: .topLeading) {
            Circle().fill(Stage.surface.opacity(0.54)).frame(width: 164, height: 164).offset(x: 901.1, y: 210)
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Stage.brandPink, lineWidth: 3.5)
                    .frame(width: 66, height: 40)
                ForEach(0..<3, id: \.self) { line in
                    Capsule().fill(Stage.brandPink).frame(width: line == 2 ? 24 : 38, height: 3.5)
                        .offset(x: line == 2 ? -14 : -7, y: CGFloat(line - 1) * 9 - 2)
                }
            }
            .frame(width: 70, height: 46.7)
            .offset(x: 948.1, y: 268.7)
            text("Admins only", x: 1107.1, y: 255.7, w: 219.3, h: 33.1, size: 22.08, css: 650, color: ink, tracking: -0.4416)
            text("Sign in with an admin account to see per-route request latency.", x: 1107.1, y: 296, w: 219.3, h: 32.3, size: 10.752, css: 400, color: muted, lines: 2, lineHeight: 16.1)
        }
    }

    // MARK: 09 Phone remote

    private func checkbox(checked: Bool, x: CGFloat, y: CGFloat) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(checked ? Stage.checkFill : Stage.checkOffFill)
                .overlay(RoundedRectangle(cornerRadius: 2.5, style: .continuous).strokeBorder(checked ? Color.clear : Stage.checkOffBorder, lineWidth: 1))
            if checked {
                Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Stage.checkMark)
            }
        }
        .frame(width: 15, height: 15)
        .offset(x: x, y: y)
    }

    private var remote: some View {
        ZStack(alignment: .topLeading) {
            heading("This device", y: 210)
            checkbox(checked: true, x: 776, y: 280.5)
            text("Allow my other devices to control this one", x: 805.8, y: 273.9, w: 600, h: 28.8, size: 19.2, css: 400, color: ink)
            hint("Devices must be signed in to your account, and you approve every pairing on this screen.", y: 333)
            heading("Control another device", y: 447.7)
            muted19("No other devices are available. Turn on remote control on the other device first.", y: 511.6)
            heading("Paired remotes", y: 666.7)
            muted19("No remotes are paired.", y: 730.6)
        }
    }

    // MARK: 10 Your data

    private var yourData: some View {
        ZStack(alignment: .topLeading) {
            Group {
            heading("Export my data", y: 210)
            muted19(
                "Creates one ZIP with your watch progress, personal playlists (in order) and audio-language preference. Open the CSV files in a spreadsheet, or keep the file to import elsewhere.",
                y: 273.9, lines: 2
            )
            hint("The file contains only this profile's data. It never contains passwords, tokens, file paths, other people's activity or the media itself.", y: 361.8)
            pill("Prepare my data", x: left, y: 410.7, w: 155.2, h: 58, primary: true)
            }
            Group {
            heading("Import data", y: 564.7)
            muted19(
                "Choose a Playarr export. You will see what it would change before anything is saved. Nothing is deleted, and your account, permissions and other profiles are never touched.",
                y: 628.7, lines: 2
            )
            pill("Upload from another device", x: left, y: 716.5, w: 232.9, h: 58, primary: true)
            }
            Group {
            label("If progress already exists", y: 804.7)
            box(x: left, y: 822, w: 995, h: 62, fill: Color.clear, border: Stage.inputBorder)
            text("Keep whichever is newer", x: left + 17, y: 843, w: 500, h: 17.3, size: 11.52, css: 700, color: ink)
            Image(systemName: "chevron.down")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(ink)
                .offset(x: 1759, y: 848)
            checkbox(checked: false, x: left, y: 921)
            text("ALSO APPLY MY AUDIO-LANGUAGE PREFERENCE", x: left + 23, y: 920.9, w: 700, h: 21.8, size: 11.2, css: 720, color: muted, tracking: 0.896)
            pill("Preview import", x: left, y: 980.2, w: 147.2, h: 58, primary: false, opacity: 0.55)
            }
        }
    }
}
