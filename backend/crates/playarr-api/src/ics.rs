//! RFC 5545 rendering of calendar entries for the external subscription feed.

use chrono::{DateTime, Duration, Utc};
use playarr_model::{CalendarEntry, CalendarMediaKind, CalendarReleaseType};

/// Escapes a TEXT value (RFC 5545 section 3.3.11).
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

/// Appends a content line folded at 75 octets without splitting a UTF-8
/// sequence, terminated by CRLF.
fn push_line(out: &mut String, line: &str) {
    let mut octets = 0usize;
    for ch in line.chars() {
        let width = ch.len_utf8();
        // Continuation lines start with a space, which counts toward the limit.
        if octets + width > 75 {
            out.push_str("\r\n ");
            octets = 1;
        }
        out.push(ch);
        octets += width;
    }
    out.push_str("\r\n");
}

fn stamp(dt: DateTime<Utc>) -> String {
    dt.format("%Y%m%dT%H%M%SZ").to_string()
}

fn summary(entry: &CalendarEntry) -> String {
    match entry.media_kind {
        CalendarMediaKind::Episode => {
            let code = match (entry.season_number, entry.episode_number) {
                (Some(s), Some(e)) => format!(" S{s:02}E{e:02}"),
                _ => String::new(),
            };
            match &entry.subtitle {
                Some(name) => format!("{}{code}: {name}", entry.title),
                None => format!("{}{code}", entry.title),
            }
        }
        CalendarMediaKind::Movie => {
            let label = match entry.release_type {
                CalendarReleaseType::Cinema => "in cinemas",
                CalendarReleaseType::Digital => "digital release",
                CalendarReleaseType::Physical => "physical release",
                _ => "release",
            };
            format!("{} ({label})", entry.title)
        }
        CalendarMediaKind::Album | CalendarMediaKind::Book => match &entry.subtitle {
            Some(name) => format!("{}: {name}", entry.title),
            None => entry.title.clone(),
        },
    }
}

fn description(entry: &CalendarEntry) -> String {
    let state = if entry.has_file {
        "In your library"
    } else if entry.monitored {
        "Monitored, not yet available"
    } else {
        "Not monitored"
    };
    let sources: Vec<&str> = entry
        .sources
        .iter()
        .map(|s| s.display_label.as_str())
        .collect();
    format!("{state}\nSource: {}", sources.join(", "))
}

fn category(kind: CalendarMediaKind) -> &'static str {
    match kind {
        CalendarMediaKind::Episode => "Episode",
        CalendarMediaKind::Movie => "Movie",
        CalendarMediaKind::Album => "Album",
        CalendarMediaKind::Book => "Book",
    }
}

/// Renders a complete `VCALENDAR`. `UID`s derive from the stable entry id, so
/// a changed release replaces the old event rather than duplicating it.
pub fn render_calendar(
    entries: &[CalendarEntry],
    node_id: &str,
    calendar_name: &str,
    now: DateTime<Utc>,
) -> String {
    let mut out = String::new();
    push_line(&mut out, "BEGIN:VCALENDAR");
    push_line(&mut out, "VERSION:2.0");
    push_line(&mut out, "PRODID:-//Playarr//Release Calendar//EN");
    push_line(&mut out, "CALSCALE:GREGORIAN");
    push_line(&mut out, "METHOD:PUBLISH");
    push_line(&mut out, &format!("X-WR-CALNAME:{}", escape(calendar_name)));
    push_line(&mut out, "REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    push_line(&mut out, "X-PUBLISHED-TTL:PT1H");
    for entry in entries {
        push_line(&mut out, "BEGIN:VEVENT");
        push_line(
            &mut out,
            &format!("UID:{}@{}", entry.id.replace(' ', "_"), node_id),
        );
        push_line(&mut out, &format!("DTSTAMP:{}", stamp(now)));
        match entry.release_at {
            Some(at) => {
                push_line(&mut out, &format!("DTSTART:{}", stamp(at)));
                push_line(
                    &mut out,
                    &format!("DTEND:{}", stamp(at + Duration::hours(1))),
                );
            }
            None => {
                push_line(
                    &mut out,
                    &format!("DTSTART;VALUE=DATE:{}", entry.date.format("%Y%m%d")),
                );
                let next = entry.date + Duration::days(1);
                push_line(
                    &mut out,
                    &format!("DTEND;VALUE=DATE:{}", next.format("%Y%m%d")),
                );
            }
        }
        push_line(&mut out, &format!("SUMMARY:{}", escape(&summary(entry))));
        push_line(
            &mut out,
            &format!("DESCRIPTION:{}", escape(&description(entry))),
        );
        push_line(
            &mut out,
            &format!("CATEGORIES:{}", category(entry.media_kind)),
        );
        push_line(&mut out, "STATUS:CONFIRMED");
        push_line(&mut out, "TRANSP:TRANSPARENT");
        push_line(&mut out, "END:VEVENT");
    }
    push_line(&mut out, "END:VCALENDAR");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, TimeZone};
    use playarr_model::{CalendarEntrySource, SourceKind};
    use uuid::Uuid;

    fn entry(release_at: Option<DateTime<Utc>>) -> CalendarEntry {
        CalendarEntry {
            id: "episode:tvdb42:s2e5:air:2026-10-04".into(),
            media_kind: CalendarMediaKind::Episode,
            release_type: CalendarReleaseType::Air,
            title: "Show, The; Return".into(),
            subtitle: Some("Pilot".into()),
            season_number: Some(2),
            episode_number: Some(5),
            date: NaiveDate::from_ymd_opt(2026, 10, 4).unwrap(),
            release_at,
            monitored: true,
            has_file: false,
            poster_url: None,
            work_id: None,
            average_lag_seconds: None,
            snapshot: None,
            actions: vec![],
            members: vec![],
            sources: vec![CalendarEntrySource {
                source_instance_id: Uuid::nil(),
                source_name: "TV".into(),
                display_label: "TV".into(),
                source_kind: SourceKind::Sonarr,
                arr_id: 1,
            }],
        }
    }

    #[test]
    fn renders_all_day_and_timed_events_with_crlf_and_escaping() {
        let now = Utc.with_ymd_and_hms(2026, 10, 3, 12, 0, 0).unwrap();
        let ics = render_calendar(&[entry(None)], "node-1", "Playarr releases", now);
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261004\r\n"));
        assert!(ics.contains("DTEND;VALUE=DATE:20261005\r\n"));
        assert!(ics.contains("UID:episode:tvdb42:s2e5:air:2026-10-04@node-1\r\n"));
        assert!(ics.contains("SUMMARY:Show\\, The\\; Return S02E05: Pilot\r\n"));
        assert!(!ics.replace("\r\n", "").contains('\n'), "no bare LF");

        let at = Utc.with_ymd_and_hms(2026, 10, 4, 1, 0, 0).unwrap();
        let ics = render_calendar(&[entry(Some(at))], "node-1", "Playarr releases", now);
        assert!(ics.contains("DTSTART:20261004T010000Z\r\n"));
        assert!(ics.contains("DTEND:20261004T020000Z\r\n"));
    }

    #[test]
    fn folds_long_lines_at_75_octets_on_character_boundaries() {
        let mut e = entry(None);
        e.title = "é".repeat(120);
        let now = Utc.with_ymd_and_hms(2026, 10, 3, 12, 0, 0).unwrap();
        let ics = render_calendar(&[e], "n", "c", now);
        for line in ics.split("\r\n") {
            assert!(line.len() <= 75, "line too long: {} octets", line.len());
        }
        assert!(
            ics.contains("\r\n é"),
            "continuation lines start with a space"
        );
    }
}
