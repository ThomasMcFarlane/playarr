using System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Animation;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's media-card focus (docs/design/page-layout.md section 5, item 1a): the card lifts and its art gets the
    /// brand-pink glow ring that follows its corners; no fill. Cards are StackPanels whose first child is the art Grid
    /// (<see cref="CatalogTileFactory"/>, episode cards). One shared behaviour for every card list.
    /// </summary>
    internal static class CardFocus
    {
        private const double Lift = -7;
        private static readonly TimeSpan Duration = TimeSpan.FromMilliseconds(260);

        public static void Attach(ListViewBase list)
        {
            list.GotFocus += (s, e) => Apply(e.OriginalSource, true);
            list.LostFocus += (s, e) => Apply(e.OriginalSource, false);
        }

        private static void Apply(object source, bool focused)
        {
            if (!(source is SelectorItem { ContentTemplateRoot: Panel card }) || card.Children.Count == 0 || !(card.Children[0] is Grid art))
            {
                return;
            }

            // Dark theme --card-glow-color is --brand-ink; the ring is 3 px (WCAG 2.4.13).
            art.BorderThickness = new Thickness(focused ? 3 : 0);
            art.BorderBrush = focused ? (Brush)Application.Current.Resources["PlayarrBrandInk"] : null;

            if (!(card.RenderTransform is TranslateTransform move))
            {
                move = new TranslateTransform();
                card.RenderTransform = move;
            }

            // --card-lift-ease: cubic-bezier(0.2, 0.8, 0.2, 1) over --card-lift-duration.
            var animation = new DoubleAnimationUsingKeyFrames();
            animation.KeyFrames.Add(new SplineDoubleKeyFrame
            {
                Value = focused ? Lift : 0,
                KeyTime = KeyTime.FromTimeSpan(Duration),
                KeySpline = new KeySpline { ControlPoint1 = new Windows.Foundation.Point(0.2, 0.8), ControlPoint2 = new Windows.Foundation.Point(0.2, 1) },
            });
            Storyboard.SetTarget(animation, move);
            Storyboard.SetTargetProperty(animation, "Y");
            var story = new Storyboard();
            story.Children.Add(animation);
            story.Begin();
        }
    }
}
