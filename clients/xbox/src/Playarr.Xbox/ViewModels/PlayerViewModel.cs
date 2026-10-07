using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Windows.Media;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.Streaming.Adaptive;
using Windows.Web.Http;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Core.Playback;
using Playarr.Xbox;
using Playarr.Xbox.Services;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>Where <see cref="PlayerPage"/>'s Render() is in its lifecycle.</summary>
    public enum PlayerLoadState
    {
        /// <summary>Negotiating playback info and building a source. Shows a spinner.</summary>
        Loading,

        /// <summary><see cref="PlayerViewModel.Player"/> has a source and is playing.</summary>
        Ready,

        /// <summary>Negotiation or source construction failed. See <see cref="PlayerViewModel.ErrorMessage"/>.</summary>
        Failed,
    }

    /// <summary>
    /// Drives <see cref="Playarr.Xbox.Views.PlayerPage"/> -- the one screen in
    /// this app that actually plays media.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Follows the same shape as every other ViewModel in this app (see
    /// <c>LoginViewModel</c>'s own remarks): a private readonly reference to
    /// <see cref="XboxAppEnvironment"/> reached via <c>App.Environment</c>,
    /// <see cref="ObservableObject.SetProperty{T}"/>-backed properties, and
    /// fire-and-forget async work the page only ever observes through
    /// <c>PropertyChanged</c>. <strong>One necessary deviation</strong>: this
    /// ViewModel also needs the media-file id from the page's navigation
    /// parameter, which UWP only makes available in <c>Page.OnNavigatedTo</c>
    /// -- not the page constructor -- so unlike every other screen here,
    /// <c>PlayerPage</c>'s constructor does not build this ViewModel;
    /// <c>OnNavigatedTo</c> does, once <c>e.Parameter</c> is in hand. See
    /// <c>PlayerPage.xaml.cs</c>'s own remarks.
    /// </para>
    /// <para>
    /// Unlike every other ViewModel in this app, this one also owns a real
    /// platform object -- <see cref="Player"/>, a
    /// <see cref="Windows.Media.Playback.MediaPlayer"/> -- rather than only
    /// plain data. <c>Windows.Media.Playback.MediaPlayer</c> is not a XAML
    /// control (that's <c>MediaPlayerElement</c>, which the page owns), so
    /// this doesn't violate the "no UI in the ViewModel" spirit of the
    /// pattern: the page attaches it with
    /// <c>MediaPlayerElement.SetMediaPlayer(viewModel.Player)</c> once and
    /// otherwise only ever reads plain properties off this class the same
    /// way every other page's Render() does.
    /// </para>
    /// </remarks>
    public sealed class PlayerViewModel : ViewModelBase, IDisposable
    {
        /// <summary>How often <see cref="ReportProgressAsync"/> runs while playing.</summary>
        private static readonly TimeSpan ProgressReportInterval = TimeSpan.FromSeconds(15);

        private readonly XboxAppEnvironment _environment;
        private readonly Guid _mediaFileId;
        private long? _resumePositionMs;

        private readonly Guid? _workId;
        private Timer? _countdownTimer;
        private bool _suggestionsRequested;
        private IList<Work> _suggestions = new List<Work>();
        private Timer? _progressTimer;
        private MediaPlaybackItem? _playbackItem;
        private bool _disposed;
        private volatile bool _playbackStarted;

        private PlayerLoadState _loadState = PlayerLoadState.Loading;
        private string? _errorMessage;
        private PlaybackInfoResponse? _playbackInfo;
        private string? _selectedAudioTrackId;
        private string? _selectedSubtitleTrackId;

        public PlayerViewModel(
            XboxAppEnvironment environment,
            Guid mediaFileId,
            long? resumePositionMs,
            string? title,
            Guid? workId = null,
            PlaybackQueueItem? next = null)
        {
            _workId = workId;
            EndOfPlayback = new EndOfPlaybackMachine(next);
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _mediaFileId = mediaFileId;
            _resumePositionMs = resumePositionMs;
            Title = title ?? string.Empty;

            Player = new MediaPlayer { AutoPlay = true };
            Player.MediaEnded += Player_MediaEnded;
            Player.PlaybackSession.PlaybackStateChanged += PlaybackSession_PlaybackStateChanged;
            ConfigureSystemMediaTransportControls();

            // Fire-and-forget -- see the type-level remarks. The page
            // re-renders as LoadState/PlaybackInfo/ErrorMessage change, not
            // by awaiting this call.
            _ = LoadAsync();
        }

        /// <summary>
        /// The real playback engine. The page attaches this to its
        /// <c>MediaPlayerElement</c> once, via <c>SetMediaPlayer</c>, and
        /// never touches it directly beyond that -- transport controls,
        /// gamepad input, and the System Media Transport Controls (wired in
        /// <see cref="ConfigureSystemMediaTransportControls"/>) all operate
        /// on this instance without further ViewModel or page involvement.
        /// </summary>
        public MediaPlayer Player { get; }

        /// <summary>End-of-playback state machine (end card / up-next countdown).</summary>
        public EndOfPlaybackMachine EndOfPlayback { get; }

        /// <summary>Similar works shown on the end screen; empty until loaded or when none.</summary>
        public IList<Work> Suggestions
        {
            get => _suggestions;
            private set => SetProperty(ref _suggestions, value);
        }

        /// <summary>Raised when the next queued item should start. Not guaranteed to be on the UI thread.</summary>
        public event EventHandler<PlaybackQueueItem>? NextRequested;

        /// <summary>Raised when the viewer chose Exit on the end screen.</summary>
        public event EventHandler? ExitRequested;

        /// <summary>Raised on Replay: the page restarts the item with a fresh playback negotiation (a new play), never a seek on the ended one.</summary>
        public event EventHandler? RestartRequested;

        /// <summary>Display title, for the on-screen overlay. May be empty.</summary>
        public string Title { get; }

        public PlayerLoadState LoadState
        {
            get => _loadState;
            private set => SetProperty(ref _loadState, value);
        }

        /// <summary>Set when <see cref="LoadState"/> is <see cref="PlayerLoadState.Failed"/>; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>The negotiated result, once <see cref="LoadState"/> reaches <see cref="PlayerLoadState.Ready"/>.</summary>
        public PlaybackInfoResponse? PlaybackInfo
        {
            get => _playbackInfo;
            private set => SetProperty(ref _playbackInfo, value);
        }

        /// <summary>
        /// The audio track id <see cref="SelectAudioTrack"/> last applied
        /// (or the server's own <c>selected_audio_track_id</c> until then).
        /// </summary>
        public string? SelectedAudioTrackId => _selectedAudioTrackId;

        /// <summary>
        /// The subtitle track id <see cref="SelectSubtitleTrack"/> last
        /// applied (or the server's own <c>selected_subtitle_track_id</c>
        /// until then); <c>null</c> means "off".
        /// </summary>
        public string? SelectedSubtitleTrackId => _selectedSubtitleTrackId;

        private void PlaybackSession_PlaybackStateChanged(MediaPlaybackSession sender, object args)
        {
            if (sender.PlaybackState == MediaPlaybackState.Playing)
            {
                _playbackStarted = true;
            }
        }

        private void Player_MediaEnded(MediaPlayer sender, object args)
        {
            if (EndOfPlayback.Phase != EndOfPlaybackPhase.Playing)
            {
                return;
            }

            EndOfPlayback.OnEnded();
            _ = ReportFinishedAsync();
            RaiseEndStateChanged();

            if (EndOfPlayback.CountdownRunning)
            {
                _countdownTimer?.Dispose();
                _countdownTimer = new Timer(
                    _ => OnCountdownTick(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
            }

            _ = LoadSuggestionsAsync();
        }

        private void OnCountdownTick()
        {
            var command = EndOfPlayback.Tick();
            RaiseEndStateChanged();
            if (command != EndOfPlaybackCommand.None)
            {
                StopCountdown();
                Perform(command);
            }
        }

        private void StopCountdown()
        {
            _countdownTimer?.Dispose();
            _countdownTimer = null;
        }

        private void RaiseEndStateChanged() => OnPropertyChanged(nameof(EndOfPlayback));

        private void Perform(EndOfPlaybackCommand command)
        {
            switch (command)
            {
                case EndOfPlaybackCommand.PlayNext when EndOfPlayback.Next != null:
                    NextRequested?.Invoke(this, EndOfPlayback.Next);
                    break;
                case EndOfPlaybackCommand.Exit:
                    ExitRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case EndOfPlaybackCommand.Replay:
                    // docs/architecture/end-of-playback.md: Replay starts a fresh
                    // playback negotiation (a new play), never a raw seek back
                    // to zero on the ended item.
                    RestartRequested?.Invoke(this, EventArgs.Empty);
                    break;
            }
        }

        /// <summary>Play now (skip the countdown), or Play next from the end card.</summary>
        public void PlayNextNow()
        {
            StopCountdown();
            Perform(EndOfPlayback.PlayNow());
        }

        /// <summary>Cancel the up-next countdown and stay on the end card.</summary>
        public void CancelCountdown()
        {
            StopCountdown();
            EndOfPlayback.CancelCountdown();
            RaiseEndStateChanged();
        }

        /// <summary>Pauses (or resumes) the up-next countdown while the app is backgrounded.</summary>
        public void SetCountdownPaused(bool paused) => EndOfPlayback.Paused = paused;

        public void Replay()
        {
            StopCountdown();
            var command = EndOfPlayback.Replay();
            RaiseEndStateChanged();
            Perform(command);
        }

        public void Exit()
        {
            StopCountdown();
            Perform(EndOfPlayback.Exit());
        }

        private async Task LoadSuggestionsAsync()
        {
            if (_suggestionsRequested || _workId is not { } workId)
            {
                return;
            }

            _suggestionsRequested = true;
            try
            {
                var similar = await _environment.ApiClient
                    .GetSimilarWorksAsync(workId, 20)
                    .ConfigureAwait(false);
                Suggestions = PlaybackQueue.Suggestions(similar, workId);
            }
            catch (Exception)
            {
                // Suggestions are decoration; the end screen works without them.
            }
        }

        /// <summary>Marks the item finished server-side so it counts as watched.</summary>
        private async Task ReportFinishedAsync()
        {
            var info = PlaybackInfo;
            if (info is null)
            {
                return;
            }

            try
            {
                await _environment.ApiClient
                    .UpdateWatchProgressAsync(
                        _mediaFileId,
                        new UpdateWatchProgressRequest { PositionMs = info.DurationMs, DurationMs = info.DurationMs })
                    .ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Best-effort, like every other progress report.
            }
        }

        /// <summary>Re-runs <see cref="LoadAsync"/> after a failed negotiation.</summary>
        public void Retry()
        {
            if (LoadState != PlayerLoadState.Failed)
            {
                return;
            }

            ErrorMessage = null;
            LoadState = PlayerLoadState.Loading;
            _ = LoadAsync();
        }

        /// <summary>
        /// Selects an audio track by the id <c>PlaybackInfoResponse.AudioTracks</c>
        /// reported.
        /// </summary>
        /// <remarks>
        /// <strong>Verification needed:</strong> this correlates the
        /// server-reported track by its position in
        /// <c>PlaybackInfo.AudioTracks</c> with the same position in
        /// <c>MediaPlaybackItem.AudioTracks</c> -- there is no shared id
        /// between the two lists to match on directly, and this position
        /// correlation is an assumption, not something this environment can
        /// confirm against a live decoded file. It also assumes
        /// <c>SingleSelectMediaTrackList</c>'s exact shape (an <c>int</c>-indexed,
        /// <c>int</c>-counted collection with a <c>uint?</c> <c>SelectedIndex</c>)
        /// from memory of the WinRT API surface, not a compiler that could
        /// check it on this machine -- re-verify both against a live Windows
        /// SDK before relying on this for anything beyond the common case of
        /// one track already selected by the container's default-track flag.
        /// </remarks>
        public void SelectAudioTrack(string trackId)
        {
            if (_playbackItem is null || PlaybackInfo is null)
            {
                return;
            }

            var index = IndexOf(PlaybackInfo.AudioTracks, trackId);
            if (index < 0 || index >= _playbackItem.AudioTracks.Count)
            {
                return;
            }

            try
            {
                _playbackItem.AudioTracks.SelectedIndex = index;
                _selectedAudioTrackId = trackId;
                OnPropertyChanged(nameof(SelectedAudioTrackId));
            }
            catch (Exception)
            {
                // See the type-level remarks: SingleSelectMediaTrackList's
                // exact failure modes here are unverified against a live SDK.
                // Leaving the previous selection in place is safer than a
                // half-applied change.
            }
        }

        /// <summary>
        /// Selects a subtitle track by id, or turns subtitles off when
        /// <paramref name="trackId"/> is <c>null</c>.
        /// </summary>
        /// <remarks>
        /// <strong>Verification needed:</strong> same position-correlation
        /// caveat as <see cref="SelectAudioTrack"/>, plus one more: making a
        /// text track actually render (rather than just being "selected")
        /// uses <c>MediaPlaybackTimedMetadataTrackList.SetPresentationMode</c>
        /// with <c>PlatformPresented</c> (every other track <c>Disabled</c>). Whether an on-demand HLS
        /// transcode's playlist ever actually carries more than one
        /// <c>#EXT-X-MEDIA</c> subtitle/audio rendition (as opposed to the
        /// server having already baked in one selected track before this
        /// client ever sees it) is also unconfirmed -- this method is
        /// therefore most likely to do anything useful for a Direct-mode
        /// file with multiple embedded subtitle streams.
        /// </remarks>
        public void SelectSubtitleTrack(string? trackId)
        {
            if (_playbackItem is null)
            {
                return;
            }

            try
            {
                // MediaPlaybackTimedMetadataTrackList: a text track renders when its presentation
                // mode is PlatformPresented; every other track is disabled.
                var textTracks = _playbackItem.TimedMetadataTracks;
                var index = trackId is null || PlaybackInfo is null
                    ? -1
                    : IndexOf(PlaybackInfo.SubtitleTracks, trackId);
                if (trackId is not null && (index < 0 || index >= textTracks.Count))
                {
                    return;
                }

                for (var i = 0; i < textTracks.Count; i++)
                {
                    textTracks.SetPresentationMode(
                        (uint)i,
                        i == index
                            ? TimedMetadataTrackPresentationMode.PlatformPresented
                            : TimedMetadataTrackPresentationMode.Disabled);
                }

                if (index < 0)
                {
                    _selectedSubtitleTrackId = null;
                    OnPropertyChanged(nameof(SelectedSubtitleTrackId));
                    return;
                }

                _selectedSubtitleTrackId = trackId;
                OnPropertyChanged(nameof(SelectedSubtitleTrackId));
            }
            catch (Exception)
            {
                // See the type-level remarks: unverified against a live SDK.
            }
        }

        /// <summary>
        /// Pauses playback and fires one last progress report. Called from
        /// <c>PlayerPage.OnNavigatedFrom</c> -- the same "pause before
        /// navigating away" judgment call <c>App.xaml.cs</c>'s own remarks
        /// describe for Back handling in general.
        /// </summary>
        public void PauseForNavigatingAway()
        {
            try
            {
                Player.Pause();
            }
            catch (Exception)
            {
                // Best-effort -- there's nowhere left to surface this to once
                // the page is on its way out.
            }

            _ = ReportProgressAsync();
        }

        /// <summary>
        /// Pauses and saves the current position. Awaited by the suspend
        /// handler so the write completes inside the suspend deferral; also
        /// used when the window is hidden.
        /// </summary>
        public Task PauseAndFlushProgressAsync()
        {
            try
            {
                Player.Pause();
            }
            catch (Exception)
            {
                // Best-effort -- see PauseForNavigatingAway.
            }

            return ReportProgressAsync();
        }

        private async Task LoadAsync()
        {
            try
            {
                var model = XboxModelDetector.DetectModel();
                var profile = XboxPlaybackProfile.ForModel(model);

                // Resume from the server's saved point unless the caller passed one.
                if (_resumePositionMs is null)
                {
                    try
                    {
                        var saved = await _environment.ApiClient
                            .GetWatchProgressAsync(_mediaFileId)
                            .ConfigureAwait(false);
                        _resumePositionMs = PlaybackResume.FromProgress(saved);
                    }
                    catch (Exception)
                    {
                        // Resume is best-effort: playback starts from the top.
                    }
                }

                var info = await _environment.ApiClient
                    .GetPlaybackInfoAsync(_mediaFileId, profile)
                    .ConfigureAwait(false);

                PlaybackInfo = info;

                var source = info.Mode == PlaybackMode.Hls
                    ? await BuildHlsSourceAsync(info).ConfigureAwait(false)
                    : BuildDirectSource(info);

                if (source is null)
                {
                    LoadState = PlayerLoadState.Failed;
                    ErrorMessage = "Playarr couldn't build a playable source for this file.";
                    return;
                }

                _playbackItem = source;
                _selectedAudioTrackId = info.SelectedAudioTrackId;
                _selectedSubtitleTrackId = info.SelectedSubtitleTrackId;

                ApplyInitialTrackSelection(info);
                AttachResumeSeek(info);

                Player.Source = source;
                LoadState = PlayerLoadState.Ready;
                StartProgressTimer();
            }
            catch (ApiException apiError)
            {
                LoadState = PlayerLoadState.Failed;
                ErrorMessage = apiError.DisplayMessage;
            }
            catch (Exception error)
            {
                LoadState = PlayerLoadState.Failed;
                ErrorMessage = error.Message;
            }
        }

        /// <summary>
        /// Builds the source for <see cref="PlaybackMode.Direct"/>.
        /// </summary>
        /// <remarks>
        /// <strong>Open gap, not silently glossed over:</strong> this sends
        /// no <c>Authorization</c> header. <c>Windows.Media.Core.MediaSource.CreateFromUri</c>
        /// has no overload that accepts custom HTTP headers or a pre-configured
        /// HTTP client -- unlike <see cref="AdaptiveMediaSource.CreateFromUriAsync(Uri, HttpClient)"/>,
        /// which is exactly why the Hls path below can attach one and this
        /// one cannot, as written. If the server's direct-serve endpoint
        /// enforces the same bearer-token auth as every other endpoint (as
        /// opposed to, say, a short-lived signed URL specifically for this
        /// route), a direct-mode file will 401 here. This needs one of: (a)
        /// confirming the direct-serve route doesn't require the header at
        /// all, (b) a server-side signed/short-lived URL for this one route,
        /// or (c) a custom <c>MediaStreamSource</c> that pulls bytes through
        /// an authenticated <c>HttpClient</c> by hand -- none of which this
        /// environment (no Windows SDK, no running server) can resolve with
        /// confidence. Deliberately not smuggling the token into the URL as
        /// a query parameter either way -- see this task's own instructions
        /// on why that's a regression versus every other client in this repo.
        /// </remarks>
        private MediaPlaybackItem? BuildDirectSource(PlaybackInfoResponse info)
        {
            var uri = _environment.ApiClient.ResolveUrl(info.Url);
            if (uri is null)
            {
                return null;
            }

            var mediaSource = MediaSource.CreateFromUri(uri);
            return new MediaPlaybackItem(mediaSource);
        }

        /// <summary>
        /// Builds the source for <see cref="PlaybackMode.Hls"/>, attaching
        /// the bearer token as a real HTTP header on every manifest/segment
        /// request <see cref="AdaptiveMediaSource"/> makes.
        /// </summary>
        private async Task<MediaPlaybackItem?> BuildHlsSourceAsync(PlaybackInfoResponse info)
        {
            var uri = _environment.ApiClient.ResolveUrl(info.Url);
            if (uri is null)
            {
                return null;
            }

            var headers = await _environment.ApiClient
                .GetPlaybackRequestHeadersAsync()
                .ConfigureAwait(false);

            var httpClient = new HttpClient();
            foreach (var header in headers)
            {
                httpClient.DefaultRequestHeaders.TryAppendWithoutValidation(header.Key, header.Value);
            }

            var creation = await AdaptiveMediaSource.CreateFromUriAsync(uri, httpClient);
            if (creation.Status != AdaptiveMediaSourceCreationStatus.Success || creation.MediaSource is null)
            {
                return null;
            }

            var mediaSource = MediaSource.CreateFromAdaptiveMediaSource(creation.MediaSource);
            return new MediaPlaybackItem(mediaSource);
        }

        /// <summary>
        /// Applies the server's own track selection to the freshly-built
        /// <see cref="_playbackItem"/> before <see cref="Player"/> ever sees
        /// it, so what's audible/visible at first frame matches what the
        /// server already decided -- not just whatever the container's own
        /// default-track flags would otherwise pick.
        /// </summary>
        private void ApplyInitialTrackSelection(PlaybackInfoResponse info)
        {
            if (!string.IsNullOrEmpty(info.SelectedAudioTrackId))
            {
                SelectAudioTrack(info.SelectedAudioTrackId!);
            }

            SelectSubtitleTrack(info.SelectedSubtitleTrackId);
        }

        /// <summary>
        /// Seeks once <see cref="Player"/> reports the source opened, if a
        /// resume position was requested and it lands after the point the
        /// returned stream actually starts (see <c>PlaybackInfoResponse.SourceOffsetMs</c>'s
        /// own doc comment).
        /// </summary>
        private void AttachResumeSeek(PlaybackInfoResponse info)
        {
            var resumeFrom = PlaybackResume.Normalise(_resumePositionMs, info.DurationMs) ?? 0;
            if (resumeFrom <= info.SourceOffsetMs)
            {
                return;
            }

            var seekTarget = TimeSpan.FromMilliseconds(resumeFrom - info.SourceOffsetMs);

            void OnOpened(MediaPlayer sender, object args)
            {
                sender.MediaOpened -= OnOpened;
                try
                {
                    sender.PlaybackSession.Position = seekTarget;
                }
                catch (Exception)
                {
                    // Best-effort resume -- playback still starts (from the
                    // top) rather than failing outright.
                }
            }

            Player.MediaOpened += OnOpened;
        }

        private void StartProgressTimer()
        {
            _progressTimer?.Dispose();
            _progressTimer = new Timer(
                _ => { _ = ReportProgressAsync(); },
                null,
                ProgressReportInterval,
                ProgressReportInterval);
        }

        /// <summary>
        /// Reports watch progress. Adds <c>PlaybackInfo.SourceOffsetMs</c> to
        /// <see cref="Player"/>'s own reported position so a seek-ahead
        /// transcode (one that started mid-stream) is reported against a
        /// true source position rather than a position relative to wherever
        /// the returned stream happened to start -- see
        /// <c>PlaybackInfoResponse.SourceOffsetMs</c>'s doc comment. Duration
        /// is reported from <c>PlaybackInfo.DurationMs</c> (the full source
        /// duration the server already returned), not from
        /// <c>Player.PlaybackSession.NaturalDuration</c>, since the latter
        /// only reflects the length of whatever was actually returned -- which
        /// is shorter than the full source for exactly the same seek-ahead
        /// case.
        /// </summary>
        private async Task ReportProgressAsync()
        {
            var info = PlaybackInfo;
            if (info is null)
            {
                return;
            }

            TimeSpan position;
            try
            {
                position = Player.PlaybackSession.Position;
            }
            catch (Exception)
            {
                // No active playback session yet (or any more) -- nothing to report.
                return;
            }

            var positionMs = (long)position.TotalMilliseconds + info.SourceOffsetMs;
            if (!PlaybackResume.ShouldReport(_playbackStarted, positionMs))
            {
                return;
            }

            try
            {
                await _environment.ApiClient
                    .UpdateWatchProgressAsync(
                        _mediaFileId,
                        new UpdateWatchProgressRequest { PositionMs = positionMs, DurationMs = info.DurationMs })
                    .ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Best-effort -- a missed progress beat isn't worth surfacing
                // to the viewer; the next timer tick (or the final report on
                // navigating away) tries again.
            }
        }

        private static int IndexOf(IList<PlaybackTrackOption> tracks, string trackId)
        {
            for (var i = 0; i < tracks.Count; i++)
            {
                if (string.Equals(tracks[i].Id, trackId, StringComparison.Ordinal))
                {
                    return i;
                }
            }

            return -1;
        }

        /// <summary>
        /// Wires the Xbox Guide's now-playing card and hardware/media-remote
        /// transport buttons to <see cref="Player"/>. Setting
        /// <c>CommandManager.IsEnabled</c> is what makes UWP translate SMTC
        /// button presses directly onto <c>Player.PlaybackSession</c> without
        /// this app handling a single button-press event itself -- a real
        /// capability a packaged web app running in Xbox's browser shell does
        /// not get.
        /// </summary>
        /// <remarks>
        /// <c>PreviousBehavior</c> is disabled. <c>NextBehavior</c> routes to
        /// the end screen's Play now (see end-of-playback.md section 6); a
        /// press while the video is still playing does nothing.
        /// </remarks>
        private void ConfigureSystemMediaTransportControls()
        {
            Player.CommandManager.IsEnabled = true;
            // Next-track is only meaningful on the end screen, where it equals
            // "Play now" when a next item exists; otherwise it is swallowed.
            Player.CommandManager.NextBehavior.EnablingRule = MediaCommandEnablingRule.Always;
            Player.CommandManager.NextReceived += (sender, args) =>
            {
                args.Handled = true;
                if (EndOfPlayback.Phase != EndOfPlaybackPhase.Playing && EndOfPlayback.Next != null)
                {
                    PlayNextNow();
                }
            };
            Player.CommandManager.PreviousBehavior.EnablingRule = MediaCommandEnablingRule.Never;

            var updater = Player.SystemMediaTransportControls.DisplayUpdater;
            updater.Type = MediaPlaybackType.Video;
            updater.VideoProperties.Title = string.IsNullOrEmpty(Title) ? "Playarr" : Title;
            updater.Update();
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            StopCountdown();
            Player.MediaEnded -= Player_MediaEnded;
            try
            {
                Player.PlaybackSession.PlaybackStateChanged -= PlaybackSession_PlaybackStateChanged;
            }
            catch (Exception)
            {
            }

            _progressTimer?.Dispose();
            _progressTimer = null;

            try
            {
                Player.Dispose();
            }
            catch (Exception)
            {
                // Best-effort teardown -- nothing left to do with a failure here.
            }
        }
    }
}
