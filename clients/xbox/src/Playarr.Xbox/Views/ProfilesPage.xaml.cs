using System.ComponentModel;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Profile picker shown right after a successful sign-in (see
    /// <c>Views/LoginPage.xaml.cs</c>, whose <c>SignedIn</c> case now
    /// navigates here instead of straight to <see cref="HomePage"/>) and
    /// reached from nowhere else today.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Structurally follows <c>Views/LoginPage.xaml.cs</c>'s six-point
    /// pattern with one deliberate simplification: picking a profile is a
    /// synchronous, one-shot user action, not an async state machine like
    /// pairing is, so there is no ViewModel state to watch for it and no
    /// one-shot "has navigated" guard field here -- <see cref="ProfileTile_Click"/>
    /// navigates to <see cref="HomePage"/> directly, exactly once per click,
    /// the same way <c>CancelPairingButton_Click</c> forwards straight into
    /// a ViewModel method with no <c>Render()</c> involvement. See
    /// <see cref="ProfilesViewModel"/>'s own remarks for the full reasoning.
    /// </para>
    /// <para>
    /// Profile tiles are plain <see cref="Button"/> controls built in
    /// <see cref="BuildProfileTile"/> from <see cref="ProfilesViewModel.Profiles"/>
    /// -- real focusable controls (not bare <see cref="Image"/>/<see cref="TextBlock"/>),
    /// so UWP's built-in XY gamepad focus navigation can reach each one
    /// directly (unlike <see cref="HomePage"/>/<see cref="LibraryPage"/>'s
    /// tiles, a handful of profiles fits comfortably as plain buttons in a
    /// <see cref="StackPanel"/> without needing a <see cref="GridView"/>/
    /// <see cref="ListView"/>'s virtualization).
    /// </para>
    /// </remarks>
    public sealed partial class ProfilesPage : Page
    {
        private readonly ProfilesViewModel _viewModel;

        public ProfilesPage()
        {
            InitializeComponent();
            _viewModel = new ProfilesViewModel(App.Environment);
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

            ProfilesScrollViewer.Visibility =
                _viewModel.IsLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            // No per-property diffing -- rebuilt on every notification, same
            // simplicity call as Views/LoginPage.xaml.cs's Render(). Profile
            // counts are small enough that this is cheap.
            ProfilesPanel.Children.Clear();
            foreach (var profile in _viewModel.Profiles)
            {
                ProfilesPanel.Children.Add(BuildProfileTile(profile));
            }
        }

        private Button BuildProfileTile(AvailableProfile profile)
        {
            var initial = string.IsNullOrEmpty(profile.DisplayName)
                ? "?"
                : profile.DisplayName.Substring(0, 1).ToUpperInvariant();

            var avatar = new Border
            {
                Width = 270,
                Height = 270,
                CornerRadius = new CornerRadius(135),
                Background = new LinearGradientBrush
                {
                    StartPoint = new Windows.Foundation.Point(0, 0),
                    EndPoint = new Windows.Foundation.Point(1, 1),
                    GradientStops =
                    {
                        new GradientStop { Color = Color.FromArgb(0xFF, 0x8A, 0x6F, 0xC4), Offset = 0 },
                        new GradientStop { Color = Color.FromArgb(0xFF, 0x4F, 0x4B, 0x8C), Offset = 1 },
                    },
                },
                Child = new TextBlock
                {
                    Text = initial,
                    FontSize = 96,
                    FontWeight = FontWeights.SemiBold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                },
            };

            var nameRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            nameRow.Children.Add(new TextBlock { Text = profile.DisplayName, FontSize = 18, FontWeight = FontWeights.SemiBold });

            if (profile.PinLocked)
            {
                // Segoe MDL2 Assets's lock glyph -- a small, built-in
                // PIN-lock indicator with no image asset needed.
                nameRow.Children.Add(new TextBlock
                {
                    Text = "\uE72E",
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    Opacity = 0.8,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }

            var content = new StackPanel { Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center };
            content.Children.Add(avatar);
            content.Children.Add(nameRow);
            if (profile.IsCurrent)
            {
                content.Children.Add(new TextBlock
                {
                    Text = "WATCHING NOW",
                    FontSize = 10,
                    FontWeight = FontWeights.SemiBold,
                    CharacterSpacing = 60,
                    Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"],
                    HorizontalAlignment = HorizontalAlignment.Center,
                });
            }

            var tile = new Button
            {
                Content = content,
                Tag = profile,
                Background = new SolidColorBrush(Colors.Transparent),
                BorderThickness = new Thickness(0),
                Padding = new Thickness(8),
                CornerRadius = new CornerRadius(143),
                VerticalAlignment = VerticalAlignment.Top,
                FocusVisualPrimaryBrush = (Brush)Application.Current.Resources["PlayarrBrandInk"],
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            tile.Click += ProfileTile_Click;

            return tile;
        }

        private void ProfileTile_Click(object sender, RoutedEventArgs e)
        {
            // Synchronous, one-shot: nothing to await, nothing to persist
            // server-side yet (see ProfilesViewModel's remarks) -- just move
            // on to HomePage.
            ShellChrome.ProfileName = ((AvailableProfile)((Button)sender).Tag).DisplayName;
            App.Navigation.Navigate(typeof(HomePage));
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();
    }
}
