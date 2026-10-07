using System;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Xbox.Services;
using Playarr.Xbox.Views;

namespace Playarr.Xbox
{
    /// <summary>
    /// App entry point. Owns the one root <see cref="Frame"/>, the one
    /// <see cref="XboxAppEnvironment"/>, and the one <see cref="NavigationService"/>
    /// for the whole application -- reached by every page via the static
    /// <see cref="Environment"/> / <see cref="Navigation"/> accessors rather
    /// than a DI container or a service locator library, matching this
    /// app's small scope (see <see cref="NavigationService"/>'s own
    /// remarks).
    /// </summary>
    public sealed partial class App : Application
    {
        /// <summary>
        /// The one <see cref="XboxAppEnvironment"/> for this process.
        /// Constructed here (not per-page) so every screen shares the same
        /// <c>ApiClient</c>, <c>PairingState</c>, and persisted
        /// server/session state. Every page reaches it as
        /// <c>App.Environment</c>.
        /// </summary>
        public static XboxAppEnvironment Environment { get; private set; } = null!;

        /// <summary>
        /// Wraps the root <see cref="Frame"/> created in <see cref="OnLaunched"/>.
        /// Every page navigates through this (<c>App.Navigation.Navigate(...)</c>)
        /// rather than holding or creating its own <see cref="Frame"/>
        /// reference.
        /// </summary>
        public static NavigationService Navigation { get; private set; } = null!;

        public App()
        {
            InitializeComponent();
            Suspending += OnSuspending;

            // Constructed here rather than lazily: XboxAppEnvironment's own
            // constructor only touches ApplicationData.LocalSettings (cheap,
            // synchronous, always available once the app object exists), so
            // there's no reason to defer it, and every page from the very
            // first OnLaunched onward can rely on App.Environment already
            // being non-null.
            Environment = new XboxAppEnvironment();
        }

        protected override async void OnLaunched(LaunchActivatedEventArgs e)
        {
            var rootFrame = Window.Current.Content as Frame;

            if (rootFrame is null)
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += OnNavigationFailed;
                Navigation = new NavigationService(rootFrame);
                Window.Current.Content = rootFrame;

                SystemNavigationManager.GetForCurrentView().BackRequested += OnBackRequested;
            }

            if (!e.PrelaunchActivated)
            {
                if (rootFrame.Content is null)
                {
                    // A session persisted from a previous launch skips
                    // straight to ProfilesPage -- there is no "remember the
                    // last profile" persistence yet (see ProfilesViewModel's
                    // remarks), so every launch with a live session still
                    // asks "who's watching?" before HomePage. Anything else
                    // (never paired, or the session was cleared by SignOut)
                    // starts at LoginPage, whose own SignedIn case navigates
                    // to ProfilesPage the same way. See
                    // XboxAppEnvironment.HasPersistedSessionAsync.
                    var hasSession = await Environment.HasPersistedSessionAsync();
                    var startPageType = hasSession ? typeof(ProfilesPage) : typeof(LoginPage);
                    rootFrame.Navigate(startPageType, e.Arguments);
                }

                Window.Current.Activate();
            }
        }

        /// <summary>
        /// Only claims Back when the navigation frame actually has
        /// somewhere to go. An unclaimed Back press at the app's root is
        /// left for Xbox itself to handle (<c>e.Handled</c> stays
        /// <c>false</c>) -- the same judgment call
        /// <c>clients/tv-web/apps/tv-webos/src/webosLifecycle.mjs</c>'s
        /// <c>handleRemoteKey</c> makes for an unclaimed root Back press on
        /// that platform: only
        /// intercept Back when this app has something to unwind; otherwise
        /// hand it back to the platform.
        /// </summary>
        private void OnBackRequested(object sender, BackRequestedEventArgs e)
        {
            if (Window.Current.Content is Frame { Content: Views.PlayerPage player } && player.TryHandleBack())
            {
                e.Handled = true;
                return;
            }

            if (Navigation.CanGoBack)
            {
                e.Handled = true;
                Navigation.GoBack();
            }

            // Else: leave e.Handled false. Xbox's shell treats an unclaimed
            // Back at the root as "back out of the app" -- exactly the
            // behavior wanted here, and nothing this handler needs to
            // implement itself.
        }

        private async void OnSuspending(object sender, SuspendingEventArgs e)
        {
            var deferral = e.SuspendingOperation.GetDeferral();
            try
            {
                // XboxAppEnvironment persists eagerly; the only unsaved state
                // is the playback position, flushed here inside the deferral.
                if (Window.Current.Content is Frame { Content: Views.PlayerPage player })
                {
                    await player.FlushProgressAsync();
                }
            }
            catch (Exception)
            {
                // Best-effort: never block suspension.
            }
            finally
            {
                deferral.Complete();
            }
        }

        private void OnNavigationFailed(object sender, NavigationFailedEventArgs e) =>
            throw new Exception($"Failed to load page {e.SourcePageType.FullName}", e.Exception);
    }
}
