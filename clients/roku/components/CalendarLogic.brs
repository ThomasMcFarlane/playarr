' CalendarLogic.brs
'
' Pure release-calendar logic for the Roku agenda (mirrors
' clients/tv-web/web/src/lib/calendar.ts and calendarFilters.ts). No node or
' network access, so it runs unchanged under the Linux BrightScript test
' runner (tests/brs). Days are "YYYY-MM-DD" strings in UTC unless a function
' says "local".

function CalPad2(n as Integer) as String
    if n < 10 then return "0" + n.ToStr()
    return n.ToStr()
end function

' Days since 1970-01-01 for a civil date (proleptic Gregorian).
function CalDaysFromCivil(y as Integer, m as Integer, d as Integer) as Integer
    if m <= 2 then y = y - 1
    era = y \ 400
    if y < 0 and (y mod 400) <> 0 then era = era - 1
    yoe = y - era * 400
    mp = m - 3
    if m <= 2 then mp = m + 9
    doy = (153 * mp + 2) \ 5 + d - 1
    doe = yoe * 365 + yoe \ 4 - yoe \ 100 + doy
    return era * 146097 + doe - 719468
end function

' Inverse of CalDaysFromCivil; returns { y, m, d }.
function CalCivilFromDays(days as Integer) as Object
    z = days + 719468
    era = z \ 146097
    if z < 0 and (z mod 146097) <> 0 then era = era - 1
    doe = z - era * 146097
    yoe = (doe - doe \ 1460 + doe \ 36524 - doe \ 146096) \ 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe \ 4 - yoe \ 100)
    mp = (5 * doy + 2) \ 153
    d = doy - (153 * mp + 2) \ 5 + 1
    m = mp + 3
    if mp >= 10 then m = mp - 9
    if m <= 2 then y = y + 1
    return { y: y, m: m, d: d }
end function

function CalIsDay(value as Dynamic) as Boolean
    if value = invalid or Type(value) <> "roString" and Type(value) <> "String" then return false
    if Len(value) <> 10 then return false
    if Mid(value, 5, 1) <> "-" or Mid(value, 8, 1) <> "-" then return false
    return true
end function

' Parses "YYYY-MM-DD" into days since the epoch, or invalid.
function CalParseDay(day as String) as Dynamic
    if not CalIsDay(day) then return invalid
    y = Val(Left(day, 4))
    m = Val(Mid(day, 6, 2))
    d = Val(Mid(day, 9, 2))
    if m < 1 or m > 12 or d < 1 or d > 31 then return invalid
    return CalDaysFromCivil(y, m, d)
end function

function CalFormatDay(days as Integer) as String
    c = CalCivilFromDays(days)
    return Right("0000" + c.y.ToStr(), 4) + "-" + CalPad2(c.m) + "-" + CalPad2(c.d)
end function

function CalAddDays(day as String, count as Integer) as String
    days = CalParseDay(day)
    if days = invalid then return day
    return CalFormatDay(days + count)
end function

' 0 = Sunday ... 6 = Saturday.
function CalWeekday(day as String) as Integer
    days = CalParseDay(day)
    if days = invalid then return 0
    w = (days + 4) mod 7
    if w < 0 then w = w + 7
    return w
end function

function CalWeekdayName(index as Integer) as String
    names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    return names[index]
end function

function CalMonthName(month as Integer) as String
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return names[month - 1]
end function

' "Monday 6 October".
function CalFormatDayHeading(day as String) as String
    days = CalParseDay(day)
    if days = invalid then return day
    c = CalCivilFromDays(days)
    return CalWeekdayName(CalWeekday(day)) + " " + c.d.ToStr() + " " + CalMonthName(c.m)
end function

' "6 Oct - 4 Nov 2026" style label for an inclusive range.
function CalFormatRange(startDay as String, endDay as String) as String
    a = CalParseDay(startDay)
    b = CalParseDay(endDay)
    if a = invalid or b = invalid then return startDay + " - " + endDay
    ca = CalCivilFromDays(a)
    cb = CalCivilFromDays(b)
    return ca.d.ToStr() + " " + Left(CalMonthName(ca.m), 3) + " - " + cb.d.ToStr() + " " + Left(CalMonthName(cb.m), 3) + " " + cb.y.ToStr()
end function

' Agenda pages are 30 days, like web (AGENDA_DAYS).
function CalAgendaDays() as Integer
    return 30
end function

function CalAgendaEnd(anchor as String) as String
    return CalAddDays(anchor, CalAgendaDays() - 1)
end function

' The request window pads the visible range by a day each side so entries whose
' local day differs from their UTC day are still returned (web fetchWindow).
function CalFetchPath(anchor as String) as String
    startDay = CalAddDays(anchor, -1)
    endDay = CalAddDays(CalAgendaEnd(anchor), 1)
    return "/api/v1/calendar?start=" + startDay + "&end=" + endDay
end function

' Local calendar day of an entry: the release instant converted to the device's
' time zone, else the UTC `date`.
function CalEntryLocalDay(entry as Object) as String
    fallback = ""
    if entry.date <> invalid then fallback = entry.date
    if entry.release_at = invalid or entry.release_at = "" then return fallback
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(entry.release_at)
    if dt.AsSeconds() = 0 then return fallback
    dt.ToLocalTime()
    return Right("0000" + dt.GetYear().ToStr(), 4) + "-" + CalPad2(dt.GetMonth()) + "-" + CalPad2(dt.GetDayOfMonth())
end function

' "HH:MM" local time of an entry, or "" for all-day entries.
function CalEntryTime(entry as Object) as String
    if entry.release_at = invalid or entry.release_at = "" then return ""
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(entry.release_at)
    if dt.AsSeconds() = 0 then return ""
    dt.ToLocalTime()
    return CalPad2(dt.GetHours()) + ":" + CalPad2(dt.GetMinutes())
end function

function CalTodayLocal() as String
    dt = CreateObject("roDateTime")
    dt.ToLocalTime()
    return Right("0000" + dt.GetYear().ToStr(), 4) + "-" + CalPad2(dt.GetMonth()) + "-" + CalPad2(dt.GetDayOfMonth())
end function

' "S01E02" or "".
function CalEpisodeCode(entry as Object) as String
    if entry.season_number = invalid or entry.episode_number = invalid then return ""
    return "S" + CalPad2(entry.season_number) + "E" + CalPad2(entry.episode_number)
end function

' "inLibrary", "monitored" or "notMonitored".
function CalEntryState(entry as Object) as String
    if entry.has_file = true then return "inLibrary"
    if entry.monitored = true then return "monitored"
    return "notMonitored"
end function

function CalStateLabel(state as String) as String
    if state = "inLibrary" then return "In library"
    if state = "monitored" then return "Monitored"
    return "Not monitored"
end function

function CalReleaseLabel(releaseType as Dynamic) as String
    if releaseType = "air" then return "Airs"
    if releaseType = "cinema" then return "In cinemas"
    if releaseType = "digital" then return "Digital release"
    if releaseType = "physical" then return "Physical release"
    return "Release"
end function

function CalKindLabel(kind as Dynamic) as String
    if kind = "episode" then return "Episodes"
    if kind = "movie" then return "Movies"
    if kind = "album" then return "Albums"
    if kind = "book" then return "Books"
    return ""
end function

' Filter type key for a media kind (tv, movie, music, book).
function CalTypeForKind(kind as Dynamic) as String
    if kind = "episode" then return "tv"
    if kind = "album" then return "music"
    if kind = "book" then return "book"
    return "movie"
end function

' Sources that did not answer cleanly (never silently dropped).
function CalFailedSources(sources as Dynamic) as Object
    failed = []
    if sources = invalid then return failed
    for each source in sources
        if source.status <> "ok" then failed.Push(source)
    end for
    return failed
end function

function CalSourceReason(source as Object) as String
    label = "returned an error"
    if source.status = "unreachable" then label = "unreachable"
    if source.status = "rejected" then label = "rejected the request"
    if source.error <> invalid and source.error <> "" then label = label + " (" + source.error + ")"
    return label
end function

' One line for the source banner, or "" when every source answered.
function CalSourceBanner(sources as Dynamic) as String
    failed = CalFailedSources(sources)
    if failed.Count() = 0 then return ""
    text = failed.Count().ToStr() + " source(s) could not be read, so some releases may be missing: "
    first = true
    for each source in failed
        if not first then text = text + "; "
        text = text + source.name + " " + CalSourceReason(source)
        first = false
    end for
    return text
end function

function CalEmptyFilters() as Object
    return { types: {}, statuses: {}, sources: {}, monitoredOnly: false }
end function

function CalActiveFilterCount(filters as Object) as Integer
    count = 0
    if filters.types.Count() > 0 then count = count + 1
    if filters.statuses.Count() > 0 then count = count + 1
    if filters.sources.Count() > 0 then count = count + 1
    if filters.monitoredOnly then count = count + 1
    return count
end function

function CalMatchesStatus(entry as Object, status as String, today as String) as Boolean
    aired = CalEntryLocalDay(entry) <= today
    if status = "aired" then return aired
    if status = "upcoming" then return not aired
    if status = "downloaded" then return entry.has_file = true
    if status = "missing" then return aired and entry.has_file <> true
    return false
end function

' Selected values within one filter are OR-ed, different filters are AND-ed.
function CalApplyFilters(entries as Object, filters as Object, today as String) as Object
    result = []
    for each entry in entries
        keep = true
        if filters.types.Count() > 0 and not filters.types.DoesExist(CalTypeForKind(entry.media_kind)) then keep = false
        if keep and filters.sources.Count() > 0
            hit = false
            if entry.sources <> invalid
                for each source in entry.sources
                    if filters.sources.DoesExist(source.source_instance_id) then hit = true
                end for
            end if
            if not hit then keep = false
        end if
        if keep and filters.statuses.Count() > 0
            hit = false
            for each status in filters.statuses
                if CalMatchesStatus(entry, status, today) then hit = true
            end for
            if not hit then keep = false
        end if
        if keep and filters.monitoredOnly and entry.monitored <> true then keep = false
        if keep then result.Push(entry)
    end for
    return result
end function

' "S02E04-E06", "S02E01, E03" or "S01E10, S02E01-E02" (web formatEpisodeCodes).
function CalFormatEpisodeCodes(entries as Object) as String
    seasons = []
    bySeason = {}
    for each entry in entries
        if entry.season_number <> invalid and entry.episode_number <> invalid
            key = entry.season_number.ToStr()
            if not bySeason.DoesExist(key)
                bySeason[key] = []
                seasons.Push(entry.season_number)
            end if
            known = false
            for each ep in bySeason[key]
                if ep = entry.episode_number then known = true
            end for
            if not known then bySeason[key].Push(entry.episode_number)
        end if
    end for
    CalSortIntegers(seasons)
    parts = []
    for each season in seasons
        episodes = bySeason[season.ToStr()]
        CalSortIntegers(episodes)
        runs = []
        for each ep in episodes
            last = runs.Count() - 1
            if last >= 0 and ep = runs[last].to + 1
                runs[last].to = ep
            else
                runs.Push({ from: ep, to: ep })
            end if
        end for
        index = 0
        for each run in runs
            prefix = ""
            if index = 0 then prefix = "S" + CalPad2(season)
            text = prefix + "E" + CalPad2(run.from)
            if run.to <> run.from then text = text + "-E" + CalPad2(run.to)
            parts.Push(text)
            index = index + 1
        end for
    end for
    return CalJoin(parts, ", ")
end function

sub CalSortIntegers(values as Object)
    n = values.Count()
    for i = 1 to n - 1
        v = values[i]
        j = i - 1
        while j >= 0 and values[j] > v
            values[j + 1] = values[j]
            j = j - 1
        end while
        values[j + 1] = v
    end for
end sub

function CalJoin(values as Object, separator as String) as String
    result = ""
    for each value in values
        if result <> "" then result = result + separator
        result = result + value
    end for
    return result
end function

' Agenda rows for the filtered entries: a "day" row per local day followed by
' one "item" row per release. Episodes of the same series on the same local day
' and air time collapse into one item (web groupSeriesEpisodes).
function CalBuildAgenda(entries as Object, today as String) as Object
    days = []
    byDay = {}
    for each entry in entries
        day = CalEntryLocalDay(entry)
        if not byDay.DoesExist(day)
            byDay[day] = []
            days.Push(day)
        end if
        byDay[day].Push(entry)
    end for
    days.Sort()
    rows = []
    for each day in days
        heading = CalFormatDayHeading(day)
        if day = today then heading = heading + "  -  Today"
        rows.Push({ kind: "day", day: day, heading: heading })
        for each item in CalGroupDay(byDay[day])
            item.kind = "item"
            item.day = day
            rows.Push(item)
        end for
    end for
    return rows
end function

function CalGroupDay(entries as Object) as Object
    order = []
    buckets = {}
    for each entry in entries
        groupable = entry.media_kind = "episode" and entry.season_number <> invalid and entry.episode_number <> invalid
        key = "single:" + entry.id
        if groupable
            workKey = entry.title
            if entry.work_id <> invalid then workKey = entry.work_id
            slot = CalEntryTime(entry)
            if slot = "" then slot = "all-day"
            key = "series:" + workKey + ":" + slot
        end if
        if not buckets.DoesExist(key)
            buckets[key] = []
            order.Push(key)
        end if
        buckets[key].Push(entry)
    end for
    items = []
    for each key in order
        members = buckets[key]
        items.Push(CalItemForEntries(key, members))
    end for
    return items
end function

function CalItemForEntries(key as String, members as Object) as Object
    first = members[0]
    isGroup = members.Count() > 1
    subtitle = ""
    state = CalEntryState(first)
    if isGroup
        codes = CalFormatEpisodeCodes(members)
        subtitle = members.Count().ToStr() + " episodes - " + codes
        allFiles = true
        anyMonitored = false
        for each member in members
            if member.has_file <> true then allFiles = false
            if member.monitored = true then anyMonitored = true
        end for
        if allFiles
            state = "inLibrary"
        else if anyMonitored
            state = "monitored"
        else
            state = "notMonitored"
        end if
    else
        code = CalEpisodeCode(first)
        if code <> "" then subtitle = code
        if first.subtitle <> invalid and first.subtitle <> ""
            if subtitle <> "" then subtitle = subtitle + " - "
            subtitle = subtitle + first.subtitle
        end if
    end if
    time = CalEntryTime(first)
    if time = "" then time = "All day"
    meta = time + "  -  " + CalReleaseLabel(first.release_type)
    if not isGroup then meta = meta + "  -  " + CalKindLabel(first.media_kind)
    meta = meta + "  -  " + CalStateLabel(state)
    return {
        key: key
        title: first.title
        subtitle: subtitle
        meta: meta
        state: state
        entries: members
        isGroup: isGroup
        workId: first.work_id
        mediaKind: first.media_kind
        posterUrl: first.poster_url
    }
end function

' First selectable (item) row index at or after `from`, searching in `step`
' direction; -1 when there is none.
function CalNextItemIndex(rows as Object, from as Integer, dir as Integer) as Integer
    i = from
    while i >= 0 and i < rows.Count()
        if rows[i].kind = "item" then return i
        i = i + dir
    end while
    return -1
end function

' "5 minutes" / "3 hours" / "2.5 days" for the typical-availability line.
function CalHumanDuration(seconds as Dynamic) as String
    if seconds = invalid then return ""
    s = seconds
    if s < 3600
        v = s / 60
        unit = "minute"
    else if s < 86400
        v = s / 3600
        unit = "hour"
    else
        v = s / 86400
        unit = "day"
    end if
    v = Int(v * 10 + 0.5) / 10
    text = v.ToStr()
    if Right(text, 2) = ".0" then text = Left(text, Len(text) - 2)
    if v <> 1 then unit = unit + "s"
    return text + " " + unit
end function

' Option lists for the filters panel. `sources` is the response's sources[].
function CalFilterSections(sources as Dynamic) as Object
    sections = [
        { id: "types", title: "Type", options: [{ id: "tv", label: "TV" }, { id: "movie", label: "Movies" }, { id: "music", label: "Music" }, { id: "book", label: "Books" }] }
        { id: "statuses", title: "Status", options: [{ id: "aired", label: "Aired" }, { id: "upcoming", label: "Upcoming" }, { id: "downloaded", label: "Downloaded" }, { id: "missing", label: "Missing" }] }
    ]
    if sources <> invalid and sources.Count() > 1
        options = []
        for each source in sources
            options.Push({ id: source.source_instance_id, label: source.name })
        end for
        sections.Push({ id: "sources", title: "Source", options: options })
    end if
    sections.Push({ id: "monitored", title: "Monitoring", options: [{ id: "only", label: "Monitored only" }] })
    return sections
end function
