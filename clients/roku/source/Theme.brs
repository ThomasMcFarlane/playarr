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
' Roku SceneGraph has no concept of light/dark OS theme -- TV apps default to
' a single dark presentation, so this file only ports the DARK theme values
' from global.css (`:root[data-theme="dark"]`), not the default (light)
' `:root` block.

function Theme() as object
    return {
        colors: {
            ' from: :root[data-theme="dark"] --bg: #151315
            bg: &h151315FF
            ' from: :root[data-theme="dark"] --surface: #1b181b
            surface: &h1B181BFF
            ' from: :root[data-theme="dark"] --surface-strong: #211d21
            surfaceStrong: &h211D21FF
            ' from: :root[data-theme="dark"] --surface-soft: #312a30 (bonus: needed for
            ' TvStage's stacked-Rectangle scrim approximation of the CSS gradients)
            surfaceSoft: &h312A30FF
            ' from: :root[data-theme="dark"] --ink: #f4f0f1
            ink: &hF4F0F1FF
            ' from: :root[data-theme="dark"] --ink-soft: #c5b8bd
            inkSoft: &hC5B8BDFF
            ' from: :root[data-theme="dark"] --ink-muted: #887a82
            inkMuted: &h887A82FF
            ' from: .tv-provider / .tv-detail-kicker color, and .player-page
            ' --player-accent: #cf3157 (Playarr's own red identity/kicker highlight --
            ' NOT the same as the generic dark-theme --accent: #dfdcdd, which is used
            ' for lower-emphasis UI chrome. Roku uses this narrow "kicker/highlight" role.)
            accent: &hCF3157FF
            ' from: :root[data-theme="dark"] --danger: #ee9297
            danger: &hEE9297FF
            ' from: :root[data-theme="dark"] --success: #7fc09d
            success: &h7FC09DFF
            ' from: .player-page --player-accent: #cf3157
            playerAccent: &hCF3157FF
        }

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
