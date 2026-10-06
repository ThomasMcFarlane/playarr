sub init()
    m.bg = m.top.findNode("rowBg")
    m.focusBg = m.top.findNode("rowFocus")
    m.poster = m.top.findNode("rowPoster")
    m.dot = m.top.findNode("rowDot")
    m.title = m.top.findNode("rowTitle")
    m.subtitle = m.top.findNode("rowSubtitle")
    m.meta = m.top.findNode("rowMeta")
    m.heading = m.top.findNode("rowHeading")
    m.check = m.top.findNode("rowCheck")
    m.option = m.top.findNode("rowOption")
end sub

sub onRowContent()
    content = m.top.itemContent
    if content = invalid then return
    w = 1000
    if content.rowW <> invalid then w = content.rowW
    h = 80
    if content.rowH <> invalid then h = content.rowH - 8
    m.bg.width = w
    m.bg.height = h
    m.focusBg.width = w
    m.focusBg.height = h
    kind = "item"
    if content.rowKind <> invalid then kind = content.rowKind
    isItem = kind = "item"
    isHeading = kind = "heading"
    isOption = kind = "option" or kind = "action"
    m.bg.visible = not isHeading
    m.poster.visible = false
    m.dot.visible = isItem
    m.title.visible = isItem
    m.subtitle.visible = isItem
    m.meta.visible = isItem
    m.heading.visible = isHeading
    m.check.visible = isOption
    m.option.visible = isOption
    if isHeading
        m.heading.text = UCase(content.title)
        m.heading.width = (w - 16) / 0.5
    else if isOption
        m.option.text = content.title
        m.option.width = (w - 100) / 0.6
        m.option.height = h / 0.6
        m.option.vertAlign = "center"
        m.check.height = h / 0.6
        m.check.vertAlign = "center"
        m.check.translation = [24, 0]
        m.option.translation = [84, 0]
        m.check.visible = kind = "option"
        if content.checked = true
            m.check.text = "[x]"
        else
            m.check.text = "[ ]"
        end if
        if kind = "action" then m.option.translation = [24, 0]
    else
        textX = 24
        if content.hdPosterUrl <> invalid and content.hdPosterUrl <> ""
            m.poster.uri = content.hdPosterUrl
            m.poster.visible = true
            m.poster.height = h - 12
            m.poster.width = int((h - 12) * 0.68)
            textX = 24 + m.poster.width + 8
        end if
        m.title.translation = [textX, 8]
        m.subtitle.translation = [textX, 38]
        m.meta.translation = [textX, 60]
        m.title.width = (w - textX - 16) / 0.6
        m.subtitle.width = (w - textX - 16) / 0.46
        m.meta.width = (w - textX - 16) / 0.4
        m.title.text = content.title
        m.subtitle.text = content.shortDescriptionLine1
        m.meta.text = content.description
        m.dot.height = h
        state = content.shortDescriptionLine2
        if state = "inLibrary"
            m.dot.color = "0x7FC09DFF"
        else if state = "monitored"
            m.dot.color = "0xCF3157FF"
        else
            m.dot.color = "0x887A82FF"
        end if
    end if
    onRowFocus()
end sub

sub onRowFocus()
    content = m.top.itemContent
    if content = invalid then return
    kind = "item"
    if content.rowKind <> invalid then kind = content.rowKind
    m.focusBg.visible = kind <> "heading" and m.top.focusPercent > 0.5
end sub
