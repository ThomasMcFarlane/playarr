sub init()
    m.focusRing = m.top.findNode("focusRing")
    m.avatarImage = m.top.findNode("avatarImage")
    m.initial = m.top.findNode("initial")
    m.name = m.top.findNode("name")
    m.status = m.top.findNode("status")
end sub

' itemContent fields set by buildProfileAvatarContent() in MainScene.brs:
'   title        - profile display name (also the RowList item's own title)
'   presetId     - one of the six fixed preset ids (astronaut/cat/dinosaur/
'                  robot/pirate/alien), pre-resolved by MainScene so this
'                  component stays a dumb renderer, same division of labour
'                  as PosterCard (MainScene resolves artworkUrl, PosterCard
'                  just displays content.hdPosterUrl).
'   initial      - single uppercase letter drawn over the gradient circle,
'                  standing in for tv-web's SVG mascot icon (see this
'                  component's XML header comment for why)
'   statusText   - the Linked/PIN-locked/etc suffix line
sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    m.avatarImage.uri = "pkg:/images/avatar-" + content.presetId + ".png"
    ' Only the synthetic "+" avatar uses a letter/symbol overlay. Preset art
    ' already includes the mascot illustration (matching tv-web ProfileAvatar).
    if content.presetId = "add"
        m.initial.text = content.initial
        m.initial.visible = true
    else
        m.initial.text = ""
        m.initial.visible = false
    end if
    m.name.text = content.title
    m.status.text = content.statusText
end sub

' Mirrors PosterCard's onFocusChanged: fades in a focus ring (this
' component's circular equivalent of PosterCard's focusFrame Rectangle) and
' scales the whole item up slightly.
sub onFocusChanged()
    effective = m.top.focusPercent * m.top.activeRailFactor
    m.focusRing.opacity = effective
    scale = 1 + (effective * 0.04)
    m.top.scale = [scale, scale]
end sub
