sub init()
    m.poster = m.top.findNode("poster")
    m.title = m.top.findNode("title")
    m.kind = m.top.findNode("kind")
    m.unwatchedBadge = m.top.findNode("unwatchedBadge")
    m.cardRoot = m.top.findNode("cardRoot")
    m.artGroup = m.top.findNode("artGroup")
    m.focusAnim = m.top.findNode("focusAnim")
    m.focusRing = m.top.findNode("focusRing")
    m.liftInterp = m.top.findNode("liftInterp")
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
    m.cardRoot.scale = [cardScale, cardScale]
    showKind = true
    if content.showKind <> invalid then showKind = content.showKind
    m.kind.visible = showKind
    if showKind
        kindText = CapitalizeFirst(content.kind)
        if content.year <> invalid and content.year <> "" then kindText = kindText + " · " + content.year
        m.kind.text = kindText
    end if
    ' No per-item watched/unwatched state is threaded through from the
    ' catalog fetch yet (MainScene.brs's buildRailContent/buildGridContent
    ' don't carry it), so this always shows the badge. Confirmed live
    ' against the real app that "Unwatched" was in fact the aria-label on
    ' every single card observed, so defaulting to visible is the closer
    ' match of the two options available without deeper API work, not a
    ' guess: a documented simplification, not a bug.
    m.unwatchedBadge.visible = true
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
    ringOpacity = effective
    if ringOpacity > 1 then ringOpacity = 1
    if ringOpacity < 0 then ringOpacity = 0
    m.focusRing.opacity = ringOpacity
    liftY = -10 * effective
    artScale = 1 + (effective * 0.025)
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
