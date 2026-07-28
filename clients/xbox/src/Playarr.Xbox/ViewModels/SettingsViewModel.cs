using System;
using Windows.ApplicationModel;
using Playarr.Xbox;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.SettingsPage"/>: the current server address,
    /// a "change server" sub-flow, sign-out, and a static app-version
    /// display.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <strong>Reuses <see cref="LoginViewModel"/> rather than
    /// re-implementing its shape.</strong> Changing the server address here
    /// is the exact same validate-and-save / request-a-device-code /
    /// poll-for-approval flow <see cref="Views.LoginPage"/> already runs,
    /// so this ViewModel composes a private <see cref="LoginViewModel"/>
    /// instance (<see cref="ServerConnection"/>) instead of duplicating
    /// <see cref="LoginViewModel.Connect"/> /
    /// <see cref="LoginViewModel.CancelPairing"/>. The task that requested
    /// this screen offered factoring a shared server-address-entry
    /// <c>UserControl</c> as an alternative; this composes the
    /// <em>logic</em> instead and lets <see cref="Views.SettingsPage"/>
    /// build its own XAML panel that happens to look like
    /// <see cref="Views.LoginPage"/>'s -- simpler than introducing this
    /// project's first <c>UserControl</c> type for one reused panel.
    /// </para>
    /// <para>
    /// <see cref="ServerConnection"/>'s own <c>PropertyChanged</c> is
    /// relayed up through this ViewModel's -- see the constructor -- the
    /// same relay shape <see cref="LoginViewModel"/> itself uses for
    /// <c>XboxAppEnvironment.PairingState</c>. One subscription on this
    /// outer ViewModel (from <see cref="Views.SettingsPage"/>) is therefore
    /// enough to observe both this screen's own state and the nested
    /// reconnect flow's.
    /// </para>
    /// </remarks>
    public sealed class SettingsViewModel : ViewModelBase
    {
        private readonly XboxAppEnvironment _environment;

        public SettingsViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));

            ServerConnection = new LoginViewModel(environment);
            ServerConnection.PropertyChanged += (_, e) => OnPropertyChanged(nameof(ServerConnection));
        }

        /// <summary>The "change server" sub-flow -- see the type-level remarks.</summary>
        public LoginViewModel ServerConnection { get; }

        /// <summary>
        /// The server this install is currently paired against -- distinct
        /// from <see cref="ServerConnection"/>'s own
        /// <see cref="LoginViewModel.ServerAddress"/>, which is that
        /// sub-flow's editable entry-field text, not necessarily what is
        /// actually in effect yet.
        /// </summary>
        public string CurrentServerAddress => _environment.ServerUrl.ToString();

        /// <summary>
        /// <c>major.minor.build</c> from the installed package -- mirrors
        /// <c>XboxAppEnvironment.AppVersion</c>'s identical fallback for an
        /// unpackaged debug session where <see cref="Package.Current"/>
        /// throws.
        /// </summary>
        public static string AppVersionText
        {
            get
            {
                try
                {
                    var version = Package.Current.Id.Version;
                    return $"{version.Major}.{version.Minor}.{version.Build}";
                }
                catch (Exception)
                {
                    return "0.1.0";
                }
            }
        }

        /// <summary>
        /// Signs out via <c>XboxAppEnvironment.SignOut</c>. Navigating back
        /// to <see cref="Views.LoginPage"/> is the page's own
        /// responsibility -- see <see cref="Views.SettingsPage"/>'s
        /// sign-out click handler.
        /// </summary>
        public void SignOut() => _environment.SignOut();
    }
}
