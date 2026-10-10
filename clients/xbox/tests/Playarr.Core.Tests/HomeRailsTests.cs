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
    }
}
