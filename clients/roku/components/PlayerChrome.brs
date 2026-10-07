' PlayerChrome.brs
'
' Web player chrome on the Roku video plane: bottom scrim, seek bar with its thumb, the transport row (previous, play,
' next, time), the quality pill, the close button and the quality menu (matrix of tiers by Low, Medium and High).
' Numbers are the web DOM at 1920x1080 (scripts/parity/capture-web.mjs --dump-dom, screens player-controls and
' player-quality-menu). Roku has no Picture-in-Picture, cast or in-app volume, so those controls are not drawn.

sub playerChromeInit()
    m.pcGroup = m.top.findNode("playerControls")
    m.pcMenuOpen = false
    m.pcMenuIndex = 0
    m.pcBuilt = false
end sub

sub playerChromeBuild()
    if m.pcBuilt then return
    m.pcBuilt = true
    g = m.pcGroup
    ' The pre-web controls (hidden labels and the 4 px track) are replaced by the web geometry.
    m.top.findNode("playerBarBg").visible = false
    m.playerProgressTrack.translation = [70, 936]
    m.playerProgressTrack.width = 1780
    m.playerProgressTrack.height = 6
    m.playerBufferedFill.translation = [70, 936]
    m.playerBufferedFill.height = 6
    m.playerProgressFill.translation = [70, 936]
    m.playerProgressFill.height = 6
    m.playerProgressTrack.color = ThemeColor("playerTrack")
    m.playerBufferedFill.color = ThemeColor("playerBuffered")
    m.playerProgressFill.color = ThemeColor("brand")
    ThemeSetRole(m.playerProgressTrack, "playerTrack")
    ThemeSetRole(m.playerBufferedFill, "playerBuffered")
    ThemeSetRole(m.playerProgressFill, "brand")

    scrim = CreateObject("roSGNode", "Poster")
    scrim.uri = "pkg:/images/player-scrim.png"
    scrim.translation = [0, 561.6]
    scrim.width = 1920
    scrim.height = 518.4
    ThemeSetRole(scrim, "playerScrim")
    scrim.blendColor = ThemeColor("playerScrim")
    g.insertChild(scrim, 0)

    m.pcThumb = pgRound(g, 121.8, 931.5, 15, 15, 7, "brand")
    m.pcPrev = pgIcon(g, 92, 980, 20, "player-prev.png", "playerInk")
    m.pcPlayBg = pgRound(g, 147.6, 958, 64, 64, 32, "playerButton")
    m.pcPlay = pgIcon(g, 169.6, 980, 20, "player-pause.png", "playerInk")
    m.pcNext = pgIcon(g, 247.2, 980, 20, "player-next.png", "playerInk")
    m.pcTimeNow = pgLabel(g, 302.8, 981.8, 0, 16, "0:00", 11, 400, "playerInk")
    m.pcTimeSep = pgLabel(g, 330.4, 981.8, 0, 16, "/", 11, 400, "playerSeparator")
    m.pcTimeEnd = pgLabel(g, 339.1, 981.8, 0, 16, "0:00", 11, 400, "playerInk")

    ' Quality pill (.player-quality-button): HD glyph and the current quality.
    pgRound(g, 1527.9, 959.8, 173.3, 60.5, 30, "playerButton")
    m.pcQualityGlyph = pgLabel(g, 1543.5, 979.2, 30, 22, "HD", 8, 800, "playerInk", { horizAlign: "center", vertAlign: "center" })
    m.pcQualityText = pgLabel(g, 1583.2, 981.4, 120, 18, "Original", 11, 800, "playerInk")

    ' Close (top right).
    pgRound(g, 1814, 37.8, 48, 48, 24, "playerPill")
    pgIcon(g, 1828, 51.8, 20, "player-close.png", "playerInk")

    m.pcMenu = CreateObject("roSGNode", "Group")
    m.pcMenu.visible = false
    g.AppendChild(m.pcMenu)
    m.pcRing = CreateObject("roSGNode", "Poster")
    m.pcRing.uri = "pkg:/images/round-ring-r12.9.png"
    m.pcRing.visible = false
    ThemeSetRole(m.pcRing, "playerInk")
    m.pcRing.blendColor = ThemeColor("playerInk")
    g.AppendChild(m.pcRing)
end sub

' Called from updatePlayerProgress with the playback state.
sub playerChromeUpdate(position as Dynamic, duration as Dynamic, fraction as Float)
    playerChromeBuild()
    m.pcThumb.translation = [70 + 1780 * fraction - 7.5, 931.5]
    m.pcTimeNow.text = formatPlaybackTime(position)
    m.pcTimeEnd.text = formatPlaybackTime(duration)
    sepX = 302.8 + m.pcTimeNow.boundingRect().width + 5
    m.pcTimeSep.translation = [sepX, 981.8]
    m.pcTimeEnd.translation = [sepX + 8.7, 981.8]
    m.pcPlay.uri = "pkg:/images/player-pause.png"
    if m.video.state = "paused" then m.pcPlay.uri = "pkg:/images/player-play.png"
    m.pcQualityText.text = playerQualityLabel()
    glyph = "HD"
    if m.qualityPref <> invalid and Left(m.qualityPref, 2) = "SD" then glyph = "SD"
    m.pcQualityGlyph.text = glyph
end sub

function playerQualityLabel() as String
    choice = m.qualityPref
    if choice = invalid or choice = "original" then return "Original"
    parts = choice.Split(":")
    if parts.Count() <> 2 then return "Original"
    return parts[0] + " · " + Int(QualityMaxBitrate(choice, 0) / 1000000).ToStr() + " Mbps"
end function

' ---------------------------------------------------------------------------
' Quality menu

sub playerMenuOpen()
    playerChromeBuild()
    m.pcMenuOpen = true
    m.pcMenuIndex = 0
    m.playerControls.visible = true
    m.playerAutoHideTimer.control = "stop"
    playerMenuRender()
end sub

sub playerMenuClose()
    m.pcMenuOpen = false
    m.pcMenu.visible = false
    m.pcRing.visible = false
    resetPlayerAutoHide()
end sub

' Menu cells in order: Original, then UHD/FHD/HD/SD rows by Low, Medium, High.
function playerMenuKeys() as Object
    keys = ["original"]
    for each name in ["UHD", "FHD", "HD", "SD"]
        for each col in ["Low", "Medium", "High"]
            keys.Push(name + ":" + col)
        end for
    end for
    return keys
end function

sub playerMenuRender()
    menu = m.pcMenu
    menu.removeChildrenIndex(menu.getChildCount(), 0)
    menu.visible = true
    pgRound(menu, 1074.8, 540, 620, 408, 18, "playerPanel")
    pgRound(menu, 1074.8, 540, 620, 408, 18, "playerTint", -1, true)
    pgLabel(menu, 1096, 556, 300, 14, "QUALITY", 9, 800, "playerMuted")
    selected = m.qualityPref
    if selected = invalid or selected = "" then selected = "original"
    rows = qualityRows()
    heads = ["Low", "Medium", "High"]
    cells = []
    pgRound(menu, 1084.6, 578.7, 600.4, 60, 12, "playerTint")
    if selected = "original" then pgRound(menu, 1084.6, 578.7, 600.4, 60, 12, "playerSelected")
    pgLabel(menu, 1095.5, 591.4, 400, 19, "Original", 12, 800, "playerInk")
    pgLabel(menu, 1095.5, 612, 400, 14, "Source quality", 9, 400, "playerMuted")
    if selected = "original" then pgIcon(menu, 1658, 599.8, 16, "check.png", "brand")
    cells.Push({ x: 1084.6, y: 578.7, w: 600.4, h: 60 })
    for c = 0 to 2
        pgLabel(menu, 1203.3 + c * 162.6, 650, 156.6, 14, UCase(heads[c]), 10, 800, "playerMuted", { horizAlign: "center" })
    end for
    for r = 0 to rows.Count() - 1
        y = 680.2 + 66 * r
        pgLabel(menu, 1088.6, y + 13, 100, 18, rows[r].name, 12, 800, "playerInk")
        pgLabel(menu, 1088.6, y + 33, 100, 14, rows[r].note, 9, 400, "playerMuted")
        for c = 0 to 2
            x = 1203.3 + c * 162.6
            key = rows[r].name + ":" + heads[c]
            pgRound(menu, x, y, 156.6, 60, 12, "playerTint")
            if selected = key then pgRound(menu, x, y, 156.6, 60, 12, "playerSelected")
            pgLabel(menu, x + 11, y + 12.7, 140, 19, rows[r].rates[c].ToStr() + " Mbps", 12, 800, "playerInk")
            pgLabel(menu, x + 11, y + 33.3, 140, 14, heads[c], 9, 400, "playerMuted")
            cells.Push({ x: x, y: y, w: 156.6, h: 60 })
        end for
    end for
    m.pcMenuCells = cells
    playerMenuRing()
end sub

sub playerMenuRing()
    cell = m.pcMenuCells[m.pcMenuIndex]
    m.pcRing.translation = [cell.x - 3, cell.y - 3]
    m.pcRing.width = cell.w + 6
    m.pcRing.height = cell.h + 6
    m.pcRing.visible = true
    m.pcGroup.removeChild(m.pcRing)
    m.pcGroup.AppendChild(m.pcRing)
end sub

' Grid move: index 0 is the wide Original row; 1..12 are the 4 x 3 matrix.
function playerMenuKey(key as String) as Boolean
    i = m.pcMenuIndex
    if key = "back"
        playerMenuClose()
        return true
    else if key = "OK"
        keys = playerMenuKeys()
        m.qualityPref = keys[i]
        SaveQualityPreference(m.qualityPref)
        playerMenuClose()
        playerApplyQuality()
        return true
    end if
    if i = 0
        if key = "down" then m.pcMenuIndex = 1
    else
        col = (i - 1) mod 3
        row = Int((i - 1) / 3)
        if key = "left" and col > 0 then m.pcMenuIndex = i - 1
        if key = "right" and col < 2 then m.pcMenuIndex = i + 1
        if key = "up"
            if row = 0
                m.pcMenuIndex = 0
            else
                m.pcMenuIndex = i - 3
            end if
        end if
        if key = "down" and row < 3 then m.pcMenuIndex = i + 3
    end if
    playerMenuRing()
    return true
end function

' A new bitrate means a new playback session at the same position.
sub playerApplyQuality()
    if m.currentMediaFileId = invalid or m.currentMediaFileId = "" then return
    m.pendingChapterSeekMs = Int(m.video.position * 1000)
    requestPlayback(m.currentMediaFileId)
end sub
