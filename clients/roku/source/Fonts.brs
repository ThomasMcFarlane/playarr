' Fonts.brs
'
' Web typeface for SceneGraph labels. The web client draws every label in Nunito Sans (weights 300 to 800) and a few
' figures in JetBrains Mono. Roku cannot take a variable font, so pkg:/fonts holds static instances cut from
' docs/parity/fonts (fontTools varLib.instancer at wght=300/400/500/600/700/800 for Nunito Sans, 400/700 for
' JetBrains Mono). They are attached from BrightScript through the documented Font node (uri + size). A Font child
' declared in the component XML renders no text on the device; this route does (verified on a Streaming Stick 4K).
'
' Labels in the XML keep their historic `scale` (size N drawn as scale N/32 of the system font). PlayarrFontifyTree turns
' that into a real font of size N with the geometry the scale produced (scale about scaleRotateCenter), so the glyphs are
' rasterised at their final size instead of being stretched.

function PlayarrFontPath(weight as Integer, mono = false as Boolean) as String
    if mono
        if weight >= 600 then return "pkg:/fonts/JetBrainsMono-700.ttf"
        return "pkg:/fonts/JetBrainsMono-400.ttf"
    end if
    w = 400
    if weight <= 340
        w = 300
    else if weight <= 450
        w = 400
    else if weight <= 550
        w = 500
    else if weight <= 650
        w = 600
    else if weight <= 750
        w = 700
    else
        w = 800
    end if
    return "pkg:/fonts/NunitoSans-" + w.ToStr() + ".ttf"
end function

function PlayarrMakeFont(weight as Integer, size as Integer, mono = false as Boolean) as Object
    key = "playarrFont_" + weight.ToStr() + "_" + size.ToStr() + "_" + mono.ToStr()
    g = GetGlobalAA()
    if g[key] <> invalid then return g[key]
    font = CreateObject("roSGNode", "Font")
    font.uri = PlayarrFontPath(weight, mono)
    font.size = size
    g[key] = font
    return font
end function

' Weight for a label id (web weights, see global.css). Unknown ids use 400, and big display text 700.
function PlayarrWeightFor(id as String, size as Integer) as Integer
    if id = "stageTitleLabel" or id = "browsePreviewTitle" or id = "browseTitle" then return 600
    if id = "browseCountLabel" then return 700
    if id = "stageMetaLabel" or id = "stageOverviewLabel" then return 400
    if id = "browsePreviewMeta" or id = "browsePreviewOverview" then return 400
    if id = "browseFiltersButton" then return 700
    if id = "title" then return 600
    if Instr(1, id, "Kicker") > 0 then return 800
    if Instr(1, id, "Title") > 0 then return 700
    if Instr(1, id, "Heading") > 0 then return 700
    if Instr(1, id, "navLabel") = 1 then return 600
    if Instr(1, id, "clockTime") = 1 then return 700
    if Instr(1, id, "profileLabel") = 1 then return 600
    if Instr(1, id, "ButtonLabel") > 0 then return 700
    if Instr(1, id, "Code") > 0 then return 700
    if size >= 40 then return 700
    return 400
end function

function PlayarrIsMonoLabel(id as String) as Boolean
    return id = "pairingCode"
end function

' Replace a label's scale by a font of the same visual size. `weight` < 0 picks from the id.
sub PlayarrFontifyLabel(label as Object, weight = -1 as Integer)
    s = label.scale
    sx = 1.0
    if s <> invalid then sx = s[0]
    if sx = 1 then return
    size = Int(32 * sx + 0.5)
    if weight < 0 then weight = PlayarrWeightFor(label.id, size)
    c = label.scaleRotateCenter
    t = label.translation
    w = label.width
    x = t[0] + c[0] * (1 - sx)
    newW = Int(w * sx + 0.5)
    ' A centred, single-line label scaled about its horizontal middle keeps its box: the text stays centred on the same
    ' point, and code that repositions such labels at run time keeps working.
    if label.horizAlign = "center" and not label.wrap and Abs(c[0] - w / 2) < 1
        x = t[0]
        newW = w
    end if
    label.translation = [x, t[1] + c[1] * (1 - sx)]
    label.width = newW
    label.height = Int(label.height * sx + 0.5)
    if label.lineSpacing <> 0 then label.lineSpacing = Int(label.lineSpacing * sx + 0.5)
    label.scale = [1, 1]
    label.scaleRotateCenter = [0, 0]
    label.font = PlayarrMakeFont(weight, size, PlayarrIsMonoLabel(label.id))
end sub

sub PlayarrFontifyTree(node as Object)
    n = node.getChildCount()
    for i = 0 to n - 1
        child = node.getChild(i)
        if child = invalid then continue for
        if child.subtype() = "Label"
            PlayarrFontifyLabel(child)
        else
            PlayarrFontifyTree(child)
        end if
    end for
end sub
