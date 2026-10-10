using System;
using System.Collections.Generic;
using Playarr.Core.Models;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web TV app shell drawn over the root frame: the left nav rail (logo, grouped pills, profile, version)
    /// and the clock. Geometry is measured from the web TV layout at 1920x1080 (effective pixels).
    /// Pages leave <see cref="ContentLeft"/> free on the left. Hidden on sign-in, profile picker and player.
    /// </summary>
    internal sealed class ShellChrome
    {
        /// <summary>Left edge of page content (the web page header starts here).</summary>
        public const double ContentLeft = 154;

        private const double RailLeft = 42;
        private const double RailWidth = 78;
        private const double ItemHeight = 72;

        private readonly Frame _frame;
        private readonly Grid _chrome = new Grid { IsHitTestVisible = true };
        private readonly List<(Button Button, Type Page, WorkKind? Kind)> _items = new List<(Button, Type, WorkKind?)>();
        private readonly TextBlock _time = new TextBlock { FontSize = 18, FontWeight = FontWeights.Bold };
        private readonly TextBlock _date = new TextBlock { FontSize = 12.5, FontWeight = FontWeights.SemiBold, CharacterSpacing = 60, VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _profileName = new TextBlock { FontSize = 10.5, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center };
        private readonly DispatcherTimer _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };

        public ShellChrome(Frame frame)
        {
            _frame = frame;
            Root = new Grid();
            Root.Children.Add(frame);
            Root.Children.Add(_chrome);
            Build();
            _frame.Navigated += (s, e) => Sync(e);
            _clockTimer.Tick += (s, e) => UpdateClock();
            _clockTimer.Start();
            UpdateClock();
        }

        public Grid Root { get; }

        /// <summary>Label under the profile avatar (the active profile's display name).</summary>
        public static string ProfileName { get; set; } = string.Empty;

        private void Build()
        {
            _chrome.Children.Add(new Image
            {
                Source = new BitmapImage(new Uri("ms-appx:///Assets/Square44x44Logo.png")),
                Width = 40,
                Height = 40,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(RailLeft + (RailWidth - 40) / 2, 60, 0, 0),
            });

            var groups = new StackPanel
            {
                Spacing = 16,
                Width = RailWidth,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(RailLeft, 118, 0, 0),
            };
            groups.Children.Add(Group(Item("", "Downloads", null, null), Item("", "Search", typeof(SearchPage), null)));
            groups.Children.Add(Group(
                Item("", "Home", typeof(HomePage), null),
                Item("", "Series", typeof(LibraryPage), WorkKind.Series),
                Item("", "Movies", typeof(LibraryPage), WorkKind.Movie),
                Item("", "Music", typeof(LibraryPage), WorkKind.Artist)));
            groups.Children.Add(Group(
                Item("", "Playlists", null, null),
                Item("", "Watchlist", null, null),
                Item("", "Requests", null, null),
                Item("", "Calendar", null, null)));
            _chrome.Children.Add(groups);

            var avatar = new Border
            {
                Width = 24,
                Height = 24,
                CornerRadius = new CornerRadius(12),
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            var profileContent = new StackPanel { Spacing = 6 };
            profileContent.Children.Add(avatar);
            profileContent.Children.Add(_profileName);
            var profile = RailButton(profileContent, typeof(SettingsPage), null);
            var profileGroup = Group(profile);
            profileGroup.VerticalAlignment = VerticalAlignment.Top;
            profileGroup.HorizontalAlignment = HorizontalAlignment.Left;
            profileGroup.Margin = new Thickness(RailLeft, 952, 0, 0);
            _chrome.Children.Add(profileGroup);

            _chrome.Children.Add(new TextBlock
            {
                Text = "v" + typeof(App).Assembly.GetName().Version.ToString(3),
                FontFamily = (FontFamily)Application.Current.Resources["PlayarrMonoFont"],
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"],
                Width = RailWidth,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(RailLeft, 1034, 0, 0),
            });

            var clock = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 11,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(478, 67, 0, 0),
                IsHitTestVisible = false,
            };
            clock.Children.Add(_time);
            clock.Children.Add(_date);
            _chrome.Children.Add(clock);
        }

        private static Border Group(params Button[] items)
        {
            var stack = new StackPanel();
            foreach (var item in items)
            {
                stack.Children.Add(item);
            }

            return new Border
            {
                Child = stack,
                Width = RailWidth,
                Padding = new Thickness(4),
                CornerRadius = new CornerRadius(24),
                Background = (Brush)Application.Current.Resources["PlayarrSurface"],
                BorderBrush = (Brush)Application.Current.Resources["PlayarrLine"],
                BorderThickness = new Thickness(1),
            };
        }

        private Button Item(string glyph, string label, Type? page, WorkKind? kind)
        {
            var content = new StackPanel { Spacing = 6 };
            content.Children.Add(new FontIcon { Glyph = glyph, FontSize = 18, FontFamily = new FontFamily("Segoe MDL2 Assets") });
            content.Children.Add(new TextBlock { Text = label, FontSize = 10.5, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center });
            return RailButton(content, page, kind);
        }

        private Button RailButton(UIElement content, Type? page, WorkKind? kind)
        {
            var button = new Button
            {
                Content = content,
                Width = RailWidth - 10,
                Height = ItemHeight - 4,
                Margin = new Thickness(0, 2, 0, 2),
                Padding = new Thickness(0),
                CornerRadius = new CornerRadius(18),
                HorizontalContentAlignment = HorizontalAlignment.Center,
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = new SolidColorBrush(Colors.Transparent),
                BorderThickness = new Thickness(0),
                Foreground = (Brush)Application.Current.Resources["PlayarrInk"],
                FocusVisualPrimaryBrush = new SolidColorBrush(Colors.White),
                FocusVisualPrimaryThickness = new Thickness(2),
                FocusVisualSecondaryThickness = new Thickness(0),
                // shortcut: pages without an Xbox screen yet (Downloads, Playlists, Watchlist, Requests,
                // Calendar) keep their place in the rail but do nothing; wire them as their screens land.
                IsTabStop = page != null,
            };
            if (page != null)
            {
                button.Click += (s, e) => _frame.Navigate(page, kind);
            }

            _items.Add((button, page ?? typeof(object), kind));
            return button;
        }

        private void Sync(NavigationEventArgs e)
        {
            var shell = e.SourcePageType != typeof(LoginPage)
                && e.SourcePageType != typeof(ProfilesPage)
                && e.SourcePageType != typeof(PlayerPage);
            _chrome.Visibility = shell ? Visibility.Visible : Visibility.Collapsed;
            _profileName.Text = string.IsNullOrEmpty(ProfileName) ? "Profile" : ProfileName;

            var kind = e.Parameter as WorkKind?;
            foreach (var (button, page, itemKind) in _items)
            {
                var current = page == e.SourcePageType && (page != typeof(LibraryPage) || itemKind == kind);
                button.Background = current
                    ? (Brush)Application.Current.Resources["PlayarrSurfaceSoft"]
                    : new SolidColorBrush(Colors.Transparent);
            }
        }

        private void UpdateClock()
        {
            var now = DateTime.Now;
            _time.Text = now.ToString("HH:mm");
            _date.Text = now.ToString("ddd d MMMM").ToUpperInvariant();
        }
    }
}
