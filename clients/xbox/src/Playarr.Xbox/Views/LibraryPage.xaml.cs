using System;
using System.ComponentModel;
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

        public LibraryPage()
        {
            InitializeComponent();
            _viewModel = new LibraryViewModel(App.Environment);
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
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

            RenderKindTabs();
            RenderSortButtons();

            WorksGridView.Items.Clear();
            foreach (var work in _viewModel.Works)
            {
                var posterUrl = work.Image(ImageKind.Poster)?.Url;
                var posterUri = string.IsNullOrEmpty(posterUrl)
                    ? null
                    : App.Environment.ApiClient.ResolveUrl(posterUrl);
                WorksGridView.Items.Add(CatalogTileFactory.CreateTile(work, posterUri));
            }
        }

        private void RenderKindTabs()
        {
            KindTabsPanel.Children.Clear();
            KindTabsPanel.Children.Add(BuildKindTab("All", null));

            foreach (var kind in _viewModel.Kinds)
            {
                if (kind == WorkKind.Unknown)
                {
                    continue;
                }

                KindTabsPanel.Children.Add(BuildKindTab(DisplayNameFor(kind), kind));
            }
        }

        private Button BuildKindTab(string label, WorkKind? kind)
        {
            var button = new Button
            {
                Content = label,
                Tag = kind,
                FontWeight = kind == _viewModel.SelectedKind ? FontWeights.Bold : FontWeights.Normal,
            };
            button.Click += KindTab_Click;
            return button;
        }

        private void KindTab_Click(object sender, RoutedEventArgs e)
        {
            var kind = (WorkKind?)((Button)sender).Tag;
            _viewModel.SelectKind(kind);
        }

        private void RenderSortButtons()
        {
            SortRecentButton.FontWeight =
                _viewModel.SelectedSort == LibraryViewModel.SortRecentlyAdded ? FontWeights.Bold : FontWeights.Normal;
            SortTitleButton.FontWeight = _viewModel.SelectedSort == null ? FontWeights.Bold : FontWeights.Normal;
        }

        private void SortRecentButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.SelectSort(LibraryViewModel.SortRecentlyAdded);

        private void SortTitleButton_Click(object sender, RoutedEventArgs e) => _viewModel.SelectSort(null);

        private void WorksGridView_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();

        private void HomeNavButton_Click(object sender, RoutedEventArgs e) =>
            App.Navigation.Navigate(typeof(HomePage));

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
