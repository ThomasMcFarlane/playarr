' Theme.brs
'
' Shared design-token constants ported from the tv-web ("Playarr") React app
' so the Roku channel can visually match it wherever SceneGraph allows.
'
' Sources read to produce these values:
'   - clients/tv-web/packages/design-tokens/src/index.ts (spacing, type scale, radius, focusMotion)
'   - clients/tv-web/web/src/styles/global.css, `:root[data-theme="dark"]` block (colors)
'   - clients/tv-web/web/src/styles/global.css, `.tv-*` stage rules (screenX/screenY/headerHeight,
'     which reuse the same clamp() formulas as `--screen-x`/`--screen-y`/`--header-height`)
'
' Roku's canvas is fixed at 1920x1080 (manifest ui_resolutions=fhd), so every
' vw/vh/clamp() fluid CSS value below has been evaluated at a 1920x1080
' viewport and baked down to a fixed pixel int. The formula used for each is
' left in a comment next to the value so it can be re-derived if the web
' tokens change.
'
' Both palettes of global.css are ported: `:root` (light) and `:root[data-theme="dark"]`. Roku has no OS
' appearance API, so the preference (System, Light, Dark) is stored in the registry (PairingPrefs.brs) and "System"
' resolves to dark. ThemeTokens(mode) returns the palette; ThemeApplyTree recolours the authored (dark) literals.

function ThemeTokens(mode as String) as Object
    if mode = "light"
        return {
            ' :root --bg, --surface, --surface-strong, --surface-soft, --ink, --ink-soft, --ink-muted
            bg: &hF5F3F2FF
            surface: &hFBFAF9FF
            surfaceStrong: &hFFFFFFFF
            surfaceSoft: &hDFDCDDFF
            ink: &h382621FF
            inkSoft: &h675961FF
            inkMuted: &hA5969EFF
            ' --accent, --accent-soft, --on-accent
            accent: &h675961FF
            accentSoft: &hC5B8BDFF
            onAccent: &hFFFFFFFF
            ' --danger, --success
            danger: &hA8464CFF
            success: &h347559FF
            ' --line rgba(56,38,33,.14), --line-strong rgba(56,38,33,.28)
            line: &h38262124
            lineStrong: &h38262147
            ' Brand red (.tv-provider kicker, unwatched dot, player accent): the same in both themes.
            brand: &hCF3157FF
            ' Focus ring: ink in light, literal white in dark (owner ruling).
            focusRing: &h382621FF
            ' Right-hand content panel of the page shell (--surface blended with --surface-soft).
            panel: &hEFEEEEFF
            ' Status chip tint (.calendar-badge): rgba(91,127,209,.24), the same in both themes.
            statusTint: &h5B7FD13D
            ' Player chrome is the same over video in both themes: white ink on a dark scrim (global.css .player-*).
            playerInk: &hFFFFFFFF
            playerMuted: &hFFFFFF8A
            playerPanel: &h120E11E6
            playerTint: &hFFFFFF0E
            playerButton: &hFFFFFF24
            playerSelected: &hCF315738
            playerPill: &h0C0A0B94
            playerTrack: &hFFFFFF33
            playerBuffered: &hFFFFFF57
            playerSeparator: &h776B71FF
            playerScrim: &h000000EB
        }
    end if
    return {
        bg: &h151315FF
        surface: &h1B181BFF
        surfaceStrong: &h211D21FF
        surfaceSoft: &h312A30FF
        ink: &hF4F0F1FF
        inkSoft: &hC5B8BDFF
        inkMuted: &h887A82FF
        accent: &hDFDCDDFF
        accentSoft: &h675961FF
        onAccent: &h211D21FF
        danger: &hEE9297FF
        success: &h7FC09DFF
        ' --line rgba(223,220,221,.11), --line-strong rgba(223,220,221,.23)
        line: &hDFDCDD1C
        lineStrong: &hDFDCDD3B
        brand: &hCF3157FF
        focusRing: &hFFFFFFFF
        panel: &h282227FF
        statusTint: &h5B7FD13D
        ' Player chrome is the same over video in both themes: white ink on a dark scrim (global.css .player-*).
        playerInk: &hFFFFFFFF
        playerMuted: &hFFFFFF8A
        playerPanel: &h120E11E6
        playerTint: &hFFFFFF0E
        playerButton: &hFFFFFF24
        playerSelected: &hCF315738
        playerPill: &h0C0A0B94
        playerTrack: &hFFFFFF33
        playerBuffered: &hFFFFFF57
        playerSeparator: &h776B71FF
        playerScrim: &h000000EB
    }
end function

' Colour of a token (role) with an alpha byte, for the active theme (m.global.themeMode).
function ThemeColor(role as String, alpha = -1 as Integer) as Integer
    mode = "dark"
    if m.global <> invalid and m.global.themeMode <> invalid then mode = m.global.themeMode
    colour = ThemeTokens(mode)[role]
    if alpha >= 0 then colour = ThemeWithAlpha(colour, alpha)
    return colour
end function

function ThemeWithAlpha(rgba as Integer, alpha as Integer) as Integer
    ' &hRRGGBBAA: keep the colour bytes, replace the alpha byte.
    return (rgba and &hFFFFFF00) or alpha
end function

' Authored (dark) literal -> token. The XML and the few literals in BrightScript were written for the dark theme;
' ThemeApplyTree resolves each one through this table, so a node follows the active theme.
function ThemeRoleForLiteral(rgb as String) as String
    roles = {
        "151315": "bg"
        "0B0A0B": "bg"
        "1B181B": "surface"
        "211D21": "surfaceStrong"
        "262126": "surfaceStrong"
        "312A30": "surfaceSoft"
        "2A262C": "surfaceSoft"
        "3A343C": "surfaceSoft"
        "F4F0F1": "ink"
        "DCE5F0": "ink"
        "C5B8BD": "inkSoft"
        "A9B7C9": "inkSoft"
        "887A82": "inkMuted"
        "5C6B80": "inkMuted"
        "EE9297": "danger"
        "7FC09D": "success"
        "CF3157": "brand"
    }
    role = roles[rgb]
    if role = invalid then return ""
    return role
end function

function ThemeHex2(value as Integer) as String
    return Right("0" + StrI(value and 255, 16), 2)
end function

' Split an authored colour into "RRGGBB" and its alpha byte.
function ThemeSplitLiteral(rgba as Integer) as Object
    r = (rgba >> 24) and 255
    g = (rgba >> 16) and 255
    b = (rgba >> 8) and 255
    a = rgba and 255
    return { rgb: UCase(ThemeHex2(r) + ThemeHex2(g) + ThemeHex2(b)), alpha: a }
end function

' Remember which token a node's colour field stands for (once, from its authored dark literal).
sub ThemeBindRole(node as Object, field as String, whiteIsInk = false as Boolean)
    if not node.hasField("themeRole")
        node.addFields({ themeRole: "" })
    end if
    if node.themeRole <> "" then return
    parts = ThemeSplitLiteral(node[field])
    role = ThemeRoleForLiteral(parts.rgb)
    if role = "" and whiteIsInk and parts.rgb = "FFFFFF" then role = "ink"
    if role = "" then
        node.themeRole = "-"
    else
        node.themeRole = role + ":" + parts.alpha.ToStr()
    end if
end sub

' Explicitly bind a node field to a token (images tinted through blendColor, runtime-built nodes).
sub ThemeSetRole(node as Object, role as String, alpha = -1 as Integer)
    if not node.hasField("themeRole") then node.addFields({ themeRole: "" })
    node.themeRole = role + ":" + alpha.ToStr()
end sub

sub ThemeApplyNode(node as Object, tokens as Object)
    if not node.hasField("themeRole") then return
    spec = node.themeRole
    if spec = "" or spec = "-" then return
    sep = Instr(1, spec, ":")
    role = Left(spec, sep - 1)
    alpha = Val(Mid(spec, sep + 1), 10)
    colour = tokens[role]
    if alpha >= 0 then colour = ThemeWithAlpha(colour, alpha)
    kind = node.subtype()
    if kind = "Poster"
        node.blendColor = colour
    else
        node.color = colour
    end if
end sub

' Recolour a subtree for `mode`. Labels and Rectangles are bound on first sight; Posters only when ThemeSetRole bound them.
sub ThemeApplyTree(root as Object, mode as String)
    tokens = ThemeTokens(mode)
    ThemeApplyWalk(root, tokens)
end sub

sub ThemeApplyWalk(node as Object, tokens as Object)
    kind = node.subtype()
    if kind = "Label"
        ThemeBindRole(node, "color", true)
        ThemeApplyNode(node, tokens)
    else if kind = "Rectangle"
        ThemeBindRole(node, "color")
        ThemeApplyNode(node, tokens)
    else if kind = "Poster"
        ThemeApplyNode(node, tokens)
    end if
    n = node.getChildCount()
    for i = 0 to n - 1
        child = node.getChild(i)
        if child <> invalid then ThemeApplyWalk(child, tokens)
    end for
end sub

' Components that are instantiated by the scene or by a list (PosterCard, TvStage, ProfileAvatar) follow the scene's theme.
sub ThemeInitComponent()
    ThemeApplyTree(m.top, m.global.themeMode)
    m.global.observeField("themeMode", "onGlobalThemeChanged")
end sub

sub onGlobalThemeChanged()
    ThemeApplyTree(m.top, m.global.themeMode)
end sub

function Theme() as object
    return {
        colors: ThemeTokens("dark")

        spacing: {
            ' from: design-tokens spacing scale (packages/design-tokens/src/index.ts)
            none: 0
            xs: 4
            sm: 8
            md: 16
            lg: 24
            xl: 32
            xxl: 48
            xxxl: 64
        }

        ' Typeface: the web draws everything in Nunito Sans. Roku cannot load a variable font, so static instances
        ' (wght 300/400/500/600/700/800, cut from docs/parity/fonts/NunitoSans-wght-web.ttf with fontTools
        ' varLib.instancer) and JetBrains Mono 400/700 live in pkg:/fonts. source/Fonts.brs attaches them from
        ' BrightScript through the documented Font node (`uri` + `size`), which renders text correctly on the device
        ' (OS 15.3.4, Streaming Stick 4K). A `<Font role="font"/>` child declared in the component XML does not (the
        ' label stays blank), so never declare one. Labels authored with a `scale` (size N = scale N/32) are converted by
        ' PlayarrFontifyTree at component init; labels created in code call PlayarrMakeFont(weight, size) directly.
        ' Roku has no letter-spacing, so the web's negative tracking on the hero title cannot be reproduced exactly.
        type: {
            ' from: typeScale.micro { fontSize: 11, lineHeight: 16, fontWeight: 400 }
            ' size 11 -> scale 0.34
            micro: { font: "font:MediumSystemFont", size: 11, lineHeight: 16 }
            ' from: typeScale.caption { fontSize: 12, lineHeight: 17, fontWeight: 400 }
            ' size 12 -> scale 0.38
            caption: { font: "font:MediumSystemFont", size: 12, lineHeight: 17 }
            ' from: typeScale.body { fontSize: 14, lineHeight: 20, fontWeight: 400 }
            ' size 14 -> scale 0.44
            body: { font: "font:MediumSystemFont", size: 14, lineHeight: 20 }
            ' from: typeScale.bodyEmphasis { fontSize: 14, lineHeight: 20, fontWeight: 700 }
            ' size 14 -> scale 0.44
            bodyEmphasis: { font: "font:MediumBoldSystemFont", size: 14, lineHeight: 20 }
            ' from: typeScale.subtitle { fontSize: 18, lineHeight: 26, fontWeight: 300 }
            ' (300 has no lighter-than-Medium Roku font, so it maps to Medium)
            ' size 18 -> scale 0.56
            subtitle: { font: "font:MediumSystemFont", size: 18, lineHeight: 26 }
            ' from: typeScale.title { fontSize: 24, lineHeight: 34, fontWeight: 700 }
            ' size 24 -> scale 0.75
            title: { font: "font:MediumBoldSystemFont", size: 24, lineHeight: 34 }
            ' from: typeScale.display { fontSize: 50, lineHeight: 71, fontWeight: 300 }
            ' (300 has no lighter-than-Medium Roku font, so it maps to Medium)
            ' size 50 -> scale 1.56
            display: { font: "font:MediumSystemFont", size: 50, lineHeight: 71 }
        }

        radius: {
            ' from: design-tokens radius.card = 3
            card: 3
            ' from: design-tokens radius.button = 4
            button: 4
            ' from: design-tokens radius.input = 4
            input: 4
            ' from: design-tokens radius.badge = 2
            badge: 2
            ' from: design-tokens radius.pill = 9999
            pill: 9999
            ' from: design-tokens radius.modal = 6
            modal: 6
        }

        ' from: global.css :root --screen-x: clamp(28px, 4.5vw, 92px)
        ' evaluated at 1920px width: 4.5vw = 86.4px -> clamp(28, 86.4, 92) = 86.4 -> 86px
        screenX: 86

        ' from: global.css :root --screen-y: clamp(24px, calc(3.5 * 1vh), 54px)
        ' evaluated at 1080px height: 3.5vh = 37.8px -> clamp(24, 37.8, 54) = 37.8 -> 38px
        screenY: 38

        ' from: global.css :root --header-height: clamp(78px, calc(8.5 * 1vh), 112px)
        ' evaluated at 1080px height: 8.5vh = 91.8px -> clamp(78, 91.8, 112) = 91.8 -> 92px
        headerHeight: 92

        ' from: design-tokens focusMotion { restScale: 1, focusScale: 1.08,
        ' transitionMs: 150, transitionEasing: "cubic-bezier(0.4, 0, 0.2, 1)" }
        '
        ' SceneGraph Animation/Vector2DFieldInterpolator nodes drive easing via a
        ' child `EaseFunction` node whose `type` field is restricted to a fixed set
        ' of built-in Robert Penner-style keywords (linear, inQuad/outQuad/inOutQuad,
        ' inCubic/outCubic/inOutCubic, inQuart/outQuart/inOutQuart, ... inBounce
        ' family) -- there is no way to author an arbitrary cubic-bezier() curve.
        ' The CSS curve cubic-bezier(0.4, 0, 0.2, 1) is the "Material standard"
        ' ease -- slow start, fast middle, gentle finish -- which "inOutCubic" is
        ' the closest built-in match for. If a future SDK check shows
        ' "inOutCubic" isn't accepted on this Roku OS floor, fall back to "linear"
        ' rather than failing silently.
        focusMotion: {
            restScale: 1
            focusScale: 1.08
            transitionMs: 150
            ' ideal (not renderable as-is on Roku): cubic-bezier(0.4, 0, 0.2, 1)
            easing: "inOutCubic"
        }
    }
end function
