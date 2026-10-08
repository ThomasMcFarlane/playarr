sub init()
    m.tilesGroup = m.top.findNode("tiles")
    m.focusIdx = 0
    m.top.focusable = true
    m.top.ObserveField("focusedChild", "onFocusChange")
    buildTiles()
end sub

' id (selected index), x, y, w, h, icon, text
function tileSpecs() as Object
    watchText = "Add to watchlist"
    if m.top.watchlisted then watchText = "In watchlist"
    playText = "Play"
    if m.top.layoutKind = "series" then playText = m.top.playLabel
    if m.top.playMode = "unavailable" then playText = "Unavailable"
    if m.top.layoutKind = "series"
        ' Web series page (y 622.6): a white Start pill, then the two outlined tiles.
        return [
            { id: 0, x: 153.6, y: 508.6, w: 156, h: 64, icon: "player-play.png", text: playText, primary: true, ink: true }
            { id: 2, x: 325.6, y: 508.6, w: 142, h: 64, icon: "", text: watchText, primary: false }
            { id: 3, x: 483.6, y: 508.6, w: 142, h: 64, icon: "", text: "Add to Playlist", primary: false }
        ]
    end if
    return [
        { id: 1, x: 311.6, y: 508.6, w: 142, h: 64, icon: "nav-playlists.png", text: "Playback", primary: false }
        { id: 0, x: 464.9, y: 506.7, w: 165.4, h: 67.8, icon: "player-play.png", text: playText, primary: true }
        { id: 2, x: 153.6, y: 584.6, w: 142, h: 64, icon: "", text: watchText, primary: false }
        { id: 3, x: 311.6, y: 584.6, w: 142, h: 64, icon: "", text: "Add to Playlist", primary: false }
    ]
end function

sub buildTiles()
    m.tilesGroup.removeChildrenIndex(m.tilesGroup.getChildCount(), 0)
    m.specs = tileSpecs()
    m.rings = {}
    for each t in m.specs
        fill = CreateObject("roSGNode", "Poster")
        fill.uri = "pkg:/images/round-r32.9.png"
        fill.translation = [t.x, t.y]
        fill.width = t.w
        fill.height = t.h
        if t.ink = true
            fill.blendColor = ThemeColor("ink")
            ThemeSetRole(fill, "ink")
        else if t.primary
            fill.blendColor = ThemeColor("brand")
            ThemeSetRole(fill, "brand")
        else
            fill.blendColor = ThemeColor("surfaceStrong", 199)
            ThemeSetRole(fill, "surfaceStrong", 199)
        end if
        m.tilesGroup.AppendChild(fill)
        x = t.x
        if t.icon <> ""
            ic = CreateObject("roSGNode", "Poster")
            ic.uri = "pkg:/images/" + t.icon
            ic.width = 16
            ic.height = 16
            ic.translation = [t.x + 34, t.y + t.h / 2 - 8]
            roleName = "brand"
            if t.primary then roleName = "playerInk"
            if t.ink = true then roleName = "bg"
            ic.blendColor = ThemeColor(roleName)
            ThemeSetRole(ic, roleName)
            m.tilesGroup.AppendChild(ic)
        else
            plus = CreateObject("roSGNode", "Label")
            plus.text = "+"
            plus.font = PlayarrMakeFont(400, 13)
            plus.color = ThemeColor("brand")
            ThemeSetRole(plus, "brand")
            plus.translation = [t.x + 20, t.y + t.h / 2 - 11]
            m.tilesGroup.AppendChild(plus)
        end if
        label = CreateObject("roSGNode", "Label")
        label.text = t.text
        label.font = PlayarrMakeFont(700, 11)
        roleName = "ink"
        if t.primary then roleName = "playerInk"
        if t.ink = true then roleName = "bg"
        label.color = ThemeColor(roleName)
        ThemeSetRole(label, roleName)
        if t.icon <> ""
            label.translation = [t.x + 56, t.y + t.h / 2 - 9]
        else
            label.translation = [t.x + 37, t.y + t.h / 2 - 9]
        end if
        m.tilesGroup.AppendChild(label)
        ring = CreateObject("roSGNode", "Poster")
        ring.uri = "pkg:/images/round-ring-r32.9.png"
        ring.translation = [t.x - 3, t.y - 3]
        ring.width = t.w + 6
        ring.height = t.h + 6
        ring.blendColor = ThemeColor("focusRing")
        ThemeSetRole(ring, "focusRing")
        ring.visible = false
        m.tilesGroup.AppendChild(ring)
        m.rings[t.id.ToStr()] = ring
    end for
    applyFocus()
end sub

sub onLayoutChange()
    if m.tilesGroup = invalid then return
    buildTiles()
end sub

sub onFocusChange()
    applyFocus()
end sub

sub applyFocus()
    if m.rings = invalid then return
    on = m.top.isInFocusChain()
    for each key in m.rings
        m.rings[key].visible = on and key = m.focusIdx.ToStr()
    end for
end sub

function specFor(id as Integer) as Object
    for each t in m.specs
        if t.id = id then return t
    end for
    return invalid
end function

' Nearest tile in a direction (by centre), so Down from Play lands under it and Left/Right stay in the row.
function neighbour(dir as String) as Integer
    cur = specFor(m.focusIdx)
    best = -1
    bestScore = 1.0e9
    for each t in m.specs
        if t.id <> cur.id
            dx = (t.x + t.w / 2) - (cur.x + cur.w / 2)
            dy = (t.y + t.h / 2) - (cur.y + cur.h / 2)
            ok = false
            score = 0.0
            if dir = "right" and dx > 20 and Abs(dy) < 40
                ok = true : score = dx
            else if dir = "left" and dx < -20 and Abs(dy) < 40
                ok = true : score = -dx
            else if dir = "down" and dy > 20
                ok = true : score = dy * 10 + Abs(dx)
            else if dir = "up" and dy < -20
                ok = true : score = -dy * 10 + Abs(dx)
            end if
            if ok and score < bestScore
                best = t.id
                bestScore = score
            end if
        end if
    end for
    return best
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "OK"
        if m.focusIdx = 0 and m.top.playMode = "unavailable" then return true
        m.top.itemSelected = m.focusIdx
        return true
    end if
    if key = "left" or key = "right" or key = "up" or key = "down"
        n = neighbour(key)
        if n >= 0
            m.focusIdx = n
            applyFocus()
            return true
        end if
        if key = "right" or key = "left" or key = "up" or key = "down" then return false
    end if
    return false
end function
