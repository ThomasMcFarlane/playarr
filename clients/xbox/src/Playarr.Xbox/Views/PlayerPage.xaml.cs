using System;
using System.Collections.Generic;
using System.ComponentModel;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.System.Display;
using Windows.UI.Xaml.Automation;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Core.Playback;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The playback screen -- the whole reason this client is a native UWP
    /// app rather than a packaged web app. See <c>PlayerViewModel</c>'s
    /// type-level remarks for the playback-negotiation and track-selection
    /// details; this file only follows the page/Render() shape every other
    /// screen in this app uses (see <c>Views/LoginPage.xaml.cs</c>'s own
    /// remarks for that pattern in full).
    /// </summary>
    /// <remarks>
    /// <strong>One necessary deviation from the documented pattern:</strong>
    /// every other page's constructor builds its ViewModel from
    /// <c>App.Environment</c> alone. This page's ViewModel additionally needs
    /// the media-file id (and optional resume position / title) carried on
    /// <c>Frame.Navigate</c>'s parameter, which UWP only exposes via
    /// <c>e.Parameter</c> inside <see cref="OnNavigatedTo"/> -- never in a
    /// page's constructor. So <see cref="_viewModel"/> is built in
    /// <see cref="OnNavigatedTo"/> instead, guarded against a missing/wrong-typed
    /// parameter (falls back to going back rather than crashing on a null
    /// media file id -- this should only ever happen from a caller bug once
    /// the Screens phase wires a real "Play" entry point, since nothing else
    /// navigates here today).
    /// </remarks>
    public sealed partial class PlayerPage : Page
    {
        private PlayerViewModel? _viewModel;
        private PlayerNavigationParameter? _parameter;
        private EndOfPlaybackPhase _lastEndPhase = EndOfPlaybackPhase.Playing;
        private IList<Work>? _renderedSuggestions;
        private DisplayRequest? _displayRequest;
        private DispatcherTimer? _idleTimer;

        public PlayerPage()
        {
            InitializeComponent();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            if (e.Parameter is not PlayerNavigationParameter parameter)
            {
                if (App.Navigation.CanGoBack)
                {
                    App.Navigation.GoBack();
                }

                return;
            }

            StartSession(parameter);
        }

        /// <summary>
        /// Builds a ViewModel for one queue item. Called for the initial item,
        /// for each up-next advance, and for a replay that needs a fresh
        /// negotiation; the page itself (and its back-stack entry) stays put.
        /// </summary>
        private void StartSession(PlayerNavigationParameter parameter)
        {
            TearDownSession();
            _parameter = parameter;
            _lastEndPhase = EndOfPlaybackPhase.Playing;
            _renderedSuggestions = null;

            _viewModel = new PlayerViewModel(
                App.Environment,
                parameter.MediaFileId,
                parameter.ResumePositionMs,
                parameter.Title,
                parameter.WorkId,
                parameter.UpNext.Count > 0 ? parameter.UpNext[0] : null);

            PlayerElement.SetMediaPlayer(_viewModel.Player);
            Window.Current.VisibilityChanged += Window_VisibilityChanged;
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            _viewModel.NextRequested += ViewModel_NextRequested;
            _viewModel.ExitRequested += ViewModel_ExitRequested;
            _viewModel.RestartRequested += ViewModel_RestartRequested;
            Render();
        }

        private void TearDownSession()
        {
            if (_viewModel is null)
            {
                return;
            }

            Window.Current.VisibilityChanged -= Window_VisibilityChanged;
            ReleaseKeepAwake();
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            _viewModel.NextRequested -= ViewModel_NextRequested;
            _viewModel.ExitRequested -= ViewModel_ExitRequested;
            _viewModel.RestartRequested -= ViewModel_RestartRequested;

            // Pause before tearing anything else down -- the same
            // "pause before navigating away" judgment call this task
            // asked for, mirroring App.xaml.cs's own remarks on Back
            // handling.
            _viewModel.PauseForNavigatingAway();

            PlayerElement.SetMediaPlayer(null);
            _viewModel.Dispose();
            _viewModel = null;
        }

        private void RunOnUi(Action action)
        {
            if (Dispatcher.HasThreadAccess)
            {
                action();
            }
            else
            {
                _ = Dispatcher.RunAsync(CoreDispatcherPriority.Normal, () => action());
            }
        }

        private void ViewModel_NextRequested(object sender, PlaybackQueueItem next) => RunOnUi(() =>
        {
            if (_parameter is null)
            {
                return;
            }

            var remaining = new List<PlaybackQueueItem>(_parameter.UpNext);
            if (remaining.Count > 0)
            {
                remaining.RemoveAt(0);
            }

            StartSession(new PlayerNavigationParameter(
                next.MediaFileId,
                title: next.Title,
                workId: next.WorkId ?? _parameter.WorkId,
                upNext: remaining));
        });

        private void ViewModel_ExitRequested(object sender, EventArgs e) => RunOnUi(() =>
        {
            if (App.Navigation.CanGoBack)
            {
                App.Navigation.GoBack();
            }
        });

        private void ViewModel_RestartRequested(object sender, EventArgs e) => RunOnUi(() =>
        {
            if (_parameter is { } current)
            {
                StartSession(new PlayerNavigationParameter(
                    current.MediaFileId, title: current.Title, workId: current.WorkId, upNext: current.UpNext));
            }
        });

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            TearDownSession();
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => RunOnUi(Render);

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. See <c>LoginPage.xaml.cs</c>'s type-level remarks for
        /// why this is one unconditional method rather than a per-property
        /// handler.
        /// </summary>
        private void Render()
        {
            if (_viewModel is null)
            {
                return;
            }

            var isLoading = _viewModel.LoadState == PlayerLoadState.Loading;
            var isFailed = _viewModel.LoadState == PlayerLoadState.Failed;

            LoadingPanel.Visibility = PlayerStagePolicy.SpinnerVisible(isLoading, isFailed) ? Visibility.Visible : Visibility.Collapsed;
            ErrorPanel.Visibility = isFailed ? Visibility.Visible : Visibility.Collapsed;
            PlayerElement.Visibility = PlayerStagePolicy.StageVisible(isFailed) ? Visibility.Visible : Visibility.Collapsed;
            TracksButton.Visibility = isLoading || isFailed ? Visibility.Collapsed : Visibility.Visible;

            ErrorText.Text = _viewModel.ErrorMessage ?? "Playback failed.";

            TitleText.Text = _viewModel.Title;
            TitleText.Visibility = string.IsNullOrEmpty(_viewModel.Title)
                ? Visibility.Collapsed
                : Visibility.Visible;

            RenderTrackLists();
            RenderEndPanel(isLoading || isFailed);
        }

        /// <summary>
        /// Shows the end-of-playback panel for the state machine's phase and
        /// moves gamepad focus onto its primary action when it first appears.
        /// </summary>
        private void RenderEndPanel(bool hidden)
        {
            var machine = _viewModel!.EndOfPlayback;
            var phase = hidden ? EndOfPlaybackPhase.Playing : machine.Phase;
            var showing = phase != EndOfPlaybackPhase.Playing;

            EndPanel.Visibility = showing ? Visibility.Visible : Visibility.Collapsed;
            UpdateKeepAwake(phase);
            TracksButton.Visibility = showing || hidden ? Visibility.Collapsed : Visibility.Visible;
            TracksPanel.Visibility = showing ? Visibility.Collapsed : TracksPanel.Visibility;
            if (!showing)
            {
                _lastEndPhase = phase;
                return;
            }

            var next = machine.Next;
            var upNext = phase == EndOfPlaybackPhase.UpNext;
            EndHeadingText.Text = upNext
                ? $"Up next in {machine.SecondsRemaining}"
                : (_viewModel.Title.Length > 0 ? $"Finished: {_viewModel.Title}" : "Finished");
            EndDetailText.Text = next?.Title ?? string.Empty;
            AutomationProperties.SetName(
                EndPanel,
                upNext ? $"Up next: {next?.Title}" : $"Finished playing {_viewModel.Title}");
            EndDetailText.Visibility = string.IsNullOrEmpty(next?.Title) ? Visibility.Collapsed : Visibility.Visible;

            PlayNextButton.Content = upNext ? "Play now" : "Play next";
            PlayNextButton.Visibility = next is null ? Visibility.Collapsed : Visibility.Visible;
            CancelCountdownButton.Visibility = upNext ? Visibility.Visible : Visibility.Collapsed;
            ReplayButton.Visibility = Visibility.Visible;

            RenderSuggestions();

            if (_lastEndPhase == EndOfPlaybackPhase.Playing)
            {
                (next is null ? ReplayButton : PlayNextButton).Focus(FocusState.Programmatic);
            }
            else if (_lastEndPhase == EndOfPlaybackPhase.UpNext && !upNext)
            {
                // Countdown cancelled: Cancel just disappeared, so keep focus on a live control.
                (next is null ? ReplayButton : PlayNextButton).Focus(FocusState.Programmatic);
            }

            _lastEndPhase = phase;
        }

        /// <summary>
        /// Keeps the screen awake while the end card or countdown shows, and
        /// lets it idle after 60 s on a plain ended card (spec section 10).
        /// </summary>
        private void UpdateKeepAwake(EndOfPlaybackPhase phase)
        {
            if (phase == EndOfPlaybackPhase.Playing)
            {
                ReleaseKeepAwake();
                return;
            }

            _displayRequest ??= new DisplayRequest();
            if (!_keepAwakeHeld)
            {
                _displayRequest.RequestActive();
                _keepAwakeHeld = true;
            }

            if (phase == EndOfPlaybackPhase.EndCard && _idleTimer is null)
            {
                _idleTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
                _idleTimer.Tick += (s, e) => ReleaseKeepAwake();
                _idleTimer.Start();
            }
        }

        private bool _keepAwakeHeld;

        private void ReleaseKeepAwake()
        {
            _idleTimer?.Stop();
            _idleTimer = null;
            if (_keepAwakeHeld)
            {
                _displayRequest?.RequestRelease();
                _keepAwakeHeld = false;
            }
        }

        private void Window_VisibilityChanged(object sender, VisibilityChangedEventArgs e) =>
            _viewModel?.SetCountdownPaused(!e.Visible);

        private void RenderSuggestions()
        {
            var suggestions = _viewModel!.Suggestions;
            if (ReferenceEquals(suggestions, _renderedSuggestions))
            {
                return;
            }

            _renderedSuggestions = suggestions;
            SuggestionsList.Items.Clear();
            foreach (var work in suggestions)
            {
                var posterUrl = work.Image(ImageKind.Poster)?.Url;
                var posterUri = string.IsNullOrEmpty(posterUrl)
                    ? null
                    : App.Environment.ApiClient.ResolveUrl(posterUrl!);
                SuggestionsList.Items.Add(CatalogTileFactory.CreateTile(work, posterUri));
            }

            var any = suggestions.Count > 0;
            SuggestionsHeading.Visibility = any ? Visibility.Visible : Visibility.Collapsed;
            SuggestionsList.Visibility = any ? Visibility.Visible : Visibility.Collapsed;
        }

        private void PlayNextButton_Click(object sender, RoutedEventArgs e) => _viewModel?.PlayNextNow();

        private void CancelCountdownButton_Click(object sender, RoutedEventArgs e) => _viewModel?.CancelCountdown();

        private void ReplayButton_Click(object sender, RoutedEventArgs e) => _viewModel?.Replay();

        private void ExitButton_Click(object sender, RoutedEventArgs e) => _viewModel?.Exit();

        private void SuggestionsList_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement { Tag: Guid workId })
            {
                App.Navigation.NavigateReplacingCurrent(typeof(WorkDetailPage), workId);
            }
        }

        /// <summary>
        /// Repopulates the audio/subtitle pickers from
        /// <c>PlayerViewModel.PlaybackInfo</c>. Runs on every Render() call
        /// (like the rest of this page) rather than only once, so a picker
        /// stays correct if playback info is ever reloaded (e.g. after
        /// <c>Retry()</c>).
        /// </summary>
        private void RenderTrackLists()
        {
            var info = _viewModel?.PlaybackInfo;

            AudioTrackList.Items.Clear();
            SubtitleTrackList.Items.Clear();

            if (info is null)
            {
                return;
            }

            foreach (var track in info.AudioTracks)
            {
                AudioTrackList.Items.Add(new ListBoxItem
                {
                    Content = track.Label ?? track.Language ?? track.Id,
                    Tag = track.Id,
                    IsSelected = track.Id == _viewModel!.SelectedAudioTrackId,
                });
            }

            SubtitleTrackList.Items.Add(new ListBoxItem
            {
                Content = "Off",
                Tag = null,
                IsSelected = _viewModel!.SelectedSubtitleTrackId is null,
            });

            foreach (var track in info.SubtitleTracks)
            {
                SubtitleTrackList.Items.Add(new ListBoxItem
                {
                    Content = track.Label ?? track.Language ?? track.Id,
                    Tag = track.Id,
                    IsSelected = track.Id == _viewModel.SelectedSubtitleTrackId,
                });
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel?.Retry();

        private void BackButton_Click(object sender, RoutedEventArgs e)
        {
            if (App.Navigation.CanGoBack)
            {
                App.Navigation.GoBack();
            }
        }

        private void TracksButton_Click(object sender, RoutedEventArgs e)
        {
            TracksPanel.Visibility = TracksPanel.Visibility == Visibility.Visible
                ? Visibility.Collapsed
                : Visibility.Visible;
        }

        /// <summary>
        /// BACK closes the open track panel first (focus returns to the
        /// button that opened it); returns false when nothing is open so the
        /// caller exits playback.
        /// </summary>
        public bool TryHandleBack()
        {
            var panelOpen = TracksPanel.Visibility == Visibility.Visible;
            if (PlayerStagePolicy.BackAction(panelOpen) != PlayerBackAction.ClosePanel)
            {
                return false;
            }

            TracksPanel.Visibility = Visibility.Collapsed;
            TracksButton.Focus(FocusState.Programmatic);
            return true;
        }

        private void AudioTrackList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (AudioTrackList.SelectedItem is ListBoxItem { Tag: string trackId })
            {
                _viewModel?.SelectAudioTrack(trackId);
            }
        }

        private void SubtitleTrackList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (SubtitleTrackList.SelectedItem is ListBoxItem item)
            {
                _viewModel?.SelectSubtitleTrack(item.Tag as string);
            }
        }
    }
}
