using System;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Core.Tests
{
    public class CalendarRulesTests
    {
        [Fact]
        public void MonthViewCoversWholeMondayStartWeeks()
        {
            var (start, end) = CalendarRules.VisibleRange(CalendarView.Month, new DateTime(2026, 10, 11));
            Assert.Equal(new DateTime(2026, 9, 28), start);
            Assert.Equal(new DateTime(2026, 11, 1), end);
        }

        [Fact]
        public void WeekAndAgendaRanges()
        {
            Assert.Equal((new DateTime(2026, 10, 5), new DateTime(2026, 10, 11)), CalendarRules.VisibleRange(CalendarView.Week, new DateTime(2026, 10, 11)));
            Assert.Equal((new DateTime(2026, 10, 11), new DateTime(2026, 11, 9)), CalendarRules.VisibleRange(CalendarView.Agenda, new DateTime(2026, 10, 11)));
            Assert.Equal(new DateTime(2026, 11, 1), CalendarRules.Step(CalendarView.Month, new DateTime(2026, 10, 11), 1));
        }

        [Fact]
        public void ToneFollowsTheWebRules()
        {
            var today = new DateTime(2026, 10, 11);
            CalendarEntry Entry(string date, bool file, bool monitored) => new CalendarEntry { Date = date, HasFile = file, Monitored = monitored };
            Assert.Equal(CalendarTone.Available, CalendarRules.Tone(Entry("2026-10-01", true, false), today));
            Assert.Equal(CalendarTone.Upcoming, CalendarRules.Tone(Entry("2026-10-12", false, true), today));
            Assert.Equal(CalendarTone.Missing, CalendarRules.Tone(Entry("2026-10-10", false, true), today));
            Assert.Equal(CalendarTone.Neutral, CalendarRules.Tone(Entry("2026-10-10", false, false), today));
        }

        [Fact]
        public void ParsesAGroupedEntry()
        {
            var response = JsonCoding.Deserialize<CalendarResponse>(
                "{\"start\":\"2026-10-01\",\"end\":\"2026-10-31\",\"sources\":[],\"entries\":[{\"id\":\"a\",\"date\":\"2026-10-05\"," +
                "\"title\":\"Sample Series 1\",\"has_file\":false,\"monitored\":true,\"media_kind\":\"episode\",\"release_type\":\"air\"," +
                "\"sources\":[],\"members\":[{\"season_number\":1,\"episode_number\":2},{\"season_number\":1,\"episode_number\":3}]}]}");
            var entry = Assert.Single(response!.Entries);
            Assert.Equal(2, entry.Members!.Count);
            Assert.Equal("S01E02", CalendarRules.EpisodeCode(entry.Members[0].SeasonNumber, entry.Members[0].EpisodeNumber));
        }
    }
}
