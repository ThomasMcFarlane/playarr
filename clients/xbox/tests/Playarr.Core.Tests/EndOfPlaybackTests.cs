using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;
using Playarr.Core.Playback;
using Xunit;

namespace Playarr.Core.Tests
{
    public class EndOfPlaybackMachineTests
    {
        private static PlaybackQueueItem Item() => new PlaybackQueueItem(Guid.NewGuid(), "Next");

        [Fact]
        public void EndsOnEndCardWhenNothingIsQueued()
        {
            var machine = new EndOfPlaybackMachine(null);
            Assert.Equal(EndOfPlaybackPhase.Playing, machine.Phase);

            machine.OnEnded();

            Assert.Equal(EndOfPlaybackPhase.EndCard, machine.Phase);
            Assert.Equal(EndOfPlaybackCommand.None, machine.PlayNow());
            Assert.Equal(EndOfPlaybackCommand.None, machine.Tick());
        }

        [Fact]
        public void CountsDownThenPlaysNext()
        {
            var machine = new EndOfPlaybackMachine(Item(), countdownSeconds: 3);
            machine.OnEnded();

            Assert.Equal(EndOfPlaybackPhase.UpNext, machine.Phase);
            Assert.Equal(3, machine.SecondsRemaining);
            Assert.Equal(EndOfPlaybackCommand.None, machine.Tick());
            Assert.Equal(EndOfPlaybackCommand.None, machine.Tick());
            Assert.Equal(EndOfPlaybackCommand.PlayNext, machine.Tick());
            Assert.Equal(0, machine.SecondsRemaining);
        }

        [Fact]
        public void PlayNowSkipsTheCountdown()
        {
            var machine = new EndOfPlaybackMachine(Item());
            machine.OnEnded();
            Assert.Equal(EndOfPlaybackCommand.PlayNext, machine.PlayNow());
        }

        [Fact]
        public void CancelStopsTheCountdownButKeepsPlayNext()
        {
            var machine = new EndOfPlaybackMachine(Item(), 5);
            machine.OnEnded();
            machine.CancelCountdown();

            Assert.Equal(EndOfPlaybackPhase.EndCard, machine.Phase);
            Assert.True(machine.CountdownCancelled);
            Assert.Equal(EndOfPlaybackCommand.None, machine.Tick());
            Assert.Equal(EndOfPlaybackCommand.PlayNext, machine.PlayNow());
        }

        [Fact]
        public void ReplayReturnsToPlayingAndCanEndAgain()
        {
            var machine = new EndOfPlaybackMachine(null);
            machine.OnEnded();

            Assert.Equal(EndOfPlaybackCommand.Replay, machine.Replay());
            Assert.Equal(EndOfPlaybackPhase.Playing, machine.Phase);

            machine.OnEnded();
            Assert.Equal(EndOfPlaybackPhase.EndCard, machine.Phase);
        }

        [Fact]
        public void ExitOnlyActsOnceTheEndUiIsShown()
        {
            var machine = new EndOfPlaybackMachine(Item());
            Assert.Equal(EndOfPlaybackCommand.None, machine.Exit());
            machine.OnEnded();
            Assert.Equal(EndOfPlaybackCommand.Exit, machine.Exit());
        }

        [Fact]
        public void AutoplayOffShowsUpNextWithoutRunningTheCountdown()
        {
            var machine = new EndOfPlaybackMachine(Item(), 3, autoplayNext: false);
            machine.OnEnded();

            Assert.Equal(EndOfPlaybackPhase.UpNext, machine.Phase);
            Assert.False(machine.CountdownRunning);
            Assert.Equal(EndOfPlaybackCommand.None, machine.Tick());
            Assert.Equal(3, machine.SecondsRemaining);
            Assert.Equal(EndOfPlaybackCommand.PlayNext, machine.PlayNow());
        }

        [Fact]
        public void PausedCountdownHoldsItsSecond()
        {
            var machine = new EndOfPlaybackMachine(Item(), 3);
            machine.OnEnded();
            machine.Paused = true;
            machine.Tick();
            Assert.Equal(3, machine.SecondsRemaining);
            machine.Paused = false;
            machine.Tick();
            Assert.Equal(2, machine.SecondsRemaining);
        }

        [Fact]
        public void CancelledCountdownNeverRestartsWithoutNewPlayback()
        {
            var machine = new EndOfPlaybackMachine(Item(), 3);
            machine.OnEnded();
            machine.CancelCountdown();
            machine.OnEnded();
            Assert.Equal(EndOfPlaybackPhase.EndCard, machine.Phase);
            Assert.Equal(EndOfPlaybackCommand.None, machine.Tick());
        }

        [Fact]
        public void EndedIsIgnoredOutsidePlaying()
        {
            var machine = new EndOfPlaybackMachine(Item(), 4);
            machine.OnEnded();
            machine.Tick();
            machine.OnEnded();
            Assert.Equal(3, machine.SecondsRemaining);
        }
    }

    public class PlaybackResumeTests
    {
        [Theory]
        [InlineData(null, 100000, null)]
        [InlineData(0L, 100000, null)]
        [InlineData(50000L, 100000, 50000L)]
        [InlineData(94999L, 100000, 94999L)]
        [InlineData(95000L, 100000, null)]
        [InlineData(100000L, 100000, null)]
        [InlineData(5000L, 0, 5000L)]
        public void NearEndResumeStartsFromZero(long? resume, long duration, long? expected)
        {
            Assert.Equal(expected, PlaybackResume.Normalise(resume, duration));
        }
    }

    public class PlaybackQueueTests
    {
        private static SeasonDetail Season(int number, params (int ep, bool file)[] eps) => new SeasonDetail
        {
            Season = new Season { Id = Guid.NewGuid(), SeasonNumber = number },
            Episodes = eps.Select(e => new EpisodeDetail
            {
                Episode = new Episode { Id = Guid.NewGuid(), EpisodeNumber = e.ep, Title = $"Ep {e.ep}" },
                MediaFileId = e.file ? Guid.NewGuid() : (Guid?)null,
            }).ToList(),
        };

        [Fact]
        public void QueuesPlayableEpisodesFromTheStartAcrossSeasons()
        {
            var s1 = Season(1, (1, true), (2, true), (3, false));
            var s2 = Season(2, (1, true));
            var start = s1.Episodes[1].Episode.Id;

            var queue = PlaybackQueue.FromSeries(Guid.NewGuid(), "Show", new[] { s2, s1 }, start);

            Assert.Equal(2, queue.Count);
            Assert.Equal(s1.Episodes[1].MediaFileId, queue[0].MediaFileId);
            Assert.Equal(s2.Episodes[0].MediaFileId, queue[1].MediaFileId);
            Assert.Equal("Show · S01E02 · Ep 2", queue[0].Title);
        }

        [Fact]
        public void UnknownStartEpisodeGivesEmptyQueue()
        {
            var queue = PlaybackQueue.FromSeries(Guid.NewGuid(), null, new[] { Season(1, (1, true)) }, Guid.NewGuid());
            Assert.Empty(queue);
        }

        [Fact]
        public void SuggestionsDropCurrentWorkAndDuplicatesAndCap()
        {
            var current = Guid.NewGuid();
            var dup = new Work { Id = Guid.NewGuid() };
            var list = new List<Work> { new Work { Id = current }, dup, dup, new Work { Id = Guid.NewGuid() }, new Work { Id = Guid.NewGuid() } };

            var result = PlaybackQueue.Suggestions(list, current, 2);

            Assert.Equal(2, result.Count);
            Assert.DoesNotContain(result, w => w.Id == current);
            Assert.Empty(PlaybackQueue.Suggestions(null, current));
        }
    }
}
