using System;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Xunit;

namespace Playarr.Core.Tests
{
    public class WatchLeavesTests
    {
        [Fact]
        public void FilmLeafCarriesItsRuntime()
        {
            var detail = JsonCoding.Deserialize<WorkDetail>(
                "{\"work\":{\"id\":\"00000000-0000-0000-0000-000000000001\",\"kind\":\"movie\",\"title\":\"Test Movie A\"}," +
                "\"children\":\"Movie\",\"media_file_id\":\"00000000-0000-0000-0000-0000000000f1\",\"runtime_ms\":6000000}");
            var leaf = Assert.Single(detail!.PlayableLeaves());
            Assert.Equal(Guid.Parse("00000000-0000-0000-0000-0000000000f1"), leaf.MediaFileId);
            Assert.Equal(6000000, leaf.RuntimeMs);
        }

        [Fact]
        public void CompletedIsOmittedForOrdinaryProgress()
        {
            Assert.DoesNotContain("completed", JsonCoding.Serialize(new UpdateWatchProgressRequest { PositionMs = 1, DurationMs = 2 }));
            Assert.Contains("\"completed\":true", JsonCoding.Serialize(new UpdateWatchProgressRequest { PositionMs = 2, DurationMs = 2, Completed = true }));
        }
    }
}
