using System;
using System.Threading;
using Playarr.Xbox;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// The reference ViewModel every other screen's ViewModel should follow
    /// structurally: a private readonly reference to <see cref="XboxAppEnvironment"/>
    /// passed in by the page's constructor (via <c>App.Environment</c>), one
    /// or more mutable properties of its own (here, the address-entry
    /// field's text and any validation error) using the same
    /// <see cref="ObservableObject.SetProperty{T}"/> pattern, and a
    /// subscription to the environment's own <c>PropertyChanged</c> so this
    /// ViewModel's own change notification stays in sync with environment
    /// state it doesn't own (here, <see cref="XboxAppEnvironment.PairingState"/>).
    /// </summary>
    /// <remarks>
    /// This screen deliberately holds no async <see cref="System.Threading.Tasks.Task"/>-returning
    /// methods that a page needs to await: <see cref="Connect"/> and
    /// <see cref="CancelPairing"/> both kick off environment work and return
    /// immediately, exactly mirroring
    /// <c>TVSettingsView.beginPairing()</c>'s <c>Task { await environment.startPairing() }</c>
    /// fire-and-forget shape. The page observes progress purely through
    /// <see cref="PairingState"/> changing, not by awaiting anything itself.
    /// </remarks>
    public sealed class LoginViewModel : ViewModelBase
    {
        private readonly XboxAppEnvironment _environment;
        private CancellationTokenSource? _pairingCancellation;

        private string _serverAddress;
        private string? _serverError;

        public LoginViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _serverAddress = environment.ServerAddress;

            // Relay the two environment properties this screen cares about.
            // A page subscribed to *this* ViewModel's PropertyChanged sees
            // both the ViewModel's own properties (ServerAddress,
            // ServerError) and this relayed one (PairingState) through the
            // exact same event -- one subscription covers everything the
            // page needs to re-render.
            _environment.PropertyChanged += (_, e) =>
            {
                if (e.PropertyName == nameof(XboxAppEnvironment.PairingState))
                {
                    OnPropertyChanged(nameof(PairingState));
                }
            };
        }

        public string ServerAddress
        {
            get => _serverAddress;
            set => SetProperty(ref _serverAddress, value);
        }

        /// <summary>Set after a failed <see cref="Connect"/> call; <c>null</c> otherwise.</summary>
        public string? ServerError
        {
            get => _serverError;
            private set => SetProperty(ref _serverError, value);
        }

        /// <summary>Relayed straight from <see cref="XboxAppEnvironment.PairingState"/>.</summary>
        public PairingState PairingState => _environment.PairingState;

        /// <summary>
        /// Validates and saves <see cref="ServerAddress"/> via
        /// <see cref="XboxAppEnvironment.SaveServerAddress"/>; on success,
        /// starts pairing against it. Sets <see cref="ServerError"/> and
        /// does nothing else on an invalid address.
        /// </summary>
        public void Connect()
        {
            if (!_environment.SaveServerAddress(ServerAddress))
            {
                ServerError = "Enter a valid http:// or https:// server address.";
                return;
            }

            ServerError = null;
            BeginPairing();
        }

        /// <summary>
        /// Starts (or restarts) <see cref="XboxAppEnvironment.StartPairingAsync"/>,
        /// cancelling any pairing attempt already in flight first.
        /// </summary>
        public void BeginPairing()
        {
            _pairingCancellation?.Cancel();
            var cancellation = new CancellationTokenSource();
            _pairingCancellation = cancellation;

            // Fire-and-forget -- see the type-level remarks. The page
            // re-renders as PairingState changes, not by awaiting this call.
            _ = _environment.StartPairingAsync(cancellation.Token);
        }

        /// <summary>Cancels an in-flight pairing attempt and signs back out.</summary>
        public void CancelPairing()
        {
            _pairingCancellation?.Cancel();
            _pairingCancellation = null;
            _environment.SignOut();
        }
    }
}
