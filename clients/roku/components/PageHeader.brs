sub init()
    m.title = m.top.findNode("headerTitle")
    m.detail = m.top.findNode("headerDetail")
    m.actionsGroup = m.top.findNode("headerActions")
    m.top.observeField("focusedChild", "renderHeader")
    m.top.focusable = true
end sub

sub renderHeader()
    m.title.text = m.top.title
    m.detail.text = m.top.detail
    while m.actionsGroup.getChildCount() > 0
        m.actionsGroup.removeChildIndex(0)
    end while
    actions = m.top.actions
    if actions = invalid then return
    focused = m.top.isInFocusChain()
    widths = []
    total = 0
    for each label in actions
        w = HeaderActionWidth(label)
        widths.Push(w)
        total = total + w + 16
    end for
    x = m.top.bandWidth - total + 16
    index = 0
    for each label in actions
        w = widths[index]
        isCurrent = focused and index = m.top.actionIndex
        bg = CreateObject("roSGNode", "Rectangle")
        bg.translation = [x, 8]
        bg.width = w
        bg.height = 52
        if isCurrent
            bg.color = "0xCF3157FF"
        else
            bg.color = "0x312A30FF"
        end if
        m.actionsGroup.appendChild(bg)
        text = CreateObject("roSGNode", "Label")
        text.translation = [x, 8]
        text.width = w / 0.5
        text.height = 104
        text.scale = [0.5, 0.5]
        text.horizAlign = "center"
        text.vertAlign = "center"
        text.text = label
        text.color = "0xF4F0F1FF"
        m.actionsGroup.appendChild(text)
        x = x + w + 16
        index = index + 1
    end for
end sub

function HeaderActionWidth(label as String) as Integer
    w = Len(label) * 15 + 48
    if w < 120 then w = 120
    return w
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    count = 0
    if m.top.actions <> invalid then count = m.top.actions.Count()
    if count = 0 then return false
    if key = "left"
        if m.top.actionIndex > 0 then m.top.actionIndex = m.top.actionIndex - 1
        return true
    else if key = "right"
        if m.top.actionIndex < count - 1 then m.top.actionIndex = m.top.actionIndex + 1
        return true
    else if key = "OK"
        m.top.actionSelected = m.top.actionIndex
        return true
    end if
    return false
end function
