using System.ComponentModel;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The reference screen every other page in Playarr.Xbox should follow
    /// structurally.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The pattern, in full, for two other agents building the remaining
    /// screens without seeing this file:
    /// </para>
    /// <list type="number">
    /// <item><description>
    /// The page's constructor calls <c>InitializeComponent()</c>, then
    /// constructs its ViewModel by hand -- <c>new FooViewModel(App.Environment)</c>
    /// -- and assigns it to a <c>private readonly FooViewModel _viewModel</c>
    /// field. No DI container resolves it; <c>App.Environment</c> is the one
    /// shared dependency every ViewModel needs, reached the same way from
    /// every page.
    /// </description></item>
    /// <item><description>
    /// <see cref="OnNavigatedTo"/> subscribes to
    /// <c>_viewModel.PropertyChanged</c> (every ViewModel is an
    /// <see cref="ObservableObject"/>, so this is always available) and
    /// calls <c>Render()</c> once immediately, so the page reflects current
    /// state right away rather than waiting for the first change.
    /// <see cref="OnNavigatedFrom"/> unsubscribes. This -- not the page
    /// constructor -- is where the subscription lives, so navigating away
    /// and back doesn't double-subscribe.
    /// </description></item>
    /// <item><description>
    /// A single private <c>Render()</c> method reads every property off the
    /// ViewModel it cares about and pushes the values onto this page's
    /// named XAML elements (<c>ElementName.Text = ...</c>,
    /// <c>ElementName.Visibility = ...</c>). It runs on every
    /// <c>PropertyChanged</c> notification regardless of which property
    /// changed -- simple, and cheap enough at this app's screen sizes that a
    /// finer-grained per-property diff isn't worth the code.
    /// </description></item>
    /// <item><description>
    /// <strong>No {x:Bind}, no {Binding}, and no IValueConverter anywhere in
    /// this project.</strong> Every dynamic value is plain imperative C# in
    /// <c>Render()</c> and every interactive control is a named element with
    /// a <c>Click="Foo_Click"</c> handler (a plain UWP routed-event hookup,
    /// not a binding) that forwards straight into a ViewModel method taking
    /// no parameters (<c>_viewModel.Connect()</c>,
    /// <c>_viewModel.CancelPairing()</c>). Keep this consistent across
    /// screens -- mixing compiled bindings into some pages and not others is
    /// the one thing that would make this pattern hard to follow file to
    /// file.
    /// </description></item>
    /// <item><description>
    /// A ViewModel's own async operations (anything that calls into
    /// <see cref="XboxAppEnvironment"/>) are fire-and-forget from the
    /// ViewModel's perspective -- see <c>LoginViewModel.BeginPairing()</c>.
    /// The page never awaits a ViewModel method; it only ever observes
    /// state transitions through <c>PropertyChanged</c> -> <c>Render()</c>.
    /// </description></item>
    /// <item><description>
    /// Navigating onward uses <c>App.Navigation.Navigate(typeof(NextPage))</c>
    /// from inside <c>Render()</c> at the point the ViewModel's state says
    /// "this screen is done" (here: <c>PairingStateKind.SignedIn</c>) --
    /// guarded by a one-shot boolean field (<c>_hasNavigated</c> here) so a
    /// state that stays constant across more than one <c>PropertyChanged</c>
    /// notification (which does happen -- see
    /// <c>LoginViewModel</c>'s relay of <c>XboxAppEnvironment.PairingState</c>)
    /// can never trigger a second, duplicate <c>Frame.Navigate</c> call.
    /// </description></item>
    /// </list>
    /// </remarks>
    public sealed partial class LoginPage : Page
    {
        private readonly LoginViewModel _viewModel;

        // Named "ToProfiles" rather than "ToHome": the Screens phase (task
        // #5) inserted Views/ProfilesPage as the real post-sign-in
        // destination, ahead of Views/HomePage -- see ProfilesPage's own
        // remarks for why picking a profile is a separate, synchronous step
        // rather than folded into this page's async pairing state machine.
        private bool _hasNavigatedToProfiles;

        public LoginPage()
        {
            InitializeComponent();
            _viewModel = new LoginViewModel(App.Environment);
            ServerAddressBox.Text = _viewModel.ServerAddress;
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
        /// elements. See the type-level remarks for why this is one
        /// unconditional method rather than a per-property handler.
        /// </summary>
        private void Render()
        {
            ServerErrorText.Text = _viewModel.ServerError ?? string.Empty;
            ServerErrorText.Visibility = string.IsNullOrEmpty(_viewModel.ServerError)
                ? Visibility.Collapsed
                : Visibility.Visible;

            var state = _viewModel.PairingState;

            var showServerPanel = state.Kind == PairingStateKind.SignedOut || state.Kind == PairingStateKind.Failed;
            ServerPanel.Visibility = showServerPanel ? Visibility.Visible : Visibility.Collapsed;
            ConnectButton.Content = state.Kind == PairingStateKind.Failed ? "Try pairing again" : "Connect";

            var showPairingPanel =
                state.Kind == PairingStateKind.RequestingCode || state.Kind == PairingStateKind.AwaitingApproval;
            PairingPanel.Visibility = showPairingPanel ? Visibility.Visible : Visibility.Collapsed;

            FailureText.Visibility = state.Kind == PairingStateKind.Failed ? Visibility.Visible : Visibility.Collapsed;

            switch (state.Kind)
            {
                case PairingStateKind.RequestingCode:
                    PairingProgressRing.IsActive = true;
                    PairingStatusText.Text = "Requesting a pairing code…";
                    DeviceCodePanel.Visibility = Visibility.Collapsed;
                    break;

                case PairingStateKind.AwaitingApproval:
                    PairingProgressRing.IsActive = true;
                    PairingStatusText.Text = "Waiting for approval…";
                    DeviceCodePanel.Visibility = Visibility.Visible;
                    VerificationUriText.Text = state.PendingCode?.VerificationUri ?? string.Empty;
                    UserCodeText.Text = state.PendingCode?.UserCode ?? string.Empty;
                    VerificationUriCompleteText.Text = state.PendingCode?.VerificationUriComplete ?? string.Empty;
                    break;

                case PairingStateKind.Failed:
                    PairingProgressRing.IsActive = false;
                    FailureText.Text = state.FailureMessage ?? "Playarr couldn't complete device pairing.";
                    break;

                case PairingStateKind.SignedIn:
                    PairingProgressRing.IsActive = false;
                    PairingStatusText.Text = "Paired.";
                    if (!_hasNavigatedToProfiles)
                    {
                        _hasNavigatedToProfiles = true;
                        App.Navigation.Navigate(typeof(ProfilesPage));
                    }

                    break;

                case PairingStateKind.SignedOut:
                default:
                    PairingProgressRing.IsActive = false;
                    break;
            }
        }

        private void ConnectButton_Click(object sender, RoutedEventArgs e)
        {
            _viewModel.ServerAddress = ServerAddressBox.Text;
            _viewModel.Connect();
        }

        private void CancelPairingButton_Click(object sender, RoutedEventArgs e) => _viewModel.CancelPairing();
    }
}
