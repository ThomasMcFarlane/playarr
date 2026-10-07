using System;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Core.Playback;
using Xunit;

namespace Playarr.Core.Tests
{
    public class ProgressRulesTests
    {
        private static WatchProgress Progress(WatchState state, long positionMs) =>
            new WatchProgress { MediaFileId = Guid.NewGuid(), State = state, PositionMs = positionMs, DurationMs = 100000 };

        [Fact]
        public void ResumesOnlyFromPartWatchedProgressWithAPosition()
        {
            Assert.Equal(42000L, PlaybackResume.FromProgress(Progress(WatchState.InProgress, 42000)));
            Assert.Null(PlaybackResume.FromProgress(Progress(WatchState.InProgress, 0)));
            Assert.Null(PlaybackResume.FromProgress(Progress(WatchState.Watched, 90000)));
            Assert.Null(PlaybackResume.FromProgress(Progress(WatchState.Unwatched, 0)));
            Assert.Null(PlaybackResume.FromProgress(null));
        }

        [Fact]
        public void ServerWireStatesParse()
        {
            var part = JsonCoding.Deserialize<WatchProgress>(
                "{\"media_file_id\":\"00000000-0000-0000-0000-000000000000\",\"work_id\":\"00000000-0000-0000-0000-000000000000\"," +
                "\"position_ms\":5,\"duration_ms\":9,\"state\":\"part_watched\"}");
            Assert.Equal(WatchState.InProgress, part!.State);
            var unseen = JsonCoding.Deserialize<WatchProgress>(
                "{\"media_file_id\":\"00000000-0000-0000-0000-000000000000\",\"work_id\":\"00000000-0000-0000-0000-000000000000\"," +
                "\"position_ms\":0,\"duration_ms\":9,\"state\":\"unseen\"}");
            Assert.Equal(WatchState.Unwatched, unseen!.State);
        }

        [Fact]
        public void NeverReportsBeforePlaybackStartedOrAtPositionZero()
        {
            Assert.False(PlaybackResume.ShouldReport(false, 42000));
            Assert.False(PlaybackResume.ShouldReport(true, 0));
            Assert.True(PlaybackResume.ShouldReport(true, 1));
        }
    }
}
