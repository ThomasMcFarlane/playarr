sub init()
    m.circleGroup = m.top.findNode("circleGroup")
    m.focusRing = m.top.findNode("focusRing")
    m.avatarImage = m.top.findNode("avatarImage")
    m.initial = m.top.findNode("initial")
    m.name = m.top.findNode("name")
    m.status = m.top.findNode("status")
end sub

' itemContent fields set by buildProfileAvatarContent() in MainScene.brs:
'   title / presetId / initial / statusText
sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    m.avatarImage.uri = "pkg:/images/avatar-" + content.presetId + ".png"
    ' Preset + add art already include mascot / plus — no letter overlay.
    m.initial.text = ""
    m.initial.visible = false
    m.name.text = content.title
    m.status.text = content.statusText
end sub

' Web: focused avatar scales from its centre and lifts slightly. Scale the
' circle group only (labels stay put) with pivot at the circle centre so
' neighbours stay on one horizontal baseline.
sub onFocusChanged()
    effective = m.top.focusPercent * m.top.activeRailFactor
    m.focusRing.opacity = effective
    if m.circleGroup = invalid then return
    scale = 1 + (effective * 0.05)
    m.circleGroup.scale = [scale, scale]
    ' Subtle lift (web translateY(-8px)) without shifting RowList slot.
    lift = Int(-8 * effective)
    m.circleGroup.translation = [20, 16 + lift]
end sub
