using System;
using Windows.UI.Xaml.Controls;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// Thin typed wrapper around the app's one root <see cref="Frame"/>.
    /// Constructed once by <c>App.OnLaunched</c> and reached from any page
    /// via the static <c>App.Navigation</c> accessor.
    /// </summary>
    /// <remarks>
    /// No DI container, no navigation-parameter registry, no back-stack
    /// abstraction beyond what <see cref="Frame"/> already gives for free --
    /// this app is small enough that one shared <see cref="Frame"/>
    /// reference, wrapped just enough to keep <c>Windows.UI.Xaml.Controls</c>
    /// out of every page's public surface, is the whole "navigation
    /// service".
    /// </remarks>
    public sealed class NavigationService
    {
        private readonly Frame _frame;

        public NavigationService(Frame frame)
        {
            _frame = frame ?? throw new ArgumentNullException(nameof(frame));
        }

        public bool CanGoBack => _frame.CanGoBack;

        public bool Navigate(Type pageType) => _frame.Navigate(pageType);

        public bool Navigate(Type pageType, object parameter) => _frame.Navigate(pageType, parameter);

        public void GoBack()
        {
            if (_frame.CanGoBack)
            {
                _frame.GoBack();
            }
        }
    }
}
