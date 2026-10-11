using System;
using System.Linq;
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
    /// addition: <see cref="RailItem_Click"/> reads the
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

            RailsScroll.Visibility = _viewModel.IsLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            // Rebuilt on every notification, same simplicity call as Views/LoginPage.xaml.cs's Render().
            RailsPanel.Children.Clear();
            foreach (var rail in _viewModel.Rails)
            {
                RailsPanel.Children.Add(BuildRail(rail));
            }

            var first = _viewModel.Rails.Count > 0 && _viewModel.Rails[0].Items.Count > 0 ? _viewModel.Rails[0].Items[0] : null;
            HeroTitle.Text = first?.Title ?? string.Empty;
        }

        private UIElement BuildRail(HomeRail rail)
        {
            var list = new ListView
            {
                SelectionMode = ListViewSelectionMode.None,
                IsItemClickEnabled = true,
                Height = 262,
                Padding = new Thickness(0),
            };
            ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Hidden);
            ScrollViewer.SetHorizontalScrollMode(list, ScrollMode.Enabled);
            ScrollViewer.SetVerticalScrollMode(list, ScrollMode.Disabled);
            list.ItemsPanel = (ItemsPanelTemplate)Windows.UI.Xaml.Markup.XamlReader.Load(
                "<ItemsPanelTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
                "<ItemsStackPanel Orientation='Horizontal' /></ItemsPanelTemplate>");
            list.ItemContainerStyle = CatalogTileFactory.CardContainerStyle;
            list.ItemClick += RailItem_Click;
            CardFocus.Attach(list);
            CardActions.Attach(list, id => rail.Items.FirstOrDefault(w => w.Id == id));
            list.GotFocus += (s, e) =>
            {
                if (e.OriginalSource is ListViewItem { Content: FrameworkElement { Tag: Guid id } })
                {
                    foreach (var work in rail.Items)
                    {
                        if (work.Id == id)
                        {
                            HeroTitle.Text = work.Title;
                        }
                    }
                }
            };
            foreach (var work in rail.Items)
            {
                list.Items.Add(CatalogTileFactory.CreateLandscapeCard(work));
            }

            var section = new StackPanel { Spacing = 22 };
            section.Children.Add(new TextBlock { Text = rail.Title, Style = (Style)Application.Current.Resources["PlayarrRailTitle"] });
            section.Children.Add(list);
            return section;
        }

        private void RailItem_Click(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();
    }
}
