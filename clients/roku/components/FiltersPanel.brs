sub init()
    m.list = m.top.findNode("panelList")
    m.title = m.top.findNode("panelTitle")
    m.rows = []
    m.last = 0
    m.list.observeField("itemFocused", "onPanelFocused")
    m.list.observeField("itemSelected", "onPanelSelected")
    m.top.observeField("focusedChild", "onPanelFocusChain")
end sub

' A Group cannot show focus itself: hand it to the list as soon as the panel
' becomes the focus target.
sub onPanelFocusChain()
    if m.top.hasFocus() then m.list.setFocus(true)
end sub

sub renderPanel()
    m.title.text = m.top.heading
    sections = m.top.sections
    if sections = invalid then return
    selection = m.top.selection
    if selection = invalid then selection = {}
    rows = []
    for each section in sections
        rows.Push({ kind: "heading", title: section.title })
        chosen = selection[section.id]
        for each option in section.options
            isChecked = false
            if chosen <> invalid and chosen.DoesExist(option.id) then isChecked = true
            rows.Push({ kind: "option", title: option.label, checked: isChecked, sectionId: section.id, optionId: option.id })
        end for
    end for
    rows.Push({ kind: "action", title: "Clear filters", sectionId: "", optionId: "__clear" })
    keep = m.list.itemFocused
    if keep = invalid or keep < 0 then keep = 1
    m.rows = rows
    m.list.content = ListBuildContent(rows, 520, 64)
    if keep >= rows.Count() then keep = rows.Count() - 1
    m.list.jumpToItem = keep
    m.last = keep
end sub

sub onPanelFocused(event as Object)
    index = event.GetData()
    if index = invalid then return
    target = ListSkipHeading(m.rows, index, m.last)
    if target >= 0 and target <> index
        m.list.jumpToItem = target
        m.last = target
    else
        m.last = index
    end if
end sub

sub onPanelSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.rows.Count() then return
    row = m.rows[index]
    if row.kind = "heading" then return
    selection = m.top.selection
    if selection = invalid then selection = {}
    next = {}
    for each key in selection
        copy = {}
        for each id in selection[key]
            copy[id] = true
        end for
        next[key] = copy
    end for
    if row.optionId = "__clear"
        next = {}
    else
        if not next.DoesExist(row.sectionId) then next[row.sectionId] = {}
        if next[row.sectionId].DoesExist(row.optionId)
            next[row.sectionId].Delete(row.optionId)
        else
            next[row.sectionId][row.optionId] = true
        end if
    end if
    m.top.selection = next
    m.top.changed = next
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back" or key = "left"
        m.top.closed = true
        return true
    end if
    return false
end function
