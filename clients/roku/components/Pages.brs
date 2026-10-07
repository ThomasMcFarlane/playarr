' Pages.brs
'
' The web "page shell" screens on Roku: Watchlist, Requests, Release Calendar and Preferences (Settings). They share
' one builder: a header (round back button, title, the shell clock), an optional right-hand content panel and a list of
' focusable controls moved with the D-pad. Geometry, sizes, weights and colours come from the web DOM at 1920x1080
' (scripts/parity/capture-web.mjs --dump-dom). Colours are theme roles (Theme.brs), never literals.

sub pagesInit()
    browseChromeInit()
    edgeFadesInit()
    m.pageGroup = m.top.findNode("pageGroup")
    m.pageHead = m.top.findNode("pageHead")
    m.pageBody = m.top.findNode("pageBody")
    m.pageRing = m.top.findNode("pageRing")
    m.pagePanel = m.top.findNode("pagePanel")
    m.pagePanelFade = m.top.findNode("pagePanelFade")
    ThemeSetRole(m.pagePanel, "panel")
    ThemeSetRole(m.pagePanelFade, "panel")
    ThemeSetRole(m.pageRing, "focusRing")
    m.pageItems = []
    m.pageFocusIdx = 0
    m.pageKind = ""
    m.pageData = invalid
    m.pageStatus = ""
    m.calendarStart = invalid
    m.calendarKinds = []
    m.pageScrollY = 0
    m.settingsPanel = "appearance"
end sub

' ---------------------------------------------------------------------------
' Builders

function pgLabel(parent as Object, x as Float, y as Float, w as Float, h as Float, text as String, size as Integer, weight as Integer, role as String, opts = invalid as Dynamic) as Object
    label = CreateObject("roSGNode", "Label")
    label.translation = [x, y]
    if w > 0 then label.width = w
    label.height = h
    label.text = text
    label.font = PlayarrMakeFont(weight, size)
    label.color = ThemeColor(role)
    ThemeSetRole(label, role)
    label.vertAlign = "top"
    if opts <> invalid
        if opts.horizAlign <> invalid then label.horizAlign = opts.horizAlign
        if opts.vertAlign <> invalid then label.vertAlign = opts.vertAlign
        if opts.wrap = true
            label.wrap = true
            ' Roku adds the font's full line gap between wrapped lines; pull it back to the web's ~1.45 line height.
            label.lineSpacing = -Int(size * 0.6)
        end if
        if opts.maxLines <> invalid then label.maxLines = opts.maxLines
        if opts.lineSpacing <> invalid then label.lineSpacing = opts.lineSpacing
        if opts.mono = true then label.font = PlayarrMakeFont(weight, size, true)
    end if
    parent.AppendChild(label)
    return label
end function

function pgRect(parent as Object, x as Float, y as Float, w as Float, h as Float, role as String, alpha = -1 as Integer) as Object
    rect = CreateObject("roSGNode", "Rectangle")
    rect.translation = [x, y]
    rect.width = w
    rect.height = h
    rect.color = ThemeColor(role, alpha)
    ThemeSetRole(rect, role, alpha)
    parent.AppendChild(rect)
    return rect
end function

function pgRadiusFor(h as Float, r as Float) as Integer
    if r >= 82 then return 82
    if r >= 25 then return 25
    if r >= 12 then return 12
    return 6
end function

' Rounded rectangle (9-patch white mask tinted by `role`). outline: draw only a 1px outline.
function pgRound(parent as Object, x as Float, y as Float, w as Float, h as Float, r as Float, role as String, alpha = -1 as Integer, outline = false as Boolean) as Object
    poster = CreateObject("roSGNode", "Poster")
    radius = pgRadiusFor(h, r)
    smallest = h
    if w < smallest then smallest = w
    if radius = 82 and smallest < 160 then radius = 25
    if radius = 25 and smallest < 49 then radius = 12
    if radius = 12 and smallest < 23 then radius = 6
    name = "round"
    if outline then name = "round-outline"
    poster.uri = "pkg:/images/" + name + "-r" + radius.ToStr() + ".9.png"
    poster.translation = [x, y]
    poster.width = w
    poster.height = h
    poster.blendColor = ThemeColor(role, alpha)
    ThemeSetRole(poster, role, alpha)
    parent.AppendChild(poster)
    return poster
end function

function pgIcon(parent as Object, x as Float, y as Float, size as Integer, file as String, role as String, alpha = -1 as Integer) as Object
    poster = CreateObject("roSGNode", "Poster")
    poster.uri = "pkg:/images/" + file
    poster.translation = [x, y]
    poster.width = size
    poster.height = size
    poster.blendColor = ThemeColor(role, alpha)
    ThemeSetRole(poster, role, alpha)
    parent.AppendChild(poster)
    return poster
end function

function pgArtwork(parent as Object, x as Float, y as Float, w as Float, h as Float, url as String) as Object
    poster = CreateObject("roSGNode", "Poster")
    poster.translation = [x, y]
    poster.width = w
    poster.height = h
    poster.loadDisplayMode = "scaleToZoom"
    if url <> ""
        agent = CreateObject("roHttpAgent")
        agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
        agent.InitClientCertificates()
        g = GetGlobalAA()
        if g.playarrArtHeaders <> invalid then agent.SetHeaders(g.playarrArtHeaders)
        poster.SetHttpAgent(agent)
        poster.uri = url
    end if
    parent.AppendChild(poster)
    return poster
end function

' Register a focusable control (rect in canvas px) with an action name and optional payload.
sub pgFocusable(x as Float, y as Float, w as Float, h as Float, r as Float, action as String, data = invalid as Dynamic, scrolls = false as Boolean)
    m.pageItems.Push({ x: x, y: y, w: w, h: h, r: r, action: action, data: data, scrolls: scrolls })
end sub

' Pill button: width from the text. style "primary" (accent fill) or "secondary" (outlined). Returns the width.
function pgButton(parent as Object, x as Float, y as Float, h as Float, text as String, style as String, action as String, data = invalid as Dynamic, padX = 21 as Float) as Float
    probe = pgLabel(parent, x, y, 0, h, text, 15, 700, "inkSoft")
    textW = probe.boundingRect().width
    parent.removeChild(probe)
    w = textW + padX * 2
    textRole = "inkSoft"
    if style = "primary"
        pgRound(parent, x, y, w, h, h / 2, "accent")
        textRole = "onAccent"
    else
        pgRound(parent, x, y, w, h, h / 2, "surface")
        pgRound(parent, x, y, w, h, h / 2, "line", -1, true)
    end if
    pgLabel(parent, x, y, w, h, text, 15, 700, textRole, { horizAlign: "center", vertAlign: "center" })
    pgFocusable(x, y, w, h, h / 2, action, data)
    return w
end function

' App-shell action column: every button that opens a side panel or creates something is a tile in ONE column at the right of the
' shell, stacked vertically (web .tv-filter-launcher stack); pages register their actions and never place them per page.
function shellActionX() as Float
    return 1845.5
end function

function shellActionY(slot as Integer) as Float
    return 151.2 + 84.9 * slot
end function

' Header action tile (web .tv-filter-launcher, the 30 September reference): 62 x 72, radius 14, a 1px line, an icon over a
' tiny label. Used for every header action (Calendar link, Filters).
sub pgTile(parent as Object, x as Float, y as Float, label as String, icon as String, action as String, data = invalid as Dynamic)
    pgRound(parent, x, y, 62, 72, 14, "surfaceStrong", 199)
    pgRound(parent, x, y, 62, 72, 14, "line", -1, true)
    pgIcon(parent, x + 20, y + 15, 22, icon, "inkMuted")
    pgLabel(parent, x, y + 44, 62, 14, label, 8, 800, "inkMuted", { horizAlign: "center" })
    pgFocusable(x, y, 62, 72, 14, action, data)
end sub

' Shell header shared by every page: round back button, title; panelX is where the right-hand panel starts (0 = none).
sub pageBegin(title as String, panelX as Float)
    m.pageBody.removeChildrenIndex(m.pageBody.getChildCount(), 0)
    m.pageHead.removeChildrenIndex(m.pageHead.getChildCount(), 0)
    m.pageItems = []
    if m.pageKeepScroll <> true
        m.pageScrollY = 0
        m.pageBody.translation = [0, 0]
    end if
    m.pagePanel.visible = panelX > 0
    m.pagePanelFade.visible = panelX > 0
    if panelX > 0
        m.pagePanelFade.translation = [panelX, 0]
        m.pagePanel.translation = [panelX + 260, 0]
        m.pagePanel.width = 1920 - panelX - 260
    end if
    pgRound(m.pageHead, 153.6, 56.3, 50, 50, 25, "surface", 179)
    pgRound(m.pageHead, 153.6, 56.3, 50, 50, 25, "line", -1, true)
    pgIcon(m.pageHead, 170, 73, 17, "arrow-left.png", "inkSoft")
    pgFocusable(153.6, 56.3, 50, 50, 25, "back")
    pgLabel(m.pageHead, 226.6, 56.2, 900, 50, title, 34, 600, "ink", { vertAlign: "center" })
end sub

sub pageEmptyState(x as Float, title as String, description as String)
    pgRound(m.pageBody, x, 89.6, 164, 164, 82, "surface", 138)
    pgRound(m.pageBody, x, 89.6, 164, 164, 82, "line", -1, true)
    pgIcon(m.pageBody, x + 62, 150, 40, "icon-empty.png", "brand")
    pgLabel(m.pageBody, x + 206, 133, 460, 36, title, 22, 700, "ink")
    pgLabel(m.pageBody, x + 206, 174, 230, 34, description, 11, 400, "inkMuted", { wrap: true, maxLines: 2 })
end sub

' ---------------------------------------------------------------------------
' Focus

sub pageFocusRender()
    if m.pageItems.Count() = 0
        m.pageRing.visible = false
        return
    end if
    if m.pageFocusIdx >= m.pageItems.Count() then m.pageFocusIdx = 0
    item = m.pageItems[m.pageFocusIdx]
    if item.scrolls = true
        ' Keep the focused control inside the visible band (the panel scrolls under the fixed header).
        top = item.y + m.pageScrollY
        bottom = item.y + item.h + m.pageScrollY
        if bottom > 1030 then m.pageScrollY = m.pageScrollY - (bottom - 1030)
        if top < 140 and m.pageScrollY < 0 then m.pageScrollY = m.pageScrollY + (140 - top)
        if m.pageScrollY > 0 then m.pageScrollY = 0
        m.pageBody.translation = [0, m.pageScrollY]
    end if
    oy = 0
    if item.scrolls = true then oy = m.pageScrollY
    bottom = 0.0
    for each it in m.pageItems
        if it.scrolls = true and it.y + it.h > bottom then bottom = it.y + it.h
    end for
    pageFadesUpdate(bottom)
    radius = 25
    if item.r < 25 then radius = 12
    m.pageRing.uri = "pkg:/images/round-ring-r" + radius.ToStr() + ".9.png"
    m.pageRing.translation = [item.x - 3, item.y + oy - 3]
    m.pageRing.width = item.w + 6
    m.pageRing.height = item.h + 6
    m.pageRing.visible = not m.navDockMode
    pageOnFocus(item)
end sub

sub pageOnFocus(item as Object)
    if m.pageKind = "calendar" and item.action = "entry"
        if m.calendarSelected <> item.data
            m.calendarSelected = item.data
            ' Re-render, keeping focus on the same entry.
            focusKey = item.data
            m.pageKeepScroll = true
            renderCalendar()
            m.pageKeepScroll = false
            for i = 0 to m.pageItems.Count() - 1
                if m.pageItems[i].action = "entry" and m.pageItems[i].data = focusKey then m.pageFocusIdx = i
            end for
            pageFocusRender()
        end if
    end if
end sub

function pageMoveFocus(dir as String) as Boolean
    if m.pageItems.Count() = 0 then return false
    cur = m.pageItems[m.pageFocusIdx]
    cx = cur.x + cur.w / 2
    cy = cur.y + cur.h / 2
    best = -1
    bestScore = 1000000.0
    for i = 0 to m.pageItems.Count() - 1
        if i <> m.pageFocusIdx
            it = m.pageItems[i]
            ix = it.x + it.w / 2
            iy = it.y + it.h / 2
            dx = ix - cx
            dy = iy - cy
            ok = false
            primary = 0.0
            cross = 0.0
            if dir = "right" and dx > 4
                ok = true : primary = dx : cross = Abs(dy)
            else if dir = "left" and dx < -4
                ok = true : primary = -dx : cross = Abs(dy)
            else if dir = "down" and dy > 4
                ok = true : primary = dy : cross = Abs(dx)
            else if dir = "up" and dy < -4
                ok = true : primary = -dy : cross = Abs(dx)
            end if
            if ok
                score = primary + cross * 2.5
                if score < bestScore
                    bestScore = score
                    best = i
                end if
            end if
        end if
    end for
    if best < 0 then return false
    m.pageFocusIdx = best
    pageFocusRender()
    return true
end function

function pageOnKey(key as String) as Boolean
    if m.navDockMode = true
        if key = "up" then return moveNavDockFocus(-1)
        if key = "down" then return moveNavDockFocus(1)
        if key = "right"
            m.navDockMode = false
            renderNavDockFocus()
            pageFocusRender()
            return true
        end if
        if key = "left" then return true
        if key = "OK"
            selectNavDockItem()
            return true
        end if
        if key = "back"
            m.navDockMode = false
            renderNavDockFocus()
            pageFocusRender()
            return true
        end if
        return false
    end if
    if key = "back"
        if m.pageKind = "household"
            loadProfiles()
        else
            pageLeaveToHome()
        end if
        return true
    end if
    if key = "OK"
        if m.pageItems.Count() > 0 then pageActivate(m.pageItems[m.pageFocusIdx])
        return true
    end if
    if key = "up" or key = "down" or key = "left" or key = "right"
        if pageMoveFocus(key) then return true
        if key = "left"
            m.navDockMode = true
            m.navDockIndex = activeNavDockIndex()
            if m.navDockIndex < 0 then m.navDockIndex = firstEnabledNavIndex()
            renderNavDockFocus()
            m.pageRing.visible = false
        end if
        return true
    end if
    return false
end function

sub pageActivate(item as Object)
    action = item.action
    if action = "back"
        pageLeaveToHome()
    else if m.pageKind = "watchlist"
        watchlistAction(item)
    else if m.pageKind = "calendar"
        calendarAction(item)
    else if m.pageKind = "settings"
        settingsAction(item)
    else if m.pageKind = "customise"
        customiseAction(item)
    else if m.pageKind = "household"
        householdAction(item)
    end if
end sub

' ---------------------------------------------------------------------------
' Entry points

sub openPage(kind as String)
    m.pageKind = kind
    m.pageData = invalid
    m.pageStatus = "loading"
    showOnly("page")
    m.top.screenState = "page"
    renderNavDockFocus()
    m.pageFocusIdx = 0
    if kind = "watchlist"
        renderWatchlist()
        sendApi("watchlist", "GET", "/api/v1/watchlist", invalid, true)
    else if kind = "requests"
        renderRequests()
        sendApi("requests", "GET", "/api/v1/requests", invalid, true)
    else if kind = "calendar"
        m.calendarStart = invalid
        m.calendarSelected = ""
        renderCalendar()
        loadCalendar()
    else if kind = "household"
        m.householdNote = ""
        renderHousehold()
    else if kind = "customise"
        renderCustomise()
        sendApi("railPrefs", "GET", "/api/v1/home/rails/preferences?lang=en", invalid, true)
    else if kind = "settings"
        m.settingsPanel = "appearance"
        renderSettings()
        pageSettingsFocusDefault()
    end if
    pageFocusRender()
    m.top.SetFocus(true)
end sub

' Page data arrives through onApiResult.
sub acceptPageData(action as String, data as Dynamic)
    if m.top.screenState <> "page" then return
    m.pageStatus = "ready"
    if action = "watchlist" and m.pageKind = "watchlist"
        m.pageData = data
        renderWatchlist()
    else if action = "requests" and m.pageKind = "requests"
        m.pageData = data
        renderRequests()
    else if action = "railPrefs" and m.pageKind = "customise"
        m.pageData = data
        renderCustomise()
    else if action = "calendar" and m.pageKind = "calendar"
        m.pageData = data
        m.calendarSelected = ""
        renderCalendar()
    end if
    pageFocusRender()
end sub

sub acceptPageFailure(action as String, result as Object)
    if m.top.screenState <> "page" then return
    m.pageStatus = "error"
    m.pageError = result.error
    if m.pageKind = "watchlist" then renderWatchlist()
    if m.pageKind = "requests" then renderRequests()
    if m.pageKind = "calendar" then renderCalendar()
    pageFocusRender()
end sub

' ---------------------------------------------------------------------------
' Watchlist and Requests (web TvEmptyState page with list rows)

function pageListItems(data as Dynamic) as Object
    if data = invalid then return []
    if GetInterface(data, "ifArray") <> invalid then return data
    if data.items <> invalid then return data.items
    return []
end function

sub renderWatchlist()
    pageBegin("Watchlist", 729.6)
    items = pageListItems(m.pageData)
    if m.pageStatus = "loading"
        pgLabel(m.pageBody, 912, 133, 600, 30, "Loading your watchlist…", 14, 400, "inkMuted")
    else if m.pageStatus = "error"
        pageEmptyState(911, "Couldn’t load your watchlist", m.pageError)
    else if items.Count() = 0
        pageEmptyState(911, "Your watchlist is empty", "Add titles from search or a title page to keep them here on every device.")
    else
        y = 96.0
        for each entry in items
            if y > 980 then exit for
            title = entry.title
            pgRound(m.pageBody, 786, y, 1048, 100, 12, "surfaceStrong")
            pgLabel(m.pageBody, 820, y + 18, 640, 30, title.title, 19, 700, "ink")
            meta = ""
            if title.year <> invalid then meta = title.year.ToStr()
            pgLabel(m.pageBody, 820, y + 56, 640, 24, meta, 13, 400, "inkMuted")
            pgButton(m.pageBody, 1580, y + 22, 56, "Open", "secondary", "wlOpen", entry)
            pgButton(m.pageBody, 1690, y + 22, 56, "Remove", "secondary", "wlRemove", entry)
            y = y + 116
        end for
    end if
end sub

sub watchlistAction(item as Object)
    entry = item.data
    if entry = invalid then return
    if item.action = "wlRemove"
        sendApi("watchlistRemove", "DELETE", "/api/v1/watchlist/" + UrlEncode(entry.title.title_key), invalid, true)
    else if item.action = "wlOpen"
        wid = invalid
        if entry.actions <> invalid
            for each a in entry.actions
                if a.work_id <> invalid and wid = invalid then wid = a.work_id
            end for
        end if
        if wid <> invalid then openWorkDetail({ id: wid, title: entry.title.title, kind: entry.title.kind }, "home")
    end if
end sub

sub renderRequests()
    pageBegin("Requests", 729.6)
    items = pageListItems(m.pageData)
    if m.pageStatus = "loading"
        pgLabel(m.pageBody, 924, 133, 600, 30, "Loading your requests…", 14, 400, "inkMuted")
    else if m.pageStatus = "error"
        pageEmptyState(923, "Couldn’t load your requests", m.pageError)
    else if items.Count() = 0
        pageEmptyState(923, "No requests yet", "Request a title that is not in the library and its progress shows up here.")
    else
        y = 96.0
        for each req in items
            if y > 980 then exit for
            pgRound(m.pageBody, 786, y, 1048, 100, 12, "surfaceStrong")
            pgLabel(m.pageBody, 820, y + 18, 900, 30, req.title, 19, 700, "ink")
            meta = requestStatusLabel(req.status)
            if req.year <> invalid then meta = req.year.ToStr() + "  ·  " + meta
            if req.requested_by <> invalid
                if req.mine = true
                    meta = meta + "  ·  by you"
                else
                    meta = meta + "  ·  by " + req.requested_by
                end if
            end if
            pgLabel(m.pageBody, 820, y + 56, 900, 24, meta, 13, 400, "inkMuted")
            y = y + 116
        end for
    end if
end sub

function requestStatusLabel(status as Dynamic) as String
    if status = "pending" then return "Pending"
    if status = "approved" then return "Approved"
    if status = "declined" then return "Declined"
    if status = "available" then return "Available"
    if status = "failed" then return "Failed"
    return "Unknown"
end function

' ---------------------------------------------------------------------------
' Release calendar

function calendarMonthName(month as Integer, short as Boolean) as String
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    name = names[month - 1]
    if short then return Left(name, 3)
    return name
end function

function calendarDateString(dt as Object) as String
    return dt.ToISOString().Left(10)
end function

function calendarToday() as Object
    dt = CreateObject("roDateTime")
    dt.ToLocalTime()
    return dt
end function

sub calendarEnsureRange()
    if m.calendarStart = invalid
        m.calendarStart = calendarToday()
    end if
end sub

sub loadCalendar()
    calendarEnsureRange()
    startSeconds = m.calendarStart.AsSeconds()
    endDt = CreateObject("roDateTime")
    endDt.FromSeconds(startSeconds + 29 * 86400)
    path = "/api/v1/calendar?start=" + calendarDateString(m.calendarStart) + "&end=" + calendarDateString(endDt)
    if m.calendarKinds.Count() > 0 then path = path + "&kind=" + joinStrings(m.calendarKinds, ",")
    m.pageStatus = "loading"
    sendApi("calendar", "GET", path, invalid, true)
end sub

function calendarRangeLabel() as String
    calendarEnsureRange()
    endDt = CreateObject("roDateTime")
    endDt.FromSeconds(m.calendarStart.AsSeconds() + 29 * 86400)
    s = m.calendarStart.GetDayOfMonth().ToStr() + " " + calendarMonthName(m.calendarStart.GetMonth(), true)
    e = endDt.GetDayOfMonth().ToStr() + " " + calendarMonthName(endDt.GetMonth(), true) + " " + endDt.GetYear().ToStr()
    return s + " – " + e
end function

function calendarEntryDate(entry as Object) as Object
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(entry.release_at)
    dt.ToLocalTime()
    return dt
end function

function calendarTwo(value as Integer) as String
    if value < 10 then return "0" + value.ToStr()
    return value.ToStr()
end function

function calendarTime(dt as Object) as String
    return calendarTwo(dt.GetHours()) + ":" + calendarTwo(dt.GetMinutes())
end function

function calendarDayHeading(dt as Object, withYear as Boolean) as String
    text = dt.GetWeekday() + " " + dt.GetDayOfMonth().ToStr() + " " + calendarMonthName(dt.GetMonth(), false)
    if withYear then text = dt.GetWeekday() + ", " + dt.GetDayOfMonth().ToStr() + " " + calendarMonthName(dt.GetMonth(), false) + " " + dt.GetYear().ToStr()
    return text
end function

function calendarEntrySubtitle(entry as Object) as String
    text = ""
    if entry.season_number <> invalid and entry.episode_number <> invalid
        text = "S" + calendarTwo(entry.season_number) + "E" + calendarTwo(entry.episode_number)
    end if
    if entry.subtitle <> invalid and entry.subtitle <> ""
        if text <> "" then text = text + " · "
        text = text + entry.subtitle
    end if
    return text
end function

function calendarKindLabel(entry as Object) as String
    if entry.media_kind = "episode" then return "Episodes"
    if entry.media_kind = "movie" then return "Movies"
    if entry.media_kind = "album" then return "Albums"
    return "Books"
end function

function calendarReleaseLabel(entry as Object) as String
    t = entry.release_type
    if t = "air" then return "Airs"
    if t = "cinema" then return "In cinemas"
    if t = "digital" then return "Digital release"
    if t = "physical" then return "Physical release"
    return "Release"
end function

sub renderCalendar()
    pageBegin("Release Calendar", 0)
    ' Controls on the right of the header row.
    pgRound(m.pageHead, 1367.4, 56.2, 50, 50, 25, "surface")
    pgRound(m.pageHead, 1367.4, 56.2, 50, 50, 25, "line", -1, true)
    pgIcon(m.pageHead, 1385, 73, 15, "arrow-left.png", "inkSoft")
    pgFocusable(1367.4, 56.2, 50, 50, 25, "calPrev")
    pgButton(m.pageHead, 1423.1, 54.8, 52.8, "Today", "secondary", "calToday")
    pgRound(m.pageHead, 1516.6, 56.2, 50, 50, 25, "surface")
    pgRound(m.pageHead, 1516.6, 56.2, 50, 50, 25, "line", -1, true)
    pgIcon(m.pageHead, 1534, 73, 15, "arrow-right.png", "inkSoft")
    pgFocusable(1516.6, 56.2, 50, 50, 25, "calNext")
    pgTile(m.pageHead, shellActionX(), shellActionY(0), "Calendar link", "tile-bell.png", "calLink")
    pgTile(m.pageHead, shellActionX(), shellActionY(1), "Filters", "tile-filters.png", "calFilters")

    rangeLabel = pgLabel(m.pageBody, 174.6, 175, 0, 40, calendarRangeLabel(), 24, 600, "ink", { vertAlign: "center" })
    pgIcon(m.pageBody, 174.6 + rangeLabel.boundingRect().width + 12, 188, 14, "chevron-down.png", "ink")

    entries = []
    if m.pageData <> invalid and m.pageData.entries <> invalid then entries = m.pageData.entries
    if m.pageStatus = "loading" and entries.Count() = 0
        pgLabel(m.pageBody, 786, 240, 600, 30, "Loading the release calendar…", 14, 400, "inkMuted")
        return
    end if
    if m.pageStatus = "error"
        pgLabel(m.pageBody, 153.6, 240, 1200, 30, m.pageError, 14, 400, "danger")
        return
    end if
    if entries.Count() = 0
        pgLabel(m.pageBody, 153.6, 240, 1200, 30, "No releases in this range.", 19, 400, "inkSoft")
        return
    end if
    selected = invalid
    if m.calendarSelected = invalid then m.calendarSelected = ""
    for each entry in entries
        if entry.id = m.calendarSelected then selected = entry
    end for
    if selected = invalid
        selected = entries[0]
        m.calendarSelected = selected.id
    end if

    ' Left: the selected entry's sheet.
    dt = calendarEntryDate(selected)
    pgLabel(m.pageHead, 153.6, 240, 600, 18, UCase(calendarKindLabel(selected) + " · " + calendarReleaseLabel(selected)), 12, 800, "inkMuted")
    pgLabel(m.pageHead, 153.6, 272, 600, 58, selected.title, 38, 600, "ink")
    pgLabel(m.pageHead, 153.6, 344, 600, 30, calendarEntrySubtitle(selected), 19, 400, "ink")
    pgLabel(m.pageHead, 153.6, 387, 600, 17, UCase("Release"), 11, 400, "inkMuted")
    pgLabel(m.pageHead, 153.6, 405, 620, 26, calendarDayHeading(dt, true) + " at " + calendarTime(dt), 19, 400, "ink")
    pgLabel(m.pageHead, 153.6, 443, 600, 17, UCase("Status"), 11, 400, "inkMuted")
    statusText = "Not monitored"
    if selected.monitored = true then statusText = "Monitored"
    if selected.has_file = true then statusText = "Available"
    badgeW = calendarBadge(m.pageHead, 153.6, 461.3, 26, statusText, 19)
    pgLabel(m.pageHead, 153.6, 498.7, 600, 17, UCase("Reported by"), 11, 400, "inkMuted")
    y = 516.0
    if selected.sources <> invalid
        for each src in selected.sources
            pgLabel(m.pageHead, 153.6, y, 620, 28, src.source_name + "  (" + src.source_kind + ")", 19, 400, "ink")
            y = y + 29
        end for
    end if
    btnY = y + 14
    x = 153.6
    playFile = ""
    openWork = ""
    if selected.actions <> invalid
        for each a in selected.actions
            if a.action = "play" and a.media_file_id <> invalid then playFile = a.media_file_id
            if a.action = "open" and a.work_id <> invalid then openWork = a.work_id
        end for
    end if
    if playFile <> ""
        x = x + pgButton(m.pageHead, x, btnY, 58, "Play", "primary", "calPlay", playFile, 24) + 10
    end if
    if openWork <> ""
        label = "Open title"
        if selected.media_kind = "episode" then label = "Open series"
        if selected.media_kind = "movie" then label = "Open movie"
        x = x + pgButton(m.pageHead, x, btnY, 58, label, "secondary", "calOpen", openWork, 24) + 10
    end if
    pgButton(m.pageHead, x, btnY, 58, "+  Add to watchlist", "secondary", "calWatch", selected, 24)

    ' Right: the agenda, grouped by day.
    ay = 240.0
    lastDay = ""
    for each entry in entries
        edt = calendarEntryDate(entry)
        day = entry.date
        if day <> lastDay
            pgLabel(m.pageBody, 786.4, ay, 900, 28, calendarDayHeading(edt, false), 18, 600, "ink")
            ay = ay + 34
            lastDay = day
        end if
        pgRound(m.pageBody, 786.4, ay, 1048.8, 99.6, 14, "surfaceStrong")
        if entry.id = m.calendarSelected then pgRound(m.pageBody, 786.4, ay, 1048.8, 99.6, 14, "ink", 56, true)
        art = ""
        if entry.work_id <> invalid then art = m.serverUrl + "/api/v1/artwork/work/" + UrlEncode(entry.work_id) + "/poster"
        pgRound(m.pageBody, 802.4, ay + 19.8, 40, 60, 6, "surfaceSoft")
        pgArtwork(m.pageBody, 802.4, ay + 19.8, 40, 60, art)
        pgLabel(m.pageBody, 856.8, ay + 9, 900, 28, entry.title, 19, 600, "ink")
        pgLabel(m.pageBody, 856.8, ay + 40, 900, 28, calendarEntrySubtitle(entry), 19, 400, "inkSoft")
        meta = calendarTime(edt)
        mx = 856.8
        pgLabel(m.pageBody, mx, ay + 71, 60, 19, meta, 13, 400, "inkMuted")
        rel = calendarReleaseLabel(entry)
        pgLabel(m.pageBody, mx + 45.6, ay + 71, 120, 19, rel, 13, 400, "inkMuted")
        kindX = mx + 45.6 + 12 + rel.Len() * 6.2
        pgLabel(m.pageBody, kindX, ay + 71, 120, 19, calendarKindLabel(entry), 13, 400, "inkMuted")
        st = "Not monitored"
        if entry.monitored = true then st = "Monitored"
        if entry.has_file = true then st = "Available"
        calendarBadge(m.pageBody, kindX + 12 + calendarKindLabel(entry).Len() * 6.4, ay + 71, 19.2, st, 13)
        pgFocusable(786.4, ay, 1048.8, 99.6, 14, "entry", entry.id, true)
        ay = ay + 114
    end for
end sub

' Status chip (web .calendar-badge): tinted pill with the status text. Returns its width.
function calendarBadge(parent as Object, x as Float, y as Float, h as Float, text as String, size as Integer) as Float
    probe = pgLabel(parent, x, y, 0, h, text, size, 600, "ink")
    w = probe.boundingRect().width + 16
    parent.removeChild(probe)
    pgRound(parent, x, y, w, h, 12, "statusTint")
    pgLabel(parent, x, y, w, h, text, size, 600, "ink", { horizAlign: "center", vertAlign: "center" })
    return w
end function

sub calendarAction(item as Object)
    a = item.action
    if a = "calPrev"
        calendarEnsureRange()
        m.calendarStart.FromSeconds(m.calendarStart.AsSeconds() - 30 * 86400)
        loadCalendar()
    else if a = "calNext"
        calendarEnsureRange()
        m.calendarStart.FromSeconds(m.calendarStart.AsSeconds() + 30 * 86400)
        loadCalendar()
    else if a = "calToday"
        m.calendarStart = invalid
        loadCalendar()
    else if a = "calPlay"
        requestPlayback(item.data)
    else if a = "calOpen"
        openWorkDetail({ id: item.data, title: "", kind: "" }, "home")
    else if a = "calWatch"
        entry = item.data
        if entry.snapshot <> invalid then sendApi("watchlistAdd", "POST", "/api/v1/watchlist", entry.snapshot, true)
    else if a = "calLink"
        sendApi("calendarFeed", "POST", "/api/v1/calendar/feed", {}, true)
    else if a = "calFilters"
        openCalendarFilters()
    end if
end sub

sub openCalendarFilters()
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Filters"
    dialog.message = ["Choose the release types to show."]
    dialog.buttons = ["All", "Episodes", "Movies", "Albums"]
    dialog.ObserveField("buttonSelected", "onCalendarFilterButton")
    m.top.dialog = dialog
end sub

sub onCalendarFilterButton(event as Object)
    index = event.GetData()
    if m.top.dialog <> invalid then m.top.dialog.close = true
    kinds = [[], ["episode"], ["movie"], ["album"]]
    if index >= 0 and index < kinds.Count() then m.calendarKinds = kinds[index]
    loadCalendar()
end sub

sub acceptCalendarFeed(data as Dynamic)
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Calendar link"
    if data <> invalid and data.url <> invalid
        dialog.message = ["Add this address to a calendar app that can subscribe to a feed:", data.url]
    else
        dialog.message = ["The calendar link could not be created."]
    end if
    dialog.buttons = ["OK"]
    dialog.ObserveField("buttonSelected", "onSimpleDialogButton")
    m.top.dialog = dialog
end sub

sub onSimpleDialogButton(event as Object)
    if m.top.dialog <> invalid then m.top.dialog.close = true
end sub

' ---------------------------------------------------------------------------
' Customise Home: per-user rail visibility and order, saved on every change (GET/PUT/DELETE /api/v1/home/rails/preferences).

sub renderCustomise()
    pageBegin("Customise Home", 729.6)
    rails = []
    if m.pageData <> invalid and m.pageData.rails <> invalid then rails = m.pageData.rails
    if m.pageStatus = "loading" and rails.Count() = 0
        pgLabel(m.pageBody, 786, 120, 600, 30, "Loading your Home rails…", 14, 400, "inkMuted")
        return
    end if
    pgLabel(m.pageBody, 786, 110, 1000, 24, "Choose which rails appear on Home and in what order.", 14, 400, "inkMuted")
    for i = 0 to rails.Count() - 1
        y = 160 + i * 84.0
        hidden = rails[i].hidden = true
        pgRound(m.pageBody, 786, y, 1048, 68, 12, "surfaceStrong")
        titleRole = "ink"
        if hidden then titleRole = "inkMuted"
        pgLabel(m.pageBody, 810, y, 640, 68, rails[i].title, 18, 700, titleRole, { vertAlign: "center" })
        shown = "Hide"
        if hidden then shown = "Show"
        pgButton(m.pageBody, 1480, y + 9, 50, shown, "secondary", "railToggle", i, 22)
        pgRound(m.pageBody, 1630, y + 9, 50, 50, 25, "surface")
        pgRound(m.pageBody, 1630, y + 9, 50, 50, 25, "line", -1, true)
        pgIcon(m.pageBody, 1646, y + 25, 18, "arrow-up.png", "inkSoft")
        pgFocusable(1630, y + 9, 50, 50, 25, "railUp", i)
        pgRound(m.pageBody, 1700, y + 9, 50, 50, 25, "surface")
        pgRound(m.pageBody, 1700, y + 9, 50, 50, 25, "line", -1, true)
        pgIcon(m.pageBody, 1716, y + 25, 18, "arrow-down.png", "inkSoft")
        pgFocusable(1700, y + 9, 50, 50, 25, "railDown", i)
    end for
    pgButton(m.pageBody, 786, 160 + rails.Count() * 84.0 + 12, 58, "Reset to default", "secondary", "railReset", invalid, 24)
end sub

sub customiseAction(item as Object)
    a = item.action
    if m.pageData = invalid or m.pageData.rails = invalid then return
    rails = m.pageData.rails
    if a = "railReset"
        sendApi("railPrefsReset", "DELETE", "/api/v1/home/rails/preferences", invalid, true)
        m.homeRailsChanged = true
        return
    end if
    i = item.data
    if i = invalid or i < 0 or i >= rails.Count() then return
    if a = "railToggle"
        rails[i].hidden = not (rails[i].hidden = true)
    else if a = "railUp" and i > 0
        t = rails[i]
        rails[i] = rails[i - 1]
        rails[i - 1] = t
    else if a = "railDown" and i < rails.Count() - 1
        t = rails[i]
        rails[i] = rails[i + 1]
        rails[i + 1] = t
    else
        return
    end if
    order = []
    hiddenIds = []
    for each rail in rails
        order.Push(rail.id)
        if rail.hidden = true then hiddenIds.Push(rail.id)
    end for
    sendApi("railPrefsSave", "PUT", "/api/v1/home/rails/preferences", { order: order, hidden: hiddenIds }, true)
    m.homeRailsChanged = true
    keep = m.pageFocusIdx
    renderCustomise()
    m.pageFocusIdx = keep
    pageFocusRender()
end sub

sub pageLeaveToHome()
    if m.pageKind = "customise" and m.homeRailsChanged = true
        m.homeRailsChanged = false
        enterHome(m.currentProfileName)
        return
    end if
    showOnly("home")
    m.top.screenState = "home"
    focusCurrentHomeRail()
end sub

' ---------------------------------------------------------------------------
' Household gate (web HouseholdBlockedScreen): while the profile is outside its schedule or out of budget the app shows
' "Not available right now" with "Ask a guardian for more time" and "Switch profile". The server decides; this only
' polls GET /api/v1/household/status (every 30 s and on entering Home) so the screen appears before a request fails.

sub householdPoll()
    if m.refreshToken = invalid or m.refreshToken = "" then return
    sendApi("householdStatus", "GET", "/api/v1/household/status", invalid, true)
end sub

sub acceptHouseholdStatus(data as Dynamic)
    m.householdBlock = invalid
    if data <> invalid
        if data.state = "outside_schedule"
            m.householdBlock = { kind: "schedule", until: data.next_start_at }
        else if data.state = "budget_exhausted"
            m.householdBlock = { kind: "budget", until: data.resets_at }
        end if
    end if
    if m.householdBlock <> invalid
        if m.top.screenState <> "page" or m.pageKind <> "household"
            openPage("household")
        end if
    else if m.top.screenState = "page" and m.pageKind = "household"
        enterHome(m.currentProfileName)
    end if
end sub

function householdUntilText(iso as Dynamic) as String
    if iso = invalid or iso = "" then return ""
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    dt.ToLocalTime()
    return calendarDayHeading(dt, true) + ", " + calendarTime(dt)
end function

sub renderHousehold()
    pageBegin("", 0)
    m.pageHead.removeChildrenIndex(m.pageHead.getChildCount(), 0)
    m.pageItems = []
    block = m.householdBlock
    title = "Not available right now"
    description = "This profile can’t watch at this time."
    if block <> invalid
        until = householdUntilText(block.until)
        if block.kind = "schedule"
            if until <> "" then description = "This profile can watch again at " + until + "."
        else
            title = "That’s all for today"
            description = "Today’s watch time is used up."
            if until <> "" then description = "Today’s watch time is used up. It resets at " + until + "."
        end if
    end if
    pgRound(m.pageBody, 742.8, 129.6, 164, 164, 82, "surface", 138)
    pgRound(m.pageBody, 742.8, 129.6, 164, 164, 82, "line", -1, true)
    pgIcon(m.pageBody, 804, 191, 40, "icon-empty.png", "brand")
    pgLabel(m.pageBody, 948.8, 181, 460, 36, title, 22, 700, "ink")
    pgLabel(m.pageBody, 948.8, 223.7, 240, 34, description, 11, 400, "inkMuted", { wrap: true, maxLines: 2 })
    askW = pgButton(m.pageBody, 723.6, 313.6, 50, "Ask a guardian for more time", "secondary", "hhAsk", invalid, 26)
    pgButton(m.pageBody, 723.6 + askW + 12, 313.6, 50, "Switch profile", "secondary", "hhSwitch", invalid, 26)
    if m.householdNote <> invalid and m.householdNote <> "" then pgLabel(m.pageBody, 723.6, 384, 900, 24, m.householdNote, 13, 400, "inkMuted")
end sub

sub householdAction(item as Object)
    if item.action = "hhSwitch"
        loadProfiles()
    else if item.action = "hhAsk"
        subject = "schedule"
        if m.householdBlock <> invalid and m.householdBlock.kind = "budget" then subject = "budget"
        sendApi("householdAsk", "POST", "/api/v1/household/approvals", { kind: "time", subject: subject }, true)
        m.householdNote = "Request sent. A guardian can approve it on their profile."
        renderHousehold()
        pageFocusRender()
    end if
end sub

' Library header chrome (web .tv-library-heading): round back button, a divider before the title count, and the Filters pill.
sub browseChromeInit()
    holder = m.top.findNode("browseGroup")
    pgRound(holder, 153.6, 56.3, 50, 50, 25, "surface", 179)
    pgRound(holder, 153.6, 56.3, 50, 50, 25, "line", -1, true)
    pgIcon(holder, 170, 73, 17, "arrow-left.png", "inkSoft")
    m.browseDivider = pgRect(holder, 348, 57, 1, 48, "line")
    tx = shellActionX()
    ty = shellActionY(0)
    pgRound(holder, tx, ty, 62, 72, 14, "surfaceStrong", 199)
    pgRound(holder, tx, ty, 62, 72, 14, "line", -1, true)
    pgIcon(holder, tx + 20, ty + 15, 22, "tile-filters.png", "inkMuted")
    pgLabel(holder, tx, ty + 44, 62, 14, "Filters", 8, 800, "inkMuted", { horizAlign: "center" })
    m.browseFiltersRing = CreateObject("roSGNode", "Poster")
    m.browseFiltersRing.uri = "pkg:/images/round-ring-r12.9.png"
    m.browseFiltersRing.translation = [tx - 3, ty - 3]
    m.browseFiltersRing.width = 68
    m.browseFiltersRing.height = 78
    ThemeSetRole(m.browseFiltersRing, "focusRing")
    m.browseFiltersRing.blendColor = ThemeColor("focusRing")
    m.browseFiltersRing.visible = false
    holder.AppendChild(m.browseFiltersRing)
end sub

' ---------------------------------------------------------------------------
' Scroll edge fades (one component for every scrollable area): a page-background ramp where content continues off-screen.
' Rails: the left fade sits in the gutter left of the track start (cards scrolled past the start line vanish under it);
' grids and panels fade at the top and bottom.

function pgFade(parent as Object, side as String, x as Float, y as Float, w as Float, h as Float) as Object
    fade = CreateObject("roSGNode", "Poster")
    fade.uri = "pkg:/images/edge-fade-" + side + ".png"
    fade.translation = [x, y]
    fade.width = w
    fade.height = h
    fade.blendColor = ThemeColor("bg")
    ThemeSetRole(fade, "bg")
    fade.visible = false
    parent.AppendChild(fade)
    return fade
end function

sub edgeFadesInit()
    home = m.top.findNode("homeGroup")
    m.homeFadeLeft = pgFade(home, "l", 786, 410, 96, 670)
    m.homeFadeRight = pgFade(home, "r", 1824, 410, 96, 670)
    browse = m.top.findNode("browseGroup")
    m.browseFadeTop = pgFade(browse, "t", 740, 128, 1110, 40)
    m.browseFadeBottom = pgFade(browse, "b", 740, 1000, 1110, 80)
    m.pageFadeTop = pgFade(m.top.findNode("pageGroup"), "t", 0, 128, 1920, 56)
    m.pageFadeBottom = pgFade(m.top.findNode("pageGroup"), "b", 0, 1000, 1920, 80)
end sub

' Home rails: the left fade once the rail is scrolled, the right fade while more cards continue past the edge.
sub homeFadesUpdate(itemIndex as Integer, total as Integer)
    m.homeFadeLeft.visible = itemIndex > 0
    m.homeFadeRight.visible = total - itemIndex > 5
end sub

sub browseFadesUpdate(itemIndex as Integer)
    row = Int(itemIndex / 3)
    totalRows = Int((m.browseItems.Count() + 2) / 3)
    m.browseFadeTop.visible = row > 0
    m.browseFadeBottom.visible = (row + 3 < totalRows) or (m.browseTotal <> invalid and m.browseItems.Count() < m.browseTotal)
end sub

sub pageFadesUpdate(contentBottom as Float)
    m.pageFadeTop.visible = m.pageScrollY < 0
    m.pageFadeBottom.visible = contentBottom + m.pageScrollY > 1040
end sub
