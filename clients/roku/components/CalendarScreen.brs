sub init()
    m.header = m.top.findNode("header")
    m.bannerBg = m.top.findNode("bannerBg")
    m.bannerText = m.top.findNode("bannerText")
    m.agenda = m.top.findNode("agenda")
    m.stateTitle = m.top.findNode("stateTitle")
    m.stateMessage = m.top.findNode("stateMessage")
    m.spinner = m.top.findNode("spinner")
    m.filtersPanel = m.top.findNode("filters")
    m.detailKicker = m.top.findNode("detailKicker")
    m.detailTitle = m.top.findNode("detailTitle")
    m.detailSubtitle = m.top.findNode("detailSubtitle")
    m.detailBody = m.top.findNode("detailBody")
    m.detailAction = m.top.findNode("detailAction")
    m.today = CalTodayLocal()
    m.anchor = m.today
    m.filters = CalEmptyFilters()
    m.selection = {}
    m.entries = []
    m.sources = []
    m.rows = []
    m.last = 0
    m.loading = false
    m.loadFailed = false
    m.agenda.observeField("itemFocused", "onAgendaFocused")
    m.agenda.observeField("itemSelected", "onAgendaSelected")
    m.header.observeField("actionSelected", "onHeaderAction")
    m.filtersPanel.observeField("changed", "onFiltersChanged")
    m.filtersPanel.observeField("closed", "onFiltersClosed")
    m.header.actions = ["Previous", "Today", "Next", "Filters"]
    m.header.title = "Release Calendar"
    m.header.actionIndex = 1
    renderDetail(invalid)
end sub

sub featureActivate()
    m.today = CalTodayLocal()
    m.anchor = m.today
    loadWindow()
end sub

sub loadWindow()
    m.loading = true
    m.loadFailed = false
    m.wantedStart = CalAddDays(m.anchor, -1)
    renderState()
    featureSend("calendar", "GET", CalFetchPath(m.anchor), invalid)
end sub

sub onFeatureResult(result as Object)
    if result.action <> "feature:calendar" then return
    m.loading = false
    if not result.ok or result.data = invalid or result.data.entries = invalid
        m.loadFailed = true
        renderState()
        return
    end if
    if result.data.start <> invalid and result.data.start <> m.wantedStart then return
    m.entries = result.data.entries
    m.sources = []
    if result.data.sources <> invalid then m.sources = result.data.sources
    rebuild()
end sub

' Re-applies filters and repaints. Called after data, filter and period changes.
sub rebuild()
    visible = CalApplyFilters(m.entries, m.filters, m.today)
    inWindow = []
    windowEnd = CalAgendaEnd(m.anchor)
    for each entry in visible
        day = CalEntryLocalDay(entry)
        if day >= m.anchor and day <= windowEnd then inWindow.Push(entry)
    end for
    m.rows = CalBuildAgenda(inWindow, m.today)
    banner = CalSourceBanner(m.sources)
    m.bannerBg.visible = banner <> ""
    m.bannerText.visible = banner <> ""
    m.bannerText.text = banner
    count = CalActiveFilterCount(m.filters)
    detail = CalFormatRange(m.anchor, windowEnd)
    if count > 0 then detail = detail + "   -   " + count.ToStr() + " filter(s) on"
    m.header.detail = detail
    m.header.actions = ["Previous", "Today", "Next", filterActionLabel(count)]
    m.agenda.content = ListBuildContent(CalRowsForList(m.rows), 1000, 88)
    renderState()
    first = CalNextItemIndex(m.rows, 0, 1)
    if first >= 0
        m.agenda.jumpToItem = first
        m.last = first
        renderDetail(m.rows[first])
    else
        renderDetail(invalid)
    end if
end sub

function filterActionLabel(count as Integer) as String
    if count > 0 then return "Filters (" + count.ToStr() + ")"
    return "Filters"
end function

' Row descriptors in the shape ListBuildContent expects.
function CalRowsForList(rows as Object) as Object
    list = []
    for each row in rows
        if row.kind = "day"
            list.Push({ kind: "heading", title: row.heading })
        else
            list.Push({ kind: "item", title: row.title, subtitle: row.subtitle, meta: row.meta, state: row.state, poster: row.posterUrl })
        end if
    end for
    return list
end function

sub renderState()
    hasRows = m.rows.Count() > 0
    m.agenda.visible = hasRows and not m.loading
    m.spinner.visible = m.loading
    if m.loading
        m.spinner.control = "start"
    else
        m.spinner.control = "stop"
    end if
    message = ""
    title = ""
    if m.loading
        title = "Loading the calendar..."
    else if m.loadFailed
        title = "The calendar could not be loaded"
        message = "Press OK to try again."
    else if not hasRows
        title = "Nothing scheduled"
        message = "No releases from your connected sources fall in this period."
        if CalActiveFilterCount(m.filters) > 0 then message = "No releases match the selected filters in this period."
    end if
    m.stateTitle.visible = title <> "" and not m.loading
    m.stateMessage.visible = message <> ""
    m.stateTitle.text = title
    m.stateMessage.text = message
    if m.loading or m.loadFailed or not hasRows
        m.header.detail = CalFormatRange(m.anchor, CalAgendaEnd(m.anchor))
    end if
end sub

sub onAgendaFocused(event as Object)
    index = event.GetData()
    if index = invalid or m.rows.Count() = 0 then return
    target = ListSkipHeading(CalRowsForList(m.rows), index, m.last)
    if target >= 0 and target <> index
        m.agenda.jumpToItem = target
        m.last = target
        renderDetail(m.rows[target])
    else if target >= 0
        m.last = index
        renderDetail(m.rows[index])
    end if
end sub

sub onAgendaSelected(event as Object)
    index = event.GetData()
    if index = invalid or index < 0 or index >= m.rows.Count() then return
    openRow(m.rows[index])
end sub

sub openRow(row as Object)
    if row.kind <> "item" then return
    if row.workId = invalid or row.workId = "" then return
    m.top.openWork = { id: row.workId, title: row.title, kind: CalWorkKind(row.mediaKind) }
end sub

function CalWorkKind(mediaKind as Dynamic) as String
    if mediaKind = "episode" then return "series"
    if mediaKind = "album" then return "artist"
    if mediaKind = "book" then return "book"
    return "movie"
end function

sub renderDetail(row as Dynamic)
    if row = invalid or row.kind <> "item"
        m.detailKicker.text = ""
        m.detailTitle.text = "Select a release"
        m.detailSubtitle.text = ""
        m.detailBody.text = "Choose a release to see its details."
        m.detailAction.text = ""
        return
    end if
    first = row.entries[0]
    m.detailKicker.text = UCase(CalReleaseLabel(first.release_type) + "  -  " + CalKindLabel(first.media_kind))
    m.detailTitle.text = row.title
    m.detailSubtitle.text = row.subtitle
    lines = []
    when = CalFormatDayHeading(row.day)
    time = CalEntryTime(first)
    if time <> "" then when = when + " at " + time
    lines.Push("Release: " + when)
    lines.Push("Status: " + CalStateLabel(row.state))
    if row.isGroup
        index = 0
        for each member in row.entries
            if index < 5
                line = CalEpisodeCode(member)
                if member.subtitle <> invalid and member.subtitle <> "" then line = line + " - " + member.subtitle
                lines.Push(line)
            end if
            index = index + 1
        end for
        if row.entries.Count() > 5 then lines.Push("+" + (row.entries.Count() - 5).ToStr() + " more")
    end if
    if first.average_lag_seconds <> invalid
        lines.Push("Typical availability: " + CalHumanDuration(first.average_lag_seconds) + " after release")
    end if
    names = []
    seen = {}
    for each member in row.entries
        if member.sources <> invalid
            for each source in member.sources
                if not seen.DoesExist(source.source_instance_id)
                    seen[source.source_instance_id] = true
                    names.Push(source.source_name)
                end if
            end for
        end if
    end for
    if names.Count() > 0 then lines.Push("Reported by: " + CalJoin(names, ", "))
    m.detailBody.text = CalJoin(lines, Chr(10))
    if row.workId <> invalid and row.workId <> ""
        if row.isGroup
            m.detailAction.text = "Press OK to open the series"
        else
            m.detailAction.text = "Press OK to open this title"
        end if
    else
        m.detailAction.text = "This title is not in your catalogue yet."
    end if
end sub

sub onHeaderAction(event as Object)
    index = event.GetData()
    if index = 0
        shiftPeriod(-1)
    else if index = 1
        goToday()
    else if index = 2
        shiftPeriod(1)
    else if index = 3
        openFilters()
    end if
end sub

sub shiftPeriod(direction as Integer)
    m.anchor = CalAddDays(m.anchor, direction * CalAgendaDays())
    loadWindow()
end sub

sub goToday()
    m.today = CalTodayLocal()
    m.anchor = m.today
    loadWindow()
end sub

sub openFilters()
    m.filtersPanel.sections = CalFilterSections(m.sources)
    m.filtersPanel.selection = m.selection
    m.filtersPanel.visible = true
    m.filtersPanel.setFocus(true)
end sub

sub onFiltersChanged(event as Object)
    selection = event.GetData()
    if selection = invalid then return
    m.selection = selection
    filters = CalEmptyFilters()
    if selection.types <> invalid then filters.types = selection.types
    if selection.statuses <> invalid then filters.statuses = selection.statuses
    if selection.sources <> invalid then filters.sources = selection.sources
    filters.monitoredOnly = selection.monitored <> invalid and selection.monitored.DoesExist("only")
    m.filters = filters
    rebuild()
end sub

sub onFiltersClosed()
    m.filtersPanel.visible = false
    if m.rows.Count() > 0
        m.agenda.setFocus(true)
    else
        m.header.setFocus(true)
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if m.filtersPanel.visible then return false
    if key = "back"
        featureClose()
        return true
    else if key = "options"
        openFilters()
        return true
    else if key = "rewind"
        shiftPeriod(-1)
        return true
    else if key = "fastforward"
        shiftPeriod(1)
        return true
    else if key = "play"
        goToday()
        return true
    else if key = "up"
        if not m.header.isInFocusChain()
            m.header.setFocus(true)
            return true
        end if
    else if key = "down"
        if m.header.isInFocusChain()
            if m.rows.Count() > 0 then m.agenda.setFocus(true)
            return true
        end if
    else if key = "OK"
        if m.loadFailed and not m.loading
            loadWindow()
            return true
        end if
    end if
    return false
end function
