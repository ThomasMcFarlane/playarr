using System;
using System.ComponentModel;
using Windows.System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Catalog search. Follows <see cref="LoginPage"/>'s established
    /// page/ViewModel/<c>Render()</c> pattern exactly (see that type's own
    /// remarks for the full six-point writeup). Result tiles are built via
    /// the shared <see cref="CatalogTileFactory"/> -- the same one
    /// <see cref="HomePage"/>'s recently-added row and
    /// <see cref="LibraryPage"/>'s browse grid already use -- rather than
    /// this page deriving its own tile layout, so a search result looks
    /// identical to the same work shown anywhere else in the app.
    /// </summary>
    public sealed partial class SearchPage : Page
    {
        private readonly SearchViewModel _viewModel;

        public SearchPage()
        {
            InitializeComponent();
            ResultsGrid.ItemContainerStyle = CatalogTileFactory.GridCardContainerStyle;
            CardFocus.Attach(ResultsGrid);
            _viewModel = new SearchViewModel(App.Environment);
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
        /// elements. See <see cref="LoginPage"/>'s remarks for why this is
        /// one unconditional method rather than a per-property handler.
        /// </summary>
        private void Render()
        {
            SearchingRing.IsActive = _viewModel.IsSearching;

            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;
            ErrorText.Visibility = string.IsNullOrEmpty(_viewModel.ErrorMessage)
                ? Visibility.Collapsed
                : Visibility.Visible;

            var results = _viewModel.Results;
            EmptyStatePanel.Visibility = results.Count == 0 && !_viewModel.IsSearching
                ? Visibility.Visible
                : Visibility.Collapsed;
            EmptyStateText.Text = string.IsNullOrWhiteSpace(QueryBox.Text) ? "Start typing to search." : "No results.";

            // No per-property diffing -- rebuilt on every notification, the
            // same simplicity call as Views/LoginPage.xaml.cs's Render().
            ResultsGrid.Items.Clear();
            foreach (var work in results)
            {
                ResultsGrid.Items.Add(CatalogTileFactory.CreateLandscapeCard(work, caption: false));
            }
        }

        private void ResultsGrid_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement element && element.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void BackButton_Click(object sender, RoutedEventArgs e) => App.Navigation.GoBack();

        // Web searches as you type.
        private void QueryBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _viewModel.Query = QueryBox.Text;
            _viewModel.Search();
        }

        private void QueryBox_KeyUp(object sender, KeyRoutedEventArgs e)
        {
            if (e.Key == VirtualKey.Enter)
            {
                _viewModel.Query = QueryBox.Text;
                _viewModel.Search();
            }
        }
    }
}
