using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Threading.Tasks;
using Windows.Storage.Streams;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Native catalogue and path-safe Folders views for Movies, Series,
    /// Sites, and Music. UWP controls provide real scrolling and gamepad
    /// focus; playable entries navigate to the existing Media Foundation
    /// player rather than a browser surface.
    /// </summary>
    public sealed partial class LibraryPage : Page
    {
        private const int ThumbnailCacheLimit = 240;

        private static LibraryFolderNavigationState? _pendingFolderRestoreState;

        private readonly LibraryViewModel _viewModel;
        private readonly Dictionary<string, Task<BitmapImage?>> _thumbnailTasks =
            new Dictionary<string, Task<BitmapImage?>>(StringComparer.Ordinal);

        public LibraryPage()
        {
            InitializeComponent();
            var restoredFolderState = _pendingFolderRestoreState;
            _pendingFolderRestoreState = null;
            _viewModel = new LibraryViewModel(App.Environment, restoredFolderState);
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (e.NavigationMode == NavigationMode.Back)
            {
                // The normal player round-trip reuses this page and retains
                // its exact list/focus/scroll state. The one-shot snapshot
                // covers an unexpected page reconstruction; either way,
                // stop caching before any later, unrelated navigation.
                _pendingFolderRestoreState = null;
                NavigationCacheMode = NavigationCacheMode.Disabled;
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

        private void Render()
        {
            var showingFolders = _viewModel.ViewMode == LibraryViewMode.Folders;
            var isLoading = _viewModel.IsLoadingKinds ||
                (showingFolders
                    ? _viewModel.IsLoadingFolderRoots || _viewModel.IsLoadingFolderDirectory
                    : _viewModel.IsLoadingWorks);
            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);

            LoadingRing.IsActive = isLoading;
            LoadingRing.Visibility = isLoading ? Visibility.Visible : Visibility.Collapsed;
            ErrorPanel.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;

            CatalogPanel.Visibility =
                !showingFolders && !hasError ? Visibility.Visible : Visibility.Collapsed;
            FolderPanel.Visibility =
                showingFolders && !hasError ? Visibility.Visible : Visibility.Collapsed;

            RenderKindTabs();
            RenderViewButtons();

            if (showingFolders)
            {
                RenderFolderRoots();
                RenderFolderWarnings();
                RenderFolderBreadcrumbs();
                RenderFolderEntries();
            }
            else
            {
                RenderSortButtons();
                RenderWorks();
            }
        }

        private void RenderKindTabs()
        {
            KindTabsPanel.Children.Clear();
            KindTabsPanel.Children.Add(BuildKindTab("All", null));

            foreach (var kind in _viewModel.Kinds)
            {
                if (kind != WorkKind.Unknown)
                {
                    KindTabsPanel.Children.Add(BuildKindTab(DisplayNameFor(kind), kind));
                }
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

        private void RenderViewButtons()
        {
            CatalogViewButton.FontWeight =
                _viewModel.ViewMode == LibraryViewMode.Catalog ? FontWeights.Bold : FontWeights.Normal;
            FoldersViewButton.FontWeight =
                _viewModel.ViewMode == LibraryViewMode.Folders ? FontWeights.Bold : FontWeights.Normal;
            FoldersViewButton.IsEnabled = _viewModel.SupportsFolders;
            SortPanel.Visibility =
                _viewModel.ViewMode == LibraryViewMode.Catalog ? Visibility.Visible : Visibility.Collapsed;
        }

        private void RenderSortButtons()
        {
            SortRecentButton.FontWeight =
                _viewModel.SelectedSort == LibraryViewModel.SortRecentlyAdded
                    ? FontWeights.Bold
                    : FontWeights.Normal;
            SortTitleButton.FontWeight =
                _viewModel.SelectedSort == null ? FontWeights.Bold : FontWeights.Normal;
        }

        private void RenderWorks()
        {
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

        private void RenderFolderRoots()
        {
            FolderRootsPanel.Children.Clear();

            foreach (var root in _viewModel.FolderRoots)
            {
                var button = new Button
                {
                    Content = FolderRootLabel(root),
                    Tag = root,
                    IsEnabled = root.Available,
                    Opacity = root.Available ? 1.0 : 0.55,
                    FontWeight = root.Id == _viewModel.SelectedFolderRoot?.Id
                        ? FontWeights.Bold
                        : FontWeights.Normal,
                };
                button.Click += FolderRootButton_Click;
                FolderRootsPanel.Children.Add(button);
            }
        }

        private void RenderFolderWarnings()
        {
            var warnings = new List<string>();
            foreach (var root in _viewModel.FolderRoots)
            {
                if (!root.Available && !string.IsNullOrWhiteSpace(root.UnavailableReason))
                {
                    warnings.Add($"{FolderRootLabel(root)}: {root.UnavailableReason}");
                }
            }

            foreach (var error in _viewModel.FolderRootErrors)
            {
                warnings.Add($"{error.SourceName}: {error.Message}");
            }

            FolderWarningsText.Text = string.Join(Environment.NewLine, warnings);
            FolderWarningsText.Visibility =
                warnings.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        private void RenderFolderBreadcrumbs()
        {
            FolderBreadcrumbsPanel.Children.Clear();
            var directory = _viewModel.FolderDirectory;
            if (directory == null)
            {
                return;
            }

            for (var index = 0; index < directory.Breadcrumbs.Count; index++)
            {
                if (index > 0)
                {
                    FolderBreadcrumbsPanel.Children.Add(new TextBlock
                    {
                        Text = "›",
                        VerticalAlignment = VerticalAlignment.Center,
                        Foreground = new SolidColorBrush(Colors.Gray),
                    });
                }

                var breadcrumb = directory.Breadcrumbs[index];
                var button = new Button
                {
                    Content = breadcrumb.Name,
                    Tag = breadcrumb,
                    FontWeight = breadcrumb.Path == directory.Path
                        ? FontWeights.Bold
                        : FontWeights.Normal,
                };
                button.Click += FolderBreadcrumbButton_Click;
                FolderBreadcrumbsPanel.Children.Add(button);
            }
        }

        private void RenderFolderEntries()
        {
            FolderEntriesListView.Items.Clear();
            foreach (var entry in _viewModel.FolderEntries)
            {
                FolderEntriesListView.Items.Add(CreateFolderEntryRow(entry));
            }

            var status = FolderStatus();
            FolderStatusText.Text = status ?? string.Empty;
            FolderStatusText.Visibility =
                status == null ? Visibility.Collapsed : Visibility.Visible;
            FolderEntriesListView.Visibility =
                _viewModel.FolderEntries.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            LoadMoreFoldersButton.Visibility =
                _viewModel.HasMoreFolderEntries ? Visibility.Visible : Visibility.Collapsed;
            LoadMoreFoldersButton.IsEnabled = !_viewModel.IsLoadingMoreFolders;
            LoadMoreFoldersButton.Content =
                _viewModel.IsLoadingMoreFolders ? "Loading…" : "Load more";
        }

        private FrameworkElement CreateFolderEntryRow(FolderEntry entry)
        {
            var preview = new Border
            {
                Width = 160,
                Height = 90,
                Margin = new Thickness(0, 0, 18, 0),
                Background = new SolidColorBrush(
                    entry.EntryType == FolderEntryType.Directory ? Colors.DarkSlateBlue : Colors.DimGray),
                CornerRadius = new CornerRadius(4),
            };

            if (entry.EntryType == FolderEntryType.Directory)
            {
                preview.Child = new TextBlock
                {
                    Text = "FOLDER",
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    FontWeight = FontWeights.SemiBold,
                };
            }
            else if (!string.IsNullOrWhiteSpace(entry.ThumbnailUrl))
            {
                var image = new Image
                {
                    Stretch = Stretch.UniformToFill,
                    Tag = entry.ThumbnailUrl,
                };
                preview.Child = image;
                _ = SetThumbnailWhenReadyAsync(image, entry.ThumbnailUrl!);
            }
            else
            {
                preview.Child = new TextBlock
                {
                    Text = entry.MediaKind == WorkKind.Artist ? "AUDIO" : "MEDIA",
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    FontWeight = FontWeights.SemiBold,
                };
            }

            var text = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center,
                Spacing = 5,
            };
            text.Children.Add(new TextBlock
            {
                Text = entry.EntryType == FolderEntryType.Directory ? entry.Name : entry.DisplayTitle,
                Style = (Style)Application.Current.Resources["SubtitleTextBlockStyle"],
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });

            var byline = FileByline(entry);
            if (!string.IsNullOrEmpty(byline))
            {
                text.Children.Add(new TextBlock
                {
                    Text = byline,
                    Foreground = new SolidColorBrush(Colors.LightGray),
                    TextWrapping = TextWrapping.NoWrap,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
            }

            if (entry.EntryType == FolderEntryType.Media)
            {
                text.Children.Add(new TextBlock
                {
                    Text = FileMetadata(entry),
                    Foreground = new SolidColorBrush(Colors.Gray),
                    TextWrapping = TextWrapping.NoWrap,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
            }

            var row = new Grid
            {
                Tag = entry,
                MinHeight = 104,
                Padding = new Thickness(8, 7, 12, 7),
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.Children.Add(preview);
            Grid.SetColumn(text, 1);
            row.Children.Add(text);
            return row;
        }

        private async Task SetThumbnailWhenReadyAsync(Image image, string thumbnailUrl)
        {
            if (!_thumbnailTasks.TryGetValue(thumbnailUrl, out var task))
            {
                if (_thumbnailTasks.Count >= ThumbnailCacheLimit)
                {
                    _thumbnailTasks.Clear();
                }

                task = LoadAuthenticatedThumbnailAsync(thumbnailUrl);
                _thumbnailTasks[thumbnailUrl] = task;
            }

            var thumbnail = await task;
            if (thumbnail != null && string.Equals(image.Tag as string, thumbnailUrl, StringComparison.Ordinal))
            {
                image.Source = thumbnail;
            }
        }

        /// <summary>
        /// Folder thumbnails are protected media endpoints. Fetch them with
        /// the same bearer-header provider as playback, then decode entirely
        /// in memory so no token enters a URL and no private image is cached
        /// as a loose file.
        /// </summary>
        private async Task<BitmapImage?> LoadAuthenticatedThumbnailAsync(string thumbnailUrl)
        {
            try
            {
                var uri = App.Environment.ApiClient.ResolveUrl(thumbnailUrl);
                if (uri == null || !SameOrigin(uri, App.Environment.ApiClient.BaseUrl))
                {
                    return null;
                }

                var headers = await App.Environment.ApiClient.GetPlaybackRequestHeadersAsync();
                using (var client = new Windows.Web.Http.HttpClient())
                {
                    foreach (var header in headers)
                    {
                        client.DefaultRequestHeaders.TryAppendWithoutValidation(header.Key, header.Value);
                    }

                    using (var response = await client.GetAsync(uri))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            return null;
                        }

                        var buffer = await response.Content.ReadAsBufferAsync();
                        using (var stream = new InMemoryRandomAccessStream())
                        {
                            await stream.WriteAsync(buffer);
                            stream.Seek(0);

                            var image = new BitmapImage();
                            await image.SetSourceAsync(stream);
                            return image;
                        }
                    }
                }
            }
            catch
            {
                // A missing thumbnail never makes its playable media entry
                // disappear. The neutral media placeholder remains visible.
                return null;
            }
        }

        private string? FolderStatus()
        {
            if (_viewModel.IsLoadingFolderRoots)
            {
                return "Loading root folders…";
            }

            if (_viewModel.FolderRoots.Count == 0)
            {
                return "No root folders are configured for this library.";
            }

            if (_viewModel.SelectedFolderRoot == null)
            {
                return "No root folder is currently available on this server.";
            }

            if (_viewModel.IsLoadingFolderDirectory)
            {
                return "Loading folder…";
            }

            if (_viewModel.FolderDirectory != null && _viewModel.FolderEntries.Count == 0)
            {
                return "This folder contains no supported media.";
            }

            return null;
        }

        private void KindTab_Click(object sender, RoutedEventArgs e)
        {
            var kind = (WorkKind?)((Button)sender).Tag;
            _viewModel.SelectKind(kind);
        }

        private void CatalogViewButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.SelectViewMode(LibraryViewMode.Catalog);

        private void FoldersViewButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.SelectViewMode(LibraryViewMode.Folders);

        private void SortRecentButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.SelectSort(LibraryViewModel.SortRecentlyAdded);

        private void SortTitleButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.SelectSort(null);

        private void WorksGridView_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void FolderRootButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button button && button.Tag is FolderRoot root)
            {
                _viewModel.SelectFolderRoot(root);
            }
        }

        private void FolderBreadcrumbButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button button && button.Tag is FolderBreadcrumb breadcrumb)
            {
                _viewModel.BrowseFolder(breadcrumb.Path);
            }
        }

        private void FolderEntriesListView_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is not FrameworkElement row || row.Tag is not FolderEntry entry)
            {
                return;
            }

            if (entry.EntryType == FolderEntryType.Directory)
            {
                _viewModel.BrowseFolder(entry.Path);
            }
            else if (entry.MediaFileId is { } mediaFileId)
            {
                _pendingFolderRestoreState = _viewModel.CaptureFolderNavigationState();
                NavigationCacheMode = NavigationCacheMode.Required;
                var navigated = App.Navigation.Navigate(
                    typeof(PlayerPage),
                    new PlayerNavigationParameter(mediaFileId, title: entry.DisplayTitle));
                if (!navigated)
                {
                    _pendingFolderRestoreState = null;
                    NavigationCacheMode = NavigationCacheMode.Disabled;
                }
            }
        }

        private void LoadMoreFoldersButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.LoadMoreFolderEntries();

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();

        private void HomeNavButton_Click(object sender, RoutedEventArgs e) =>
            App.Navigation.Navigate(typeof(HomePage));

        private static string FolderRootLabel(FolderRoot root) =>
            string.Equals(root.SourceName, root.Name, StringComparison.Ordinal)
                ? root.Name
                : $"{root.SourceName} — {root.Name}";

        private static bool SameOrigin(Uri candidate, Uri server) =>
            string.Equals(candidate.Scheme, server.Scheme, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(candidate.Host, server.Host, StringComparison.OrdinalIgnoreCase) &&
            candidate.Port == server.Port;

        private static string FileByline(FolderEntry entry)
        {
            if (!string.IsNullOrWhiteSpace(entry.Artist) && !string.IsNullOrWhiteSpace(entry.Album))
            {
                return $"{entry.Artist} — {entry.Album}";
            }

            return entry.Artist ?? entry.Album ?? string.Empty;
        }

        private static string FileMetadata(FolderEntry entry)
        {
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(entry.Container))
            {
                parts.Add(entry.Container!.ToUpperInvariant());
            }

            if (entry.Width is { } width && entry.Height is { } height)
            {
                parts.Add($"{width}×{height}");
            }

            if (entry.DurationMs is { } durationMs)
            {
                var duration = TimeSpan.FromMilliseconds(durationMs);
                parts.Add(duration.TotalHours >= 1
                    ? duration.ToString(@"h\:mm\:ss", CultureInfo.InvariantCulture)
                    : duration.ToString(@"m\:ss", CultureInfo.InvariantCulture));
            }

            if (!string.IsNullOrWhiteSpace(entry.VideoCodec))
            {
                parts.Add(entry.VideoCodec!.ToUpperInvariant());
            }
            else if (!string.IsNullOrWhiteSpace(entry.AudioCodec))
            {
                parts.Add(entry.AudioCodec!.ToUpperInvariant());
            }

            if (entry.SizeBytes is { } sizeBytes)
            {
                parts.Add(FormatBytes(sizeBytes));
            }

            return parts.Count == 0 ? entry.Name : string.Join(" · ", parts);
        }

        private static string FormatBytes(long bytes)
        {
            const double kibibyte = 1024;
            const double mebibyte = kibibyte * 1024;
            const double gibibyte = mebibyte * 1024;

            if (bytes >= gibibyte)
            {
                return $"{bytes / gibibyte:0.0} GiB";
            }

            if (bytes >= mebibyte)
            {
                return $"{bytes / mebibyte:0.0} MiB";
            }

            if (bytes >= kibibyte)
            {
                return $"{bytes / kibibyte:0.0} KiB";
            }

            return $"{bytes} B";
        }

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
