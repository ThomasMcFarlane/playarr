using System;
using System.ComponentModel;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// A work's detail screen: title/overview/genres/backdrop, and for a
    /// <see cref="WorkKind.Series"/> a browsable season/episode list, with
    /// a "Play" affordance that navigates to <see cref="PlayerPage"/> once
    /// a playable media file id is resolvable.
    /// </summary>
    /// <remarks>
    /// Follows <see cref="LoginPage"/>'s established
    /// page/ViewModel/<c>Render()</c> pattern (see that type's own remarks
    /// for the full writeup), with one necessary deviation: this page takes
    /// a <see cref="Guid"/> work id as its navigation parameter, which
    /// <see cref="Frame.Navigate(Type, object)"/> only hands to
    /// <see cref="OnNavigatedTo"/> (via <c>NavigationEventArgs.Parameter</c>)
    /// -- a page's own constructor is parameterless and runs before that
    /// parameter exists. <see cref="WorkDetailViewModel"/> is therefore
    /// constructed in <see cref="OnNavigatedTo"/> rather than this page's
    /// constructor. This is safe without extra guarding because this
    /// project never sets <c>NavigationCacheMode</c>, so <see cref="Frame"/>
    /// creates a fresh page instance -- and therefore a fresh constructor
    /// call -- for every navigation to this page; <see cref="OnNavigatedTo"/>
    /// is never called twice against the same instance.
    /// </remarks>
    public sealed partial class WorkDetailPage : Page
    {
        private WorkDetailViewModel _viewModel = null!;

        public WorkDetailPage()
        {
            InitializeComponent();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            var workId = e.Parameter is Guid id ? id : Guid.Empty;
            _viewModel = new WorkDetailViewModel(App.Environment, workId);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            _viewModel.Load();
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. See <see cref="LoginPage"/>'s remarks for why this is
        /// one unconditional method rather than a per-property handler.
        /// </summary>
        private void Render()
        {
            LoadingRing.IsActive = _viewModel.IsLoading;

            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;
            ErrorText.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;

            var work = _viewModel.Work;
            TitleText.Text = _viewModel.Title;
            LibraryText.Text = work?.Kind switch
            {
                WorkKind.Movie => "Movies",
                WorkKind.Series => "Series",
                WorkKind.Artist => "Music",
                _ => string.Empty,
            };
            SubtitleText.Text = _viewModel.Title.ToUpperInvariant();
            EyebrowText.Text = work != null && work.Genres.Count > 0 ? work.Genres[0].ToUpperInvariant() : string.Empty;
            // Web meta row: kind, year, then genres, spaced (runtime and release date need fields this client lacks).
            var meta = new System.Collections.Generic.List<string>();
            if (work != null)
            {
                meta.Add(WorkLabels.KindLabel(work.Kind));
                if (WorkLabels.YearRange(work) is { } years)
                {
                    meta.Add(years);
                }

                meta.AddRange(work.Genres);
            }

            MetaText.Text = string.Join("      ", meta);
            OverviewText.Text = _viewModel.Overview;

            var backdropUrl = _viewModel.BackdropImageUrl;
            BackdropImage.Source = backdropUrl != null ? new BitmapImage(backdropUrl) : null;

            PlayButton.IsEnabled = _viewModel.CanPlay;

            SeriesPanel.Visibility = _viewModel.IsSeries ? Visibility.Visible : Visibility.Collapsed;
            if (_viewModel.IsSeries)
            {
                RenderSeasons();
                RenderEpisodes();
            }
        }

        private void RenderSeasons()
        {
            SeasonsPanel.Children.Clear();

            var seasons = _viewModel.Seasons;
            for (var i = 0; i < seasons.Count; i++)
            {
                var button = new Button
                {
                    Content = SeasonLabel(seasons[i]),
                    Tag = i,
                    FontWeight = i == _viewModel.SelectedSeasonIndex ? FontWeights.Bold : FontWeights.Normal,
                };

                button.Click += SeasonButton_Click;
                SeasonsPanel.Children.Add(button);
            }
        }

        private void RenderEpisodes()
        {
            EpisodesPanel.Children.Clear();

            foreach (var episodeDetail in _viewModel.Episodes)
            {
                var isSelected = ReferenceEquals(episodeDetail, _viewModel.SelectedEpisode);
                var isPlayable = episodeDetail.MediaFileId.HasValue;

                var button = new Button
                {
                    Content = EpisodeLabel(episodeDetail, isPlayable),
                    Tag = episodeDetail,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    Opacity = isPlayable ? 1.0 : 0.5,
                    FontWeight = isSelected ? FontWeights.Bold : FontWeights.Normal,
                };

                button.Click += EpisodeButton_Click;
                EpisodesPanel.Children.Add(button);
            }
        }

        private static string SeasonLabel(SeasonDetail season) =>
            string.IsNullOrEmpty(season.Season.Title)
                ? $"Season {season.Season.SeasonNumber}"
                : season.Season.Title!;

        private static string EpisodeLabel(EpisodeDetail episode, bool isPlayable)
        {
            var prefix = isPlayable ? "▶ " : string.Empty;
            var number = $"E{episode.Episode.EpisodeNumber}";
            var title = string.IsNullOrEmpty(episode.Episode.Title) ? number : $"{number} — {episode.Episode.Title}";
            return prefix + title;
        }

        private void SeasonButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button button && button.Tag is int index)
            {
                _viewModel.SelectSeason(index);
            }
        }

        private void EpisodeButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button button && button.Tag is EpisodeDetail episode)
            {
                _viewModel.SelectEpisode(episode);
            }
        }

        private void BackButton_Click(object sender, RoutedEventArgs e) => App.Navigation.GoBack();

        private void PlayButton_Click(object sender, RoutedEventArgs e)
        {
            var mediaFileId = _viewModel.PlayableMediaFileId;
            if (mediaFileId.HasValue)
            {
                // PlayerNavigationParameter (not a bare Guid) is the real
                // contract PlayerPage.xaml.cs already established -- see
                // that type's own remarks. ResumePositionMs is left null
                // (start from the beginning): this screen doesn't fetch
                // IPlayarrApiClient.ListWatchProgressAsync, which is out
                // of this screen's scope as requested.
                var parameter = new PlayerNavigationParameter(
                    mediaFileId.Value,
                    title: _viewModel.Title,
                    workId: _viewModel.WorkId,
                    upNext: _viewModel.UpNextQueue);
                App.Navigation.Navigate(typeof(PlayerPage), parameter);
            }
        }
    }
}
