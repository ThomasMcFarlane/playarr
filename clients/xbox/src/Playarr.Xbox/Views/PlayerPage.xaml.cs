using System.ComponentModel;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
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

            _viewModel = new PlayerViewModel(
                App.Environment,
                parameter.MediaFileId,
                parameter.ResumePositionMs,
                parameter.Title);

            PlayerElement.SetMediaPlayer(_viewModel.Player);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            if (_viewModel != null)
            {
                _viewModel.PropertyChanged -= ViewModel_PropertyChanged;

                // Pause before tearing anything else down -- the same
                // "pause before navigating away" judgment call this task
                // asked for, mirroring App.xaml.cs's own remarks on Back
                // handling.
                _viewModel.PauseForNavigatingAway();

                PlayerElement.SetMediaPlayer(null);
                _viewModel.Dispose();
                _viewModel = null;
            }

            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

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

            LoadingPanel.Visibility = isLoading ? Visibility.Visible : Visibility.Collapsed;
            ErrorPanel.Visibility = isFailed ? Visibility.Visible : Visibility.Collapsed;
            PlayerElement.Visibility = isLoading || isFailed ? Visibility.Collapsed : Visibility.Visible;
            TracksButton.Visibility = isLoading || isFailed ? Visibility.Collapsed : Visibility.Visible;

            ErrorText.Text = _viewModel.ErrorMessage ?? "Playback failed.";

            TitleText.Text = _viewModel.Title;
            TitleText.Visibility = string.IsNullOrEmpty(_viewModel.Title)
                ? Visibility.Collapsed
                : Visibility.Visible;

            RenderTrackLists();
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
