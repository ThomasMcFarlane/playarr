using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json;

namespace Playarr.Core.Models
{
    /// <summary>One release on the calendar (<c>GET /api/v1/calendar</c>), as the web's <c>CalendarEntry</c>.</summary>
    public sealed class CalendarEntry
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        /// <summary>UTC calendar day, <c>YYYY-MM-DD</c>.</summary>
        [JsonProperty("date")] public string Date { get; set; } = string.Empty;

        [JsonProperty("title")] public string Title { get; set; } = string.Empty;

        [JsonProperty("subtitle")] public string? Subtitle { get; set; }

        [JsonProperty("season_number")] public int? SeasonNumber { get; set; }

        [JsonProperty("episode_number")] public int? EpisodeNumber { get; set; }

        [JsonProperty("has_file")] public bool HasFile { get; set; }

        [JsonProperty("monitored")] public bool Monitored { get; set; }

        [JsonProperty("media_kind")] public string MediaKind { get; set; } = string.Empty;

        [JsonProperty("release_type")] public string ReleaseType { get; set; } = string.Empty;

        /// <summary>Exact instant when known; absent for all-day entries.</summary>
        [JsonProperty("release_at")] public string? ReleaseAt { get; set; }

        [JsonProperty("poster_url")] public string? PosterUrl { get; set; }

        [JsonProperty("overview")] public string? Overview { get; set; }

        [JsonProperty("work_id")] public Guid? WorkId { get; set; }

        /// <summary>Episodes folded into this entry by <c>group=series_day</c>.</summary>
        [JsonProperty("members")] public IList<CalendarGroupMember>? Members { get; set; }
    }

    public sealed class CalendarGroupMember
    {
        [JsonProperty("season_number")] public int? SeasonNumber { get; set; }

        [JsonProperty("episode_number")] public int? EpisodeNumber { get; set; }

        [JsonProperty("subtitle")] public string? Subtitle { get; set; }
    }

    public sealed class CalendarResponse
    {
        [JsonProperty("entries")] public IList<CalendarEntry> Entries { get; set; } = new List<CalendarEntry>();
    }

    public enum CalendarView
    {
        Month,
        Week,
        Agenda,
    }

    /// <summary>The web calendar's pill tones (<c>lib/calendar.ts</c> <c>entryPillTone</c>).</summary>
    public enum CalendarTone
    {
        Available,
        Upcoming,
        Missing,
        Neutral,
    }

    /// <summary>Date logic shared with the web calendar (<c>lib/calendar.ts</c>); weeks start on Monday.</summary>
    public static class CalendarRules
    {
        public const int AgendaDays = 30;

        /// <summary>First and last visible day for a view anchored on <paramref name="anchor"/>.</summary>
        public static (DateTime Start, DateTime End) VisibleRange(CalendarView view, DateTime anchor)
        {
            anchor = anchor.Date;
            switch (view)
            {
                case CalendarView.Month:
                    var first = new DateTime(anchor.Year, anchor.Month, 1);
                    var last = first.AddMonths(1).AddDays(-1);
                    return (StartOfWeek(first), StartOfWeek(last).AddDays(6));
                case CalendarView.Week:
                    var start = StartOfWeek(anchor);
                    return (start, start.AddDays(6));
                default:
                    return (anchor, anchor.AddDays(AgendaDays - 1));
            }
        }

        /// <summary>The anchor one period before (-1) or after (+1).</summary>
        public static DateTime Step(CalendarView view, DateTime anchor, int direction) => view switch
        {
            CalendarView.Month => new DateTime(anchor.Year, anchor.Month, 1).AddMonths(direction),
            CalendarView.Week => anchor.AddDays(7 * direction),
            _ => anchor.AddDays(AgendaDays * direction),
        };

        public static DateTime StartOfWeek(DateTime day) => day.Date.AddDays(-(((int)day.DayOfWeek + 6) % 7));

        /// <summary>
        /// The instant a release happens, or null for an all-day release. The server stores date-only releases as
        /// midnight UTC: a date, not a moment, so it never shifts day or shows a time (web <c>releaseInstant</c>).
        /// </summary>
        public static DateTimeOffset? ReleaseInstant(CalendarEntry entry)
        {
            if (string.IsNullOrEmpty(entry.ReleaseAt)
                || !DateTimeOffset.TryParse(entry.ReleaseAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at))
            {
                return null;
            }

            return at.UtcDateTime.TimeOfDay == TimeSpan.Zero ? (DateTimeOffset?)null : at;
        }

        /// <summary>The release's local calendar day (the exact instant when known, else the UTC date).</summary>
        public static DateTime LocalDay(CalendarEntry entry)
        {
            if (ReleaseInstant(entry) is { } at)
            {
                return at.ToLocalTime().Date;
            }

            return DateTime.TryParseExact(entry.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
                ? day
                : DateTime.MinValue;
        }

        /// <summary>Have it, not out yet, out but absent (and tracked), or nothing to report.</summary>
        public static CalendarTone Tone(CalendarEntry entry, DateTime today)
        {
            if (entry.HasFile) return CalendarTone.Available;
            if (LocalDay(entry) > today.Date) return CalendarTone.Upcoming;
            return entry.Monitored ? CalendarTone.Missing : CalendarTone.Neutral;
        }

        /// <summary>"S02E01" style episode code, or empty.</summary>
        public static string EpisodeCode(int? season, int? episode) =>
            season is { } s && episode is { } e
                ? $"S{s.ToString("00", CultureInfo.InvariantCulture)}E{e.ToString("00", CultureInfo.InvariantCulture)}"
                : string.Empty;
    }
}
