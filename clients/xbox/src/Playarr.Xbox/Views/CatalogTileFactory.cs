using System;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Playarr.Core.Models;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Builds one catalog tile's visual tree for a <see cref="Work"/> --
    /// shared by <see cref="HomePage"/>'s recently-added row and
    /// <see cref="LibraryPage"/>'s browse grid so both screens render tiles
    /// identically instead of each re-deriving the same layout.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Returns a plain <see cref="FrameworkElement"/> (a <see cref="StackPanel"/>
    /// containing a poster <see cref="Image"/> and a title <see cref="TextBlock"/>)
    /// with <see cref="FrameworkElement.Tag"/> set to the work's
    /// <see cref="Work.Id"/>. Deliberately not itself a <see cref="Button"/>:
    /// both callers add these directly into a <see cref="ListView"/>/
    /// <see cref="GridView"/>'s <c>Items</c> collection (never
    /// <c>ItemsSource</c> plus a bound <c>ItemTemplate</c> -- this project
    /// uses neither <c>{x:Bind}</c> nor <c>{Binding}</c> anywhere, see
    /// <c>Views/LoginPage.xaml.cs</c>'s type-level remarks), and UWP
    /// automatically wraps every non-container item added that way in a real
    /// focusable, clickable item container (a <see cref="ListViewItem"/> or
    /// <see cref="GridViewItem"/>) that its own built-in gamepad XY focus
    /// navigation can already reach -- exactly the "must be a real focusable
    /// control, not a bare Image/TextBlock" requirement, satisfied by the
    /// generated container rather than by this method wrapping its own
    /// return value in a second, redundant focusable control.
    /// </para>
    /// <para>
    /// The caller wires one <c>ItemClick</c> handler for the whole list/grid
    /// (with <c>IsItemClickEnabled="True"</c> and <c>SelectionMode="None"</c>
    /// in XAML) and reads the clicked tile's <see cref="FrameworkElement.Tag"/>
    /// back out of <c>ItemClickEventArgs.ClickedItem</c> -- see
    /// <c>HomePage.xaml.cs</c>'s and <c>LibraryPage.xaml.cs</c>'s own
    /// <c>*_ItemClick</c> handlers.
    /// </para>
    /// </remarks>
    internal static class CatalogTileFactory
    {
        private const double TileWidth = 180;
        private const double TileHeight = 270;

        private const double CardWidth = 328;
        private const double CardHeight = 184;

        private static Style? _cardContainerStyle;

        /// <summary>
        /// Rail item container: no padding, the web's 25 px card gap, and a brand-pink focus ring in place of the
        /// stock focus rectangle (web card focus: lift, shadow and a pink glow ring).
        /// </summary>
        public static Style CardContainerStyle
        {
            get
            {
                if (_cardContainerStyle == null)
                {
                    var style = new Style(typeof(ListViewItem));
                    style.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(0)));
                    style.Setters.Add(new Setter(FrameworkElement.MarginProperty, new Thickness(0, 0, 25, 0)));
                    style.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, 0d));
                    style.Setters.Add(new Setter(FrameworkElement.MinHeightProperty, 0d));
                    style.Setters.Add(new Setter(Control.VerticalContentAlignmentProperty, VerticalAlignment.Top));
                    style.Setters.Add(new Setter(FrameworkElement.FocusVisualPrimaryBrushProperty, Application.Current.Resources["PlayarrBrand"]));
                    style.Setters.Add(new Setter(FrameworkElement.FocusVisualPrimaryThicknessProperty, new Thickness(2)));
                    style.Setters.Add(new Setter(FrameworkElement.FocusVisualSecondaryThicknessProperty, new Thickness(0)));
                    _cardContainerStyle = style;
                }

                return _cardContainerStyle;
            }
        }

        /// <summary>
        /// Web TV Home card: 328x184 landscape art (thumb, else backdrop; a titled placeholder without art),
        /// then the title and the "Kind · year" caption.
        /// </summary>
        public static FrameworkElement CreateLandscapeCard(Work work)
        {
            var art = new Grid
            {
                Width = CardWidth,
                Height = CardHeight,
                CornerRadius = new CornerRadius(12),
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
            };
            var url = (work.Image(ImageKind.Thumb) ?? work.Image(ImageKind.Backdrop))?.Url;
            var uri = string.IsNullOrEmpty(url) ? null : App.Environment.ApiClient.ResolveUrl(url!);
            if (uri == null)
            {
                art.Children.Add(new TextBlock
                {
                    Text = work.Title,
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.Resources["PlayarrInkMuted"],
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }
            else
            {
                art.Children.Add(new Image
                {
                    Source = new BitmapImage(uri) { DecodePixelWidth = (int)CardWidth },
                    Stretch = Stretch.UniformToFill,
                });
            }

            var root = new StackPanel { Width = CardWidth, Spacing = 0, Tag = work.Id };
            root.Children.Add(art);
            root.Children.Add(new TextBlock
            {
                Text = work.Title,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(2, 12, 0, 0),
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            root.Children.Add(new TextBlock
            {
                Text = WorkLabels.KindWithYear(work),
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"],
                Margin = new Thickness(2, 4, 0, 0),
            });
            return root;
        }

        public static FrameworkElement CreateTile(Work work, Uri? posterUri)
        {
            var posterHost = new Border
            {
                Width = TileWidth,
                Height = TileHeight,
                Background = new SolidColorBrush(Colors.DimGray),
                CornerRadius = new CornerRadius(4),
            };

            if (posterUri != null)
            {
                posterHost.Child = new Image
                {
                    Source = new BitmapImage(posterUri),
                    Stretch = Stretch.UniformToFill,
                };
            }

            var title = new TextBlock
            {
                Text = work.Title,
                Width = TileWidth,
                Margin = new Thickness(0, 8, 0, 0),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };

            var root = new StackPanel
            {
                Width = TileWidth,
                Margin = new Thickness(0, 0, 20, 20),
                Tag = work.Id,
            };
            root.Children.Add(posterHost);
            root.Children.Add(title);

            return root;
        }
    }
}
