using System;
using Windows.UI;
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
