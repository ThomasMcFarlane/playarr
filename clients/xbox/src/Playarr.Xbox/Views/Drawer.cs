using System;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The one right-side panel for every page (owner rule: one shared Drawer and its close button): full height from
    /// the first frame, 360 px wide at 1920x1080, eyebrow, title, round Close, then the body. Focus moves into the
    /// drawer and returns to the control that opened it; BACK closes it (<see cref="TryCloseCurrent"/>).
    /// </summary>
    internal sealed class Drawer
    {
        private const double Width = 360;

        private readonly Panel _host;
        private readonly Grid _overlay;
        private readonly Control? _opener;

        private Drawer(Panel host, string eyebrow, string title, UIElement body)
        {
            _host = host;
            _opener = FocusManager.GetFocusedElement() as Control;

            var panel = new Grid
            {
                Width = Width,
                HorizontalAlignment = HorizontalAlignment.Right,
                Background = Ui.Res("PlayarrSurfaceStrong"),
                BorderBrush = Ui.Res("PlayarrLine"),
                BorderThickness = new Thickness(1, 0, 0, 0),
                Padding = new Thickness(46, 54, 46, 40),
                XYFocusKeyboardNavigation = XYFocusKeyboardNavigationMode.Enabled,
                TabFocusNavigation = KeyboardNavigationMode.Cycle,
            };
            var header = new StackPanel { Margin = new Thickness(0, 0, 56, 0) };
            var eyebrowText = Ui.Text(eyebrow.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft");
            eyebrowText.CharacterSpacing = 120;
            header.Children.Add(eyebrowText);
            var titleText = Ui.Text(title, 34, FontWeights.Normal, "PlayarrInk", new Thickness(0, 10, 0, 0));
            titleText.TextWrapping = TextWrapping.WrapWholeWords;
            titleText.LineHeight = 40;
            titleText.MaxLines = 3;
            header.Children.Add(titleText);
            panel.Children.Add(header);

            var close = Ui.RoundButton("", Close);
            close.Width = close.Height = 46;
            close.CornerRadius = new CornerRadius(23);
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.VerticalAlignment = VerticalAlignment.Top;
            close.Margin = new Thickness(0, -20, -22, 0);
            panel.Children.Add(close);

            var scroller = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
            var bodyHost = new Grid { Margin = new Thickness(0, 0, 0, 0) };
            bodyHost.Children.Add(scroller);
            header.SizeChanged += (s, e) => bodyHost.Margin = new Thickness(0, e.NewSize.Height + 40, 0, 0);
            panel.Children.Add(bodyHost);

            _overlay = new Grid();
            // A click outside the panel closes it, like the web scrim.
            var outside = new Grid { Background = new SolidColorBrush(Color.FromArgb(0x01, 0, 0, 0)) };
            outside.Tapped += (s, e) => Close();
            _overlay.Children.Add(outside);
            _overlay.Children.Add(panel);
            Grid.SetRowSpan(_overlay, 99);
            Grid.SetColumnSpan(_overlay, 99);
            host.Children.Add(_overlay);
            panel.Loaded += (s, e) =>
            {
                var first = FocusManager.FindFirstFocusableElement(scroller) as Control;
                (first ?? close).Focus(FocusState.Programmatic);
            };
        }

        public static Drawer? Current { get; private set; }

        public static Drawer Open(Panel host, string eyebrow, string title, UIElement body)
        {
            Current?.Close();
            Current = new Drawer(host, eyebrow, title, body);
            return Current;
        }

        /// <summary>BACK closes the open drawer first.</summary>
        public static bool TryCloseCurrent()
        {
            if (Current == null)
            {
                return false;
            }

            Current.Close();
            return true;
        }

        public void Close()
        {
            _host.Children.Remove(_overlay);
            if (Current == this)
            {
                Current = null;
            }

            _opener?.Focus(FocusState.Programmatic);
        }

        /// <summary>A labelled group ("SORT BY") with segmented options, the selected one filled like the web.</summary>
        public static StackPanel Segmented(string label, string[] options, int selected, Action<int> onSelect)
        {
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, 24) };
            var caption = Ui.Text(label.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft", new Thickness(0, 0, 0, 10));
            caption.CharacterSpacing = 120;
            group.Children.Add(caption);
            var row = new Grid { ColumnSpacing = 6 };
            for (var i = 0; i < options.Length; i++)
            {
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var index = i;
                var isSelected = i == selected;
                var button = new Button
                {
                    Height = 56,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    CornerRadius = new CornerRadius(6),
                    Background = isSelected ? Ui.Res("PlayarrInk") : new SolidColorBrush(Colors.Transparent),
                    BorderBrush = Ui.Res("PlayarrLineStrong"),
                    BorderThickness = new Thickness(1),
                    Content = new TextBlock
                    {
                        Text = options[i],
                        FontSize = 10.5,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = isSelected ? Ui.Res("PlayarrSurfaceStrong") : Ui.Res("PlayarrInkSoft"),
                    },
                    FocusVisualPrimaryBrush = new SolidColorBrush(Colors.White),
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                button.Click += (s, e) => onSelect(index);
                Grid.SetColumn(button, i);
                row.Children.Add(button);
            }

            group.Children.Add(row);
            return group;
        }

        /// <summary>An action row ("Play", "Mark as Watched"): icon in brand pink and label, as the web actions panel.</summary>
        public static Button Action(string glyph, string label, Action onClick)
        {
            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
            content.Children.Add(new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12, Foreground = Ui.Res("PlayarrBrand") });
            content.Children.Add(Ui.Text(label, 14, FontWeights.SemiBold, "PlayarrInk"));
            var button = new Button
            {
                Height = 46,
                Margin = new Thickness(0, 0, 0, 10),
                Padding = new Thickness(22, 0, 16, 0),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(6),
                Background = Ui.Res("PlayarrSurface"),
                BorderBrush = Ui.Res("PlayarrLine"),
                BorderThickness = new Thickness(1),
                Content = content,
                FocusVisualPrimaryBrush = new SolidColorBrush(Colors.White),
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
            return button;
        }
    }
}
