using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The catalog browse screen: server-defined kind tabs (plus an "All"
    /// tab this page adds itself) and a two-way sort choice, feeding a
    /// <see cref="GridView"/> of catalog tiles. Reached from
    /// <see cref="HomePage"/>'s "Library" nav button.
    /// </summary>
    /// <remarks>
    /// Follows <c>Views/LoginPage.xaml.cs</c>'s six-point pattern. Kind tabs
    /// and grid tiles are both rebuilt from scratch on every <c>Render()</c>
    /// call (no per-property diffing), the same simplicity call every other
    /// page in this project makes. <see cref="WorksGridView_ItemClick"/>
    /// mirrors <see cref="HomePage"/>'s own tile-click handling exactly --
    /// see that page's remarks and <see cref="CatalogTileFactory"/>'s.
    /// </remarks>
    public sealed partial class LibraryPage : Page
    {
        private readonly LibraryViewModel _viewModel;
        private readonly Dictionary<Guid, Work> _worksById = new Dictionary<Guid, Work>();

        public LibraryPage()
        {
            InitializeComponent();
            _viewModel = new LibraryViewModel(App.Environment);
            WorksGridView.ItemContainerStyle = CatalogTileFactory.GridCardContainerStyle;
            WorksGridView.GotFocus += WorksGridView_GotFocus;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (e.Parameter is WorkKind kind && kind != _viewModel.SelectedKind)
            {
                // Opened from the nav rail's Series, Movies or Music item.
                _viewModel.SelectKind(kind);
            }

            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
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
        /// elements. See <c>Views/LoginPage.xaml.cs</c>'s type-level remarks
        /// for why this is one unconditional method rather than a
        /// per-property handler.
        /// </summary>
        private void Render()
        {
            var isLoading = _viewModel.IsLoadingKinds || _viewModel.IsLoadingWorks;
            LoadingRing.IsActive = isLoading;
            LoadingRing.Visibility = isLoading ? Visibility.Visible : Visibility.Collapsed;

            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            ErrorPanel.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;

            WorksGridView.Visibility = isLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            var kind = _viewModel.SelectedKind;
            TitleText.Text = kind is { } k ? DisplayNameFor(k) : "Library";
            CountText.Text = _viewModel.Total is { } total
                ? $"{total.ToString("N0", CultureInfo.CurrentCulture)} TITLES"
                : string.Empty;

            WorksGridView.Items.Clear();
            _worksById.Clear();
            foreach (var work in _viewModel.Works)
            {
                _worksById[work.Id] = work;
                WorksGridView.Items.Add(CatalogTileFactory.CreateLandscapeCard(work, caption: false));
            }

            ShowFocused(_viewModel.Works.Count > 0 ? _viewModel.Works[0] : null);
        }

        private void WorksGridView_GotFocus(object sender, RoutedEventArgs e)
        {
            if (e.OriginalSource is GridViewItem { Content: FrameworkElement { Tag: Guid id } }
                && _worksById.TryGetValue(id, out var work))
            {
                ShowFocused(work);
            }
        }

        /// <summary>The web library's left column: genre eyebrow, title, year and genres, synopsis.</summary>
        private void ShowFocused(Work? work)
        {
            FocusPanel.Visibility = work == null ? Visibility.Collapsed : Visibility.Visible;
            if (work == null)
            {
                return;
            }

            FocusEyebrow.Text = work.Genres.Count > 0 ? work.Genres[0].ToUpperInvariant() : string.Empty;
            FocusTitle.Text = work.Title;
            var meta = new List<string>();
            if (WorkLabels.YearRange(work) is { } years)
            {
                meta.Add(years);
            }

            if (work.Genres.Count > 0)
            {
                meta.Add(string.Join(" \u00b7 ", work.Genres.Take(2)));
            }

            FocusMeta.Text = string.Join("   ", meta);
            FocusOverview.Text = work.Overview ?? string.Empty;
        }

        private void BackButton_Click(object sender, RoutedEventArgs e) => App.Navigation.GoBack();

        private void WorksGridView_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();

        private static string DisplayNameFor(WorkKind kind) => kind switch
        {
            WorkKind.Movie => "Movies",
            WorkKind.Series => "Series",
            WorkKind.Site => "Sites",
            WorkKind.Artist => "Music",
            WorkKind.Author => "Books",
            _ => kind.ToString(),
        };
    }
}
