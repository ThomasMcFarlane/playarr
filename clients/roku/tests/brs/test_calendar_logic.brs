' include: ../../components/CalendarLogic.brs
sub main()
    failures = 0
    failures = failures + check("days round trip", CalFormatDay(CalDaysFromCivil(2026, 10, 5)), "2026-10-05")
    failures = failures + check("epoch", CalDaysFromCivil(1970, 1, 1).ToStr(), "0")
    failures = failures + check("add days across month", CalAddDays("2026-10-30", 3), "2026-11-02")
    failures = failures + check("add days negative across year", CalAddDays("2026-01-02", -3), "2025-12-30")
    failures = failures + check("leap day", CalAddDays("2028-02-28", 1), "2028-02-29")
    failures = failures + check("weekday", CalWeekday("2026-10-05").ToStr(), "1")
    failures = failures + check("heading", CalFormatDayHeading("2026-10-05"), "Monday 5 October")
    failures = failures + check("range", CalFormatRange("2026-10-05", "2026-11-03"), "5 Oct - 3 Nov 2026")
    failures = failures + check("fetch path pads a day", CalFetchPath("2026-10-05"), "/api/v1/calendar?start=2026-10-04&end=2026-11-04")
    failures = failures + check("code", CalEpisodeCode({ season_number: 1, episode_number: 2 }), "S01E02")
    failures = failures + check("code none", CalEpisodeCode({ season_number: invalid, episode_number: invalid }), "")
    failures = failures + check("state file", CalEntryState({ has_file: true, monitored: false }), "inLibrary")
    failures = failures + check("state monitored", CalEntryState({ has_file: false, monitored: true }), "monitored")
    failures = failures + check("state not monitored", CalEntryState({ has_file: false, monitored: false }), "notMonitored")
    failures = failures + check("type for album", CalTypeForKind("album"), "music")

    eps = [
        { season_number: 2, episode_number: 4 }, { season_number: 2, episode_number: 5 }, { season_number: 2, episode_number: 6 }
    ]
    failures = failures + check("codes run", CalFormatEpisodeCodes(eps), "S02E04-E06")
    eps = [{ season_number: 2, episode_number: 5 }, { season_number: 2, episode_number: 1 }, { season_number: 2, episode_number: 3 }]
    failures = failures + check("codes gaps", CalFormatEpisodeCodes(eps), "S02E01, E03, E05")
    eps = [{ season_number: 2, episode_number: 1 }, { season_number: 1, episode_number: 10 }, { season_number: 2, episode_number: 2 }]
    failures = failures + check("codes seasons", CalFormatEpisodeCodes(eps), "S01E10, S02E01-E02")

    sources = [{ source_instance_id: "a", name: "Source A", kind: "sonarr", status: "ok", entry_count: 3 }, { source_instance_id: "b", name: "Source B", kind: "radarr", status: "unreachable", entry_count: 0, error: "timeout" }]
    failures = failures + check("banner", CalSourceBanner(sources), "1 source(s) could not be read, so some releases may be missing: Source B unreachable (timeout)")
    failures = failures + check("banner none", CalSourceBanner([sources[0]]), "")

    e1 = entry("e1", "episode", "Sample Series 1", "2026-10-05", 1, 1, true, true, "a")
    e2 = entry("e2", "episode", "Sample Series 1", "2026-10-05", 1, 2, false, true, "a")
    e3 = entry("m1", "movie", "Test Movie A", "2026-10-06", invalid, invalid, false, false, "b")
    e4 = entry("e3", "episode", "Sample Series 2", "2026-10-04", 3, 7, false, false, "a")
    all = [e1, e2, e3, e4]

    f = CalEmptyFilters()
    failures = failures + check("no filters", CalApplyFilters(all, f, "2026-10-05").Count().ToStr(), "4")
    f.types["movie"] = true
    failures = failures + check("type filter", CalApplyFilters(all, f, "2026-10-05").Count().ToStr(), "1")
    f = CalEmptyFilters()
    f.statuses["upcoming"] = true
    failures = failures + check("upcoming", CalApplyFilters(all, f, "2026-10-05").Count().ToStr(), "1")
    f = CalEmptyFilters()
    f.statuses["missing"] = true
    failures = failures + check("missing", CalApplyFilters(all, f, "2026-10-05").Count().ToStr(), "2")
    f = CalEmptyFilters()
    f.monitoredOnly = true
    failures = failures + check("monitored only", CalApplyFilters(all, f, "2026-10-05").Count().ToStr(), "2")
    f = CalEmptyFilters()
    f.sources["b"] = true
    failures = failures + check("source filter", CalApplyFilters(all, f, "2026-10-05").Count().ToStr(), "1")
    failures = failures + check("active count", CalActiveFilterCount(f).ToStr(), "1")

    rows = CalBuildAgenda(all, "2026-10-05")
    failures = failures + check("agenda rows", rows.Count().ToStr(), "6")
    failures = failures + check("first is a day", rows[0].kind + ":" + rows[0].day, "day:2026-10-04")
    failures = failures + check("today tag", rows[2].heading, "Monday 5 October  -  Today")
    failures = failures + check("grouped item", rows[3].subtitle, "2 episodes - S01E01-E02")
    failures = failures + check("group state", rows[3].state, "monitored")
    failures = failures + check("next item from heading", CalNextItemIndex(rows, 0, 1).ToStr(), "1")
    failures = failures + check("prev item none", CalNextItemIndex(rows, 0, -1).ToStr(), "-1")
    failures = failures + check("duration hours", CalHumanDuration(7200), "2 hours")
    failures = failures + check("duration days", CalHumanDuration(129600), "1.5 days")
    failures = failures + check("sections without sources", CalFilterSections(invalid).Count().ToStr(), "3")
    failures = failures + check("sections with sources", CalFilterSections(sources).Count().ToStr(), "4")
    if failures = 0 then print "ALL PASS"
end sub

function entry(id as String, kind as String, title as String, day as String, season as Dynamic, ep as Dynamic, hasFile as Boolean, monitored as Boolean, sourceId as String) as Object
    return {
        id: id, media_kind: kind, title: title, date: day, release_type: "air"
        season_number: season, episode_number: ep, has_file: hasFile, monitored: monitored
        work_id: title, sources: [{ source_instance_id: sourceId, source_name: sourceId, source_kind: "sonarr", arr_id: 1 }]
    }
end function

function check(name as String, actual as String, expected as String) as Integer
    if actual = expected
        print "PASS " + name
        return 0
    end if
    print "FAIL " + name + ": expected [" + expected + "] got [" + actual + "]"
    return 1
end function
