using Playarr.Core.Models;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Core.Tests
{
    public class HomeRailsTests
    {
        [Fact]
        public void ParsesRailsWithTheirWorks()
        {
            var response = JsonCoding.Deserialize<HomeRailsResponse>(
                "{\"rails\":[{\"id\":\"continue\",\"kind\":\"continue\",\"title\":\"Start watching\",\"items\":[" +
                "{\"id\":\"00000000-0000-0000-0000-000000000001\",\"kind\":\"series\",\"title\":\"Sample Series 1\"," +
                "\"release_date\":\"2013-06-01\",\"end_date\":\"2016-05-01\"}],\"total\":1}],\"lang\":\"en\"}");
            var rail = Assert.Single(response!.Rails);
            Assert.Equal("Start watching", rail.Title);
            Assert.Equal("Series · 2013–2016", WorkLabels.KindWithYear(rail.Items[0]));
        }

        [Fact]
        public void YearIsTheReleaseYearNeverTheAddedDate()
        {
            Assert.Equal("Movie · 2009", WorkLabels.KindWithYear(new Work { Kind = WorkKind.Movie, ReleaseDate = "2009-12-31" }));
            Assert.Equal("Movie", WorkLabels.KindWithYear(new Work { Kind = WorkKind.Movie, AddedAt = System.DateTimeOffset.UtcNow }));
            Assert.Equal("2021", WorkLabels.YearRange(new Work { Kind = WorkKind.Series, ReleaseDate = "2021-01-01", EndDate = "2021-08-01" }));
            Assert.Null(WorkLabels.YearRange(new Work { ReleaseDate = "not a date" }));
        }

        [Fact]
        public void ParsesTimestampsWithZOrOffset()
        {
            var z = JsonCoding.Deserialize<Work>("{\"id\":\"00000000-0000-0000-0000-000000000001\",\"kind\":\"movie\",\"title\":\"Test Movie A\",\"added_at\":\"2026-08-16T11:43:46Z\"}");
            var offset = JsonCoding.Deserialize<Work>("{\"id\":\"00000000-0000-0000-0000-000000000001\",\"kind\":\"movie\",\"title\":\"Test Movie A\",\"added_at\":\"2026-08-16T18:43:46.5+07:00\"}");
            Assert.Equal(new System.DateTimeOffset(2026, 8, 16, 11, 43, 46, System.TimeSpan.Zero), z!.AddedAt);
            Assert.Equal(new System.DateTimeOffset(2026, 8, 16, 11, 43, 46, 500, System.TimeSpan.Zero), offset!.AddedAt);
        }
    }
}
