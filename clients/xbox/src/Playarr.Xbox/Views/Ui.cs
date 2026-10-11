using System;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>Small shared builders for code-built screens, in the web TV look (tokens from App.xaml).</summary>
    internal static class Ui
    {
        public static Brush Res(string key) => (Brush)Application.Current.Resources[key];

        public static TextBlock Text(string text, double size, FontWeight weight, string brushKey, Thickness margin = default) =>
            new TextBlock { Text = text, FontSize = size, FontWeight = weight, Foreground = Res(brushKey), Margin = margin };

        /// <summary>The page header's round Back button at the shell content edge.</summary>
        public static Button BackButton(Action onClick)
        {
            var button = RoundButton("", onClick);
            button.Margin = new Thickness(154, 56, 0, 0);
            button.HorizontalAlignment = HorizontalAlignment.Left;
            button.VerticalAlignment = VerticalAlignment.Top;
            return button;
        }

        public static Button RoundButton(string glyph, Action onClick)
        {
            var button = new Button
            {
                Width = 50,
                Height = 50,
                Padding = new Thickness(0),
                CornerRadius = new CornerRadius(25),
                Background = new SolidColorBrush(Colors.Transparent),
                BorderBrush = Res("PlayarrLineStrong"),
                BorderThickness = new Thickness(1),
                Content = new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 14 },
                FocusVisualPrimaryBrush = new SolidColorBrush(Colors.White),
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
            return button;
        }

        /// <summary>A pill action button (web header controls and action pills).</summary>
        public static Button Pill(string text, Action? onClick, double minWidth = 0)
        {
            var button = new Button
            {
                MinWidth = minWidth,
                Height = 50,
                Padding = new Thickness(20, 0, 20, 0),
                CornerRadius = new CornerRadius(25),
                Background = new SolidColorBrush(Colors.Transparent),
                BorderBrush = Res("PlayarrLineStrong"),
                BorderThickness = new Thickness(1),
                Content = Text(text, 12, FontWeights.SemiBold, "PlayarrInk"),
                FocusVisualPrimaryBrush = new SolidColorBrush(Colors.White),
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            if (onClick != null)
            {
                button.Click += (s, e) => onClick();
            }

            return button;
        }

        public static void SetPillText(Button pill, string text) => ((TextBlock)pill.Content).Text = text;

        /// <summary>A small outlined status pill ("Available", "Missing").</summary>
        public static Border StatusPill(string text, Color color) => new Border
        {
            Padding = new Thickness(7, 1, 7, 2),
            CornerRadius = new CornerRadius(9),
            BorderBrush = new SolidColorBrush(color),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = text, FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(color) },
        };
    }
}
