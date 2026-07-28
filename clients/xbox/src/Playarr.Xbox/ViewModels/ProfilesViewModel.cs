using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.ProfilesPage"/>. Loads the account's
    /// <see cref="AvailableProfile"/> list via
    /// <see cref="IPlayarrApiClient.ListProfilesAsync"/> on construction.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Unlike <see cref="LoginViewModel"/>, picking a profile is a
    /// synchronous, one-shot user action, not an async state machine -- there
    /// is no server-side "activate profile" call for it to await
    /// (<see cref="IPlayarrApiClient"/> only exposes
    /// <see cref="IPlayarrApiClient.ListProfilesAsync"/> today; see this
    /// change's reported open issues for the follow-up that implies). So
    /// this ViewModel has no <c>SelectedProfile</c>/<c>SelectProfile()</c>
    /// surface for <see cref="Views.ProfilesPage"/> to watch through
    /// <c>Render()</c> -- that page's tile <c>Click</c> handler navigates to
    /// <see cref="Views.HomePage"/> directly, the same judgment call
    /// <c>Views/LoginPage.xaml.cs</c>'s <c>CancelPairingButton_Click</c>
    /// makes for an instantaneous action with nothing to relay.
    /// </para>
    /// <para>
    /// <see cref="LoadAsync"/> deliberately omits <c>.ConfigureAwait(false)</c>,
    /// unlike <see cref="XboxAppEnvironment"/>'s async methods: this
    /// ViewModel's own continuation sets properties that
    /// <see cref="Views.ProfilesPage"/>'s <c>Render()</c> reads straight into
    /// XAML elements, so it must resume on the UI thread (the default
    /// behaviour once the awaited call's continuation isn't opted out of the
    /// UWP-installed <c>SynchronizationContext</c>), not on whatever
    /// thread-pool thread the HTTP call happened to complete on.
    /// </para>
    /// </remarks>
    public sealed class ProfilesViewModel : ViewModelBase
    {
        private readonly XboxAppEnvironment _environment;

        private IReadOnlyList<AvailableProfile> _profiles = Array.Empty<AvailableProfile>();
        private bool _isLoading;
        private string? _errorMessage;

        public ProfilesViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));

            // Fire-and-forget -- the page observes progress purely through
            // PropertyChanged -> Render(), same shape as every other
            // ViewModel's own async operations in this project.
            _ = LoadAsync();
        }

        public IReadOnlyList<AvailableProfile> Profiles
        {
            get => _profiles;
            private set => SetProperty(ref _profiles, value);
        }

        public bool IsLoading
        {
            get => _isLoading;
            private set => SetProperty(ref _isLoading, value);
        }

        /// <summary>Set when <see cref="LoadAsync"/> fails; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>Retries a failed load. Wired to ProfilesPage's retry button.</summary>
        public void Retry() => _ = LoadAsync();

        private async Task LoadAsync()
        {
            IsLoading = true;
            ErrorMessage = null;

            try
            {
                var profiles = await _environment.ApiClient.ListProfilesAsync();
                Profiles = new List<AvailableProfile>(profiles);
            }
            catch (ApiException error)
            {
                ErrorMessage = error.DisplayMessage;
            }
            catch (Exception error)
            {
                ErrorMessage = error.Message;
            }
            finally
            {
                IsLoading = false;
            }
        }
    }
}
