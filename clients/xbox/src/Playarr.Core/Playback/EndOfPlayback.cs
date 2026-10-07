using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;

namespace Playarr.Core.Playback
{
    /// <summary>One playable entry in the queue handed to the player (an episode, for series).</summary>
    public sealed class PlaybackQueueItem
    {
        public PlaybackQueueItem(Guid mediaFileId, string? title = null, Guid? workId = null)
        {
            MediaFileId = mediaFileId;
            Title = title;
            WorkId = workId;
        }

        public Guid MediaFileId { get; }

        public string? Title { get; }

        /// <summary>The work this item belongs to, used to look up suggestions. May differ per item.</summary>
        public Guid? WorkId { get; }
    }

    /// <summary>Resume-position rules shared by every client.</summary>
    public static class PlaybackResume
    {
        /// <summary>A position this close to the end counts as watched.</summary>
        public const long WatchedTailMs = 5000;

        /// <summary>
        /// Starting an item resumed within 5 s of its end plays from 0
        /// instead of ending immediately.
        /// </summary>
        public static long? Normalise(long? resumeMs, long durationMs)
        {
            if (resumeMs is not { } position || position <= 0)
            {
                return null;
            }

            return durationMs > 0 && position >= durationMs - WatchedTailMs ? (long?)null : position;
        }

        /// <summary>
        /// The resume point from the server's saved progress: only a part-watched
        /// item with a positive position resumes (the web client's rule).
        /// </summary>
        public static long? FromProgress(WatchProgress? progress) =>
            progress is { State: WatchState.InProgress } && progress.PositionMs > 0
                ? (long?)progress.PositionMs
                : null;

        /// <summary>
        /// Progress is only written once playback has really started and the
        /// position is positive, so a stalled or cancelled start can never
        /// overwrite the saved resume point with 0.
        /// </summary>
        public static bool ShouldReport(bool playbackStarted, long positionMs) =>
            playbackStarted && positionMs > 0;
    }

    /// <summary>Builds the up-next queue from a work's children.</summary>
    public static class PlaybackQueue
    {
        /// <summary>
        /// Flattens a series into the playable episodes (those with a media
        /// file) that follow, and include, <paramref name="startEpisodeId"/>,
        /// in season then episode order. Returns an empty list when the
        /// start episode is not in the series or has no file.
        /// </summary>
        public static IList<PlaybackQueueItem> FromSeries(
            Guid seriesWorkId, string? seriesTitle, IEnumerable<SeasonDetail> seasons, Guid startEpisodeId)
        {
            var queue = new List<PlaybackQueueItem>();
            var started = false;
            foreach (var season in seasons.OrderBy(s => s.Season.SeasonNumber))
            {
                foreach (var detail in season.Episodes.OrderBy(e => e.Episode.EpisodeNumber))
                {
                    if (!started && detail.Episode.Id == startEpisodeId)
                    {
                        started = true;
                    }

                    if (!started || detail.MediaFileId is not { } fileId)
                    {
                        continue;
                    }

                    var label = $"S{season.Season.SeasonNumber:00}E{detail.Episode.EpisodeNumber:00}";
                    var name = string.IsNullOrWhiteSpace(detail.Episode.Title)
                        ? label
                        : $"{label} · {detail.Episode.Title}";
                    queue.Add(new PlaybackQueueItem(
                        fileId,
                        string.IsNullOrWhiteSpace(seriesTitle) ? name : $"{seriesTitle} · {name}",
                        seriesWorkId));
                }
            }

            return queue;
        }

        /// <summary>
        /// Suggestions for the end screen: the similar works minus the one
        /// just watched and any duplicates, capped at <paramref name="max"/>.
        /// </summary>
        public static IList<Work> Suggestions(IEnumerable<Work>? similar, Guid? currentWorkId, int max = 12)
        {
            if (similar is null)
            {
                return new List<Work>();
            }

            var seen = new HashSet<Guid>();
            return similar
                .Where(w => w.Id != currentWorkId && seen.Add(w.Id))
                .Take(Math.Max(0, max))
                .ToList();
        }
    }

    /// <summary>What the end-of-playback screen is showing.</summary>
    public enum EndOfPlaybackPhase
    {
        /// <summary>Media is playing (or loading); no end UI.</summary>
        Playing,

        /// <summary>Finished with nothing queued (or countdown cancelled): Replay, Exit, suggestions.</summary>
        EndCard,

        /// <summary>Finished with a next item: countdown, Play now, Cancel, Exit, suggestions.</summary>
        UpNext,
    }

    /// <summary>The side effect the host must perform after a transition.</summary>
    public enum EndOfPlaybackCommand
    {
        None,
        Replay,
        PlayNext,
        Exit,
    }

    /// <summary>
    /// Pure state machine for the end-of-playback experience. The host feeds
    /// it events (<see cref="OnEnded"/>, one-second <see cref="Tick"/>s, user
    /// choices) and performs the returned <see cref="EndOfPlaybackCommand"/>.
    /// No clock, no UI, no I/O, so it is fully unit-testable.
    /// </summary>
    public sealed class EndOfPlaybackMachine
    {
        public const int DefaultCountdownSeconds = 10;

        private readonly int _countdownSeconds;

        /// <param name="next">The queued item that follows, or null for a plain end card.</param>
        /// <param name="countdownSeconds">Countdown length; the spec fixes it at 10.</param>
        /// <param name="autoplayNext">
        /// When false the up-next card is shown but the countdown never runs
        /// (Play now is the primary action). Xbox has no preference for this
        /// yet, so the host passes true.
        /// </param>
        public EndOfPlaybackMachine(
            PlaybackQueueItem? next,
            int countdownSeconds = DefaultCountdownSeconds,
            bool autoplayNext = true)
        {
            AutoplayNext = autoplayNext;
            Next = next;
            _countdownSeconds = Math.Max(1, countdownSeconds);
        }

        public EndOfPlaybackPhase Phase { get; private set; } = EndOfPlaybackPhase.Playing;

        /// <summary>The queued item that follows, if any.</summary>
        public PlaybackQueueItem? Next { get; }

        public int SecondsRemaining { get; private set; }

        public bool AutoplayNext { get; }

        /// <summary>True while the app is backgrounded or covered; <see cref="Tick"/> does nothing.</summary>
        public bool Paused { get; set; }

        /// <summary>True when ticks should be delivered (up next, autoplay on).</summary>
        public bool CountdownRunning => Phase == EndOfPlaybackPhase.UpNext && AutoplayNext;

        /// <summary>True once the countdown was cancelled; the end card still offers Play next.</summary>
        public bool CountdownCancelled { get; private set; }

        /// <summary>Playback reached the end of the media.</summary>
        public void OnEnded()
        {
            if (Phase != EndOfPlaybackPhase.Playing)
            {
                return;
            }

            if (Next is null)
            {
                Phase = EndOfPlaybackPhase.EndCard;
                return;
            }

            Phase = EndOfPlaybackPhase.UpNext;
            SecondsRemaining = _countdownSeconds;
        }

        /// <summary>One second elapsed. Returns PlayNext when the countdown completes.</summary>
        public EndOfPlaybackCommand Tick()
        {
            if (!CountdownRunning || Paused)
            {
                return EndOfPlaybackCommand.None;
            }

            SecondsRemaining--;
            if (SecondsRemaining > 0)
            {
                return EndOfPlaybackCommand.None;
            }

            SecondsRemaining = 0;
            return EndOfPlaybackCommand.PlayNext;
        }

        /// <summary>Stop the countdown and stay on the end card.</summary>
        public void CancelCountdown()
        {
            if (Phase != EndOfPlaybackPhase.UpNext)
            {
                return;
            }

            Phase = EndOfPlaybackPhase.EndCard;
            CountdownCancelled = true;
            SecondsRemaining = 0;
        }

        /// <summary>Play the next item immediately (Play now, or Play next from the end card).</summary>
        public EndOfPlaybackCommand PlayNow() =>
            Phase != EndOfPlaybackPhase.Playing && Next is not null
                ? EndOfPlaybackCommand.PlayNext
                : EndOfPlaybackCommand.None;

        /// <summary>Replay the item that just finished.</summary>
        public EndOfPlaybackCommand Replay()
        {
            if (Phase == EndOfPlaybackPhase.Playing)
            {
                return EndOfPlaybackCommand.None;
            }

            Phase = EndOfPlaybackPhase.Playing;
            SecondsRemaining = 0;
            CountdownCancelled = false;
            return EndOfPlaybackCommand.Replay;
        }

        public EndOfPlaybackCommand Exit() =>
            Phase == EndOfPlaybackPhase.Playing ? EndOfPlaybackCommand.None : EndOfPlaybackCommand.Exit;
    }
}
