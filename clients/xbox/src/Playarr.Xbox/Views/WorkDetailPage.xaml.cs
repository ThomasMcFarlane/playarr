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
            EpisodeTitleText.Visibility = Visibility.Collapsed;
            if (_viewModel.IsSeries)
            {
                RenderSeasonRails();
                ShowEpisode(_viewModel.SelectedEpisode);
            }
        }

        /// <summary>Web series page: one rail per season of 268x151 episode thumbnails with the number overlaid.</summary>
        private void RenderSeasonRails()
        {
            SeriesPanel.Children.Clear();
            foreach (var season in _viewModel.Seasons)
            {
                var list = new ListView
                {
                    SelectionMode = ListViewSelectionMode.None,
                    IsItemClickEnabled = true,
                    Height = 210,
                    ItemContainerStyle = CatalogTileFactory.CardContainerStyle,
                };
                ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Hidden);
                ScrollViewer.SetHorizontalScrollMode(list, ScrollMode.Enabled);
                ScrollViewer.SetVerticalScrollMode(list, ScrollMode.Disabled);
                list.ItemsPanel = (ItemsPanelTemplate)Windows.UI.Xaml.Markup.XamlReader.Load(
                    "<ItemsPanelTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
                    "<ItemsStackPanel Orientation='Horizontal' /></ItemsPanelTemplate>");
                foreach (var episode in season.Episodes)
                {
                    list.Items.Add(EpisodeCard(season.Season.SeasonNumber, episode));
                }

                list.ItemClick += (s, e) =>
                {
                    if (e.ClickedItem is FrameworkElement { Tag: EpisodeDetail episode })
                    {
                        _viewModel.SelectEpisode(episode);
                        PlayButton_Click(this, new RoutedEventArgs());
                    }
                };
                list.GotFocus += (s, e) =>
                {
                    if (e.OriginalSource is ListViewItem { Content: FrameworkElement { Tag: EpisodeDetail episode } })
                    {
                        ShowEpisode(episode);
                    }
                };

                var section = new StackPanel();
                section.Children.Add(new TextBlock { Text = SeasonLabel(season), Style = (Style)Application.Current.Resources["PlayarrRailTitle"] });
                section.Children.Add(new TextBlock
                {
                    Text = $"{season.Episodes.Count} episodes",
                    FontSize = 10,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"],
                    Margin = new Thickness(0, 6, 0, 22),
                });
                section.Children.Add(list);
                SeriesPanel.Children.Add(section);
            }
        }

        private static FrameworkElement EpisodeCard(int seasonNumber, EpisodeDetail detail)
        {
            var episode = detail.Episode;
            var art = new Grid
            {
                Width = 268,
                Height = 151,
                CornerRadius = new CornerRadius(12),
                Background = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
            };
            var url = episode.Images.Count > 0 ? episode.Images[0].Url : null;
            var uri = string.IsNullOrEmpty(url) ? null : App.Environment.ApiClient.ResolveUrl(url!);
            if (uri != null)
            {
                art.Children.Add(new Image { Source = new BitmapImage(uri) { DecodePixelWidth = 268 }, Stretch = Windows.UI.Xaml.Media.Stretch.UniformToFill });
            }

            art.Children.Add(new TextBlock
            {
                Text = episode.EpisodeNumber.ToString("00", System.Globalization.CultureInfo.InvariantCulture),
                FontSize = 22,
                FontWeight = FontWeights.SemiBold,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 12, 8),
            });

            var caption = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(2, 10, 0, 0) };
            caption.Children.Add(new TextBlock { Text = EpisodeCode(seasonNumber, episode.EpisodeNumber), FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"], VerticalAlignment = VerticalAlignment.Center });
            caption.Children.Add(new TextBlock { Text = episode.Title ?? string.Empty, FontSize = 12, FontWeight = FontWeights.SemiBold, MaxWidth = 200, TextTrimming = TextTrimming.CharacterEllipsis });

            var root = new StackPanel { Width = 268, Tag = detail };
            root.Children.Add(art);
            root.Children.Add(caption);
            return root;
        }

        /// <summary>The web series header follows the focused (or next) episode: "S01 · E01" eyebrow, episode title, meta.</summary>
        private void ShowEpisode(EpisodeDetail? detail)
        {
            var work = _viewModel.Work;
            if (detail == null || work == null)
            {
                return;
            }

            var seasonNumber = 0;
            foreach (var season in _viewModel.Seasons)
            {
                if (season.Episodes.Contains(detail))
                {
                    seasonNumber = season.Season.SeasonNumber;
                }
            }

            var episode = detail.Episode;
            EyebrowText.Text = EpisodeCode(seasonNumber, episode.EpisodeNumber);
            EpisodeTitleText.Text = episode.Title ?? string.Empty;
            EpisodeTitleText.Visibility = string.IsNullOrEmpty(episode.Title) ? Visibility.Collapsed : Visibility.Visible;
            var meta = new System.Collections.Generic.List<string> { $"Season {seasonNumber}", EpisodeCode(seasonNumber, episode.EpisodeNumber) };
            if (episode.RuntimeMinutes is { } minutes)
            {
                meta.Add($"{minutes} min");
            }

            if (WorkLabels.YearRange(work) is { } years)
            {
                meta.Add(years);
            }

            if (DateTimeOffset.TryParse(episode.AirDate, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var aired))
            {
                meta.Add("Aired " + aired.ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB")));
            }

            meta.AddRange(work.Genres);
            MetaText.Text = string.Join("      ", meta);
            if (!string.IsNullOrEmpty(episode.Overview))
            {
                OverviewText.Text = episode.Overview;
            }
        }

        private static string EpisodeCode(int season, int episode) =>
            $"S{season.ToString("00", System.Globalization.CultureInfo.InvariantCulture)} \u00b7 E{episode.ToString("00", System.Globalization.CultureInfo.InvariantCulture)}";

        private static string SeasonLabel(SeasonDetail season) =>
            string.IsNullOrEmpty(season.Season.Title)
                ? $"Season {season.Season.SeasonNumber}"
                : season.Season.Title!;

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
