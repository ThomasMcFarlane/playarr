sub init()
    PlayarrFontifyTree(m.top)
    ThemeSetRole(m.top.findNode("posterBg"), "surfaceSoft")
    for each id in ["cornerTL", "cornerTR", "cornerBL", "cornerBR"]
        ThemeSetRole(m.top.findNode(id), "surface")
    end for
    ThemeInitComponent()
    m.poster = m.top.findNode("poster")
    m.title = m.top.findNode("title")
    m.kind = m.top.findNode("kind")
    m.unwatchedBadge = m.top.findNode("unwatchedBadge")
    m.progressTrack = m.top.findNode("progressTrack")
    m.progressFill = m.top.findNode("progressFill")
    m.cardRoot = m.top.findNode("cardRoot")
    m.artGroup = m.top.findNode("artGroup")
    m.focusAnim = m.top.findNode("focusAnim")
    m.focusShadow = m.top.findNode("focusShadow")
    m.restShadow = m.top.findNode("restShadow")
    m.cardScaleValue = 1.0
    m.liftInterp = m.top.findNode("liftInterp")
    m.retryTimer = m.top.findNode("retryTimer")
    m.retryTimer.ObserveField("fire", "onPosterRetry")
    m.poster.ObserveField("loadStatus", "onPosterLoadStatus")
    m.posterUri = ""
    m.posterRetries = 0
    m.scaleInterp = m.top.findNode("scaleInterp")
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    m.title.text = content.title
    ' cardScale/showKind: MarkupGrid/RowList only ever bind the itemContent
    ' field on each item instance, there is no path for a screen to set an
    ' arbitrary custom interface field (cardScale/showKind) on every item
    ' component directly, so both travel on the content node itself instead,
    ' the same pattern activeRailFactor below already established.
    cardScale = 1
    if content.cardScale <> invalid then cardScale = content.cardScale
    m.cardScaleValue = cardScale
    layoutCard(cardScale)
    showKind = true
    if content.showKind <> invalid then showKind = content.showKind
    m.kind.visible = showKind
    if showKind
        kindText = CapitalizeFirst(content.kind)
        if content.year <> invalid and content.year <> "" then kindText = kindText + " · " + content.year
        if content.subtitleOverride <> invalid and content.subtitleOverride <> "" then kindText = content.subtitleOverride
        m.kind.text = kindText
    end if
    ' No per-item watched/unwatched state is threaded through from the
    ' catalog fetch yet (MainScene.brs's buildRailContent/buildGridContent
    ' don't carry it), so this always shows the badge. Confirmed live
    ' against the real app that "Unwatched" was in fact the aria-label on
    ' every single card observed, so defaulting to visible is the closer
    ' match of the two options available without deeper API work, not a
    ' guess: a documented simplification, not a bug.
    watchState = ""
    if content.watchState <> invalid then watchState = content.watchState
    m.unwatchedBadge.visible = watchState = "unseen"
    m.progressTrack.visible = watchState = "part"
    if watchState = "part"
        pct = 0
        if content.progressPct <> invalid then pct = content.progressPct
        fill = 220 * pct / 100
        if fill < 3 then fill = 3
        m.progressFill.width = fill
    end if
    agent = CreateObject("roHttpAgent")
    agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    agent.InitClientCertificates()
    ' Prefer global auth headers set by MainScene (survives MarkupGrid/RowList
    ' itemContent binding). Per-item artHeaders is a fallback only.
    g = GetGlobalAA()
    if g.playarrArtHeaders <> invalid
        agent.SetHeaders(g.playarrArtHeaders)
    else if content.artHeaders <> invalid
        agent.SetHeaders(content.artHeaders)
    end if
    m.poster.SetHttpAgent(agent)
    ' Library art is 4K: ask for a bitmap decoded at 2x the card (4K textures overflow the GPU budget and some fail to load).
    m.poster.loadWidth = Int(440 * cardScale)
    m.poster.loadHeight = Int(248 * cardScale)
    m.posterUri = content.hdPosterUrl
    m.posterRetries = 0
    m.retryTimer.control = "stop"
    m.poster.uri = content.hdPosterUrl
    ' A field literally named rowFocusPercent turned out to be reserved --
    ' RowList silently overwrites it on its own after content binds,
    ' confirmed live via debug-console tracing (a sibling rail's item would
    ' flip back to 1 moments after being built with 0, with no
    ' onContentChanged in between). Renamed to activeRailFactor, a name Roku
    ' has no special handling for, so MainScene's per-rail-active-or-not value
    ' (baked onto each item's content node at buildRailContent() time) is the
    ' only thing that ever writes it. Screens that never set it
    ' (MarkupGrid-based grids) get content.activeRailFactor = invalid, which
    ' must behave as a 1 (no-op multiplier), not the field's own 0 default.
    if content.activeRailFactor <> invalid
        m.top.activeRailFactor = content.activeRailFactor
    else
        m.top.activeRailFactor = 1
    end if
end sub

' Real SceneGraph Animation/FieldInterpolator nodes, not an instant property
' set -- tv-web's own focus transition (.tv-title-card / .tv-title-card-art)
' eases transform over 240-260ms, and Roku genuinely supports the same kind
' of tweened transition via Animation, this was just never wired up before.
' Mirrors tv-web exactly: the whole card lifts (translateY(-7px), no colour
' change -- there is no border/outline anywhere in the real CSS), while only
' the art zooms in a touch further (scale(1.025)).
sub onFocusChanged()
    effective = m.top.focusPercent * m.top.activeRailFactor
    shadowOpacity = effective
    if shadowOpacity > 1 then shadowOpacity = 1
    if shadowOpacity < 0 then shadowOpacity = 0
    m.focusShadow.opacity = shadowOpacity
    m.restShadow.opacity = 1 - shadowOpacity
    liftY = -cardFocusLift() * effective
    artScale = 1 + (effective * cardFocusScale())
    m.liftInterp.key = [0, 1]
    m.liftInterp.keyValue = [m.cardRoot.translation, [0, liftY]]
    m.scaleInterp.key = [0, 1]
    m.scaleInterp.keyValue = [m.artGroup.scale, [artScale, artScale]]
    m.focusAnim.control = "stop"
    m.focusAnim.control = "start"
end sub

' "movie"/"series"/"site"/"artist" (lowercase, straight from the API) ->
' "Movie"/"Series"/"Site"/"Artist" (from: .tv-home-card's <small> kind text).
function CapitalizeFirst(value as Dynamic) as String
    if value = invalid or value = "" then return ""
    return UCase(Left(value, 1)) + Right(value, Len(value) - 1)
end function

' Media-card focus values, pinned from the web (docs/design/page-layout.md section 5, reference commit de371253): a Home card
' lifts 6 px; a grid card (cardScale > 1) lifts 5 px; the art zooms 1.025 (grid 1.015). The shadow bitmaps carry the web
' shadows (tools/make_assets.py card_shadow). Lifts are CSS px at the 1920 x 1080 layout, divided by the card scale on use.
function cardFocusLift() as Float
    if m.cardScaleValue > 1 then return 5
    return 6
end function

function cardFocusScale() as Float
    if m.cardScaleValue > 1 then return 0.015
    return 0.025
end function

' The relay drops or times out some artwork requests under load: a failed poster is requested again (up to 8 times, 2 s apart,
' with a cache-busting query so the failure is not reused).
sub onPosterLoadStatus()
    if m.poster.loadStatus = "failed" and m.posterUri <> "" and m.posterRetries < 8
        m.retryTimer.control = "start"
    end if
end sub

sub onPosterRetry()
    m.posterRetries = m.posterRetries + 1
    sep = "?"
    if Instr(1, m.posterUri, "?") > 0 then sep = "&"
    m.poster.uri = m.posterUri + sep + "retry=" + m.posterRetries.ToStr()
end sub

' Card geometry for the art size: the art, corner masks, watch overlays and text are laid out at their own web sizes (a 1.5 grid
' card has a 330 px art but still 12 px text and a 13 px dot), so nothing is scaled as a whole.
sub layoutCard(cardScale as Float)
    artW = 220 * cardScale
    artH = 124 * cardScale
    if m.laidOutScale = cardScale then return
    m.laidOutScale = cardScale
    m.top.findNode("posterBg").width = artW
    m.top.findNode("posterBg").height = artH
    m.poster.width = artW
    m.poster.height = artH
    m.artGroup.scaleRotateCenter = [artW / 2, artH / 2]
    m.top.findNode("cornerTL").translation = [0, 0]
    m.top.findNode("cornerTR").translation = [artW - 12, 0]
    m.top.findNode("cornerBL").translation = [0, artH - 12]
    m.top.findNode("cornerBR").translation = [artW - 12, artH - 12]
    m.unwatchedBadge.translation = [artW - 23.5, 10.5]
    m.progressTrack.translation = [0, artH - 3]
    m.progressTrack.width = artW
    m.restShadow.translation = [-90, -90]
    m.restShadow.width = artW + 180
    m.restShadow.height = artH + 180
    m.focusShadow.translation = [-90, -90]
    m.focusShadow.width = artW + 180
    m.focusShadow.height = artH + 180
    titleGap = 9.9
    if cardScale > 1 then titleGap = 11.5
    m.title.translation = [0, artH + titleGap]
    m.title.width = artW
    m.kind.translation = [0, artH + titleGap + 19.5]
    m.kind.width = artW
end sub
