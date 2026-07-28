using System;
using System.ComponentModel;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The real home/catalog screen, replacing the Screens-phase placeholder
    /// the foundation agent left here. Reached from <see cref="ProfilesPage"/>'s
    /// tile click and from <see cref="LibraryPage"/>'s "Home" nav button.
    /// </summary>
    /// <remarks>
    /// Follows <c>Views/LoginPage.xaml.cs</c>'s six-point pattern. The one
    /// addition: <see cref="RecentWorksList_ItemClick"/> reads the
    /// <see cref="Guid"/> that <see cref="CatalogTileFactory"/> stashed on
    /// each tile's <c>Tag</c> and navigates to <see cref="WorkDetailPage"/>
    /// directly -- a synchronous, one-shot user action with no ViewModel
    /// state to relay through <c>Render()</c>, the same judgment call
    /// <see cref="ProfilesPage"/>'s tile click makes (see its own remarks).
    /// </remarks>
    public sealed partial class HomePage : Page
    {
        private readonly HomeViewModel _viewModel;

        public HomePage()
        {
            InitializeComponent();
            _viewModel = new HomeViewModel(App.Environment);
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
            LoadingRing.IsActive = _viewModel.IsLoading;
            LoadingRing.Visibility = _viewModel.IsLoading ? Visibility.Visible : Visibility.Collapsed;

            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            ErrorPanel.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;

            RecentWorksList.Visibility = _viewModel.IsLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            // No per-property diffing -- rebuilt on every notification, same
            // simplicity call as Views/LoginPage.xaml.cs's Render().
            RecentWorksList.Items.Clear();
            foreach (var work in _viewModel.RecentWorks)
            {
                var posterUrl = work.Image(ImageKind.Poster)?.Url;
                var posterUri = string.IsNullOrEmpty(posterUrl)
                    ? null
                    : App.Environment.ApiClient.ResolveUrl(posterUrl);
                RecentWorksList.Items.Add(CatalogTileFactory.CreateTile(work, posterUri));
            }
        }

        private void RecentWorksList_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();

        private void LibraryNavButton_Click(object sender, RoutedEventArgs e) =>
            App.Navigation.Navigate(typeof(LibraryPage));
    }
}
