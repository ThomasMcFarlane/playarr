using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Windows.ApplicationModel;
using Windows.Storage;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Xbox.Services;

namespace Playarr.Xbox
{
    /// <summary>
    /// The one environment object for this app -- a port of tvOS's
    /// <c>TVAppEnvironment</c> (<c>clients/apple-tv/Sources/TVAppEnvironment.swift</c>).
    /// Owns the persisted server address and per-install device id, the
    /// current <see cref="ApiClient"/>/<see cref="DeviceFlowClient"/> built
    /// from them, and <see cref="PairingState"/>. Constructed once by
    /// <c>App()</c> and reached by every page via the static
    /// <c>App.Environment</c> accessor.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Ports <c>TVAppEnvironment</c>'s shape exactly:
    /// <see cref="SaveServerAddress"/> validates and normalises the address,
    /// persists it, rebuilds <see cref="ApiClient"/>/the device-flow client,
    /// signs out, and forgets the known-server group (a different server
    /// invalidates whatever group was remembered for the old one).
    /// <see cref="StartPairingAsync"/> retries <c>RequestDeviceCodeAsync()</c>
    /// across every remembered address
    /// (<see cref="KnownServerGroup.CandidateUrls"/>: last-good first)
    /// before giving up, adopts whichever address actually answered as the
    /// new <see cref="ServerUrl"/>, then polls for the token.
    /// <see cref="SignOut"/> clears the persisted session and resets
    /// <see cref="PairingState"/>.
    /// </para>
    /// <para>
    /// The one deliberate difference from <c>TVAppEnvironment</c>: the
    /// device-code retry loop
    /// (<see cref="RequestDeviceCodeAcrossKnownAddressesAsync"/>) is written
    /// out by hand here rather than delegating to
    /// <c>AccessTokenCoordinator</c>'s any-node/same-node retry split,
    /// because device-code requests are unauthenticated and go straight
    /// through <c>DeviceFlowClient</c> -- outside
    /// <c>AccessTokenCoordinator</c>'s scope (that type is <c>internal</c>
    /// to Playarr.Core and only ever runs behind
    /// <c>PlayarrApiClient</c>'s login/refresh calls). It does still reuse
    /// <see cref="KnownServerGroup.CandidateUrls"/> and
    /// <see cref="IKnownServerGroupStore"/> rather than re-deriving the
    /// address-list logic itself.
    /// </para>
    /// </remarks>
    public sealed class XboxAppEnvironment : ObservableObject
    {
        private const string ServerUrlSettingsKey = "ServerUrl";
        private const string DeviceIdSettingsKey = "DeviceId";
        private static readonly Uri DefaultServerUrl = new Uri("http://localhost:8484");

        private readonly ApplicationDataContainer _localSettings = ApplicationData.Current.LocalSettings;
        private readonly ITokenStore _tokenStore = new PasswordVaultTokenStore();
        private readonly IKnownServerGroupStore _serverGroupStore = new LocalSettingsKnownServerGroupStore();
        private readonly Guid _deviceId;

        private IPlayarrApiClient _apiClient = null!;
        private DeviceFlowClient _deviceFlowClient = null!;
        private Uri _serverUrl;
        private string _serverAddress;
        private PairingState _pairingState = PairingState.SignedOut;

        public XboxAppEnvironment()
        {
            _deviceId = LoadOrCreateDeviceId();
            _serverUrl = LoadServerUrl();
            _serverAddress = _serverUrl.ToString();
            RebuildClients();
        }

        /// <summary>The typed Playarr API client, rebuilt whenever <see cref="ServerUrl"/> changes.</summary>
        public IPlayarrApiClient ApiClient => _apiClient;

        public PairingState PairingState
        {
            get => _pairingState;
            private set => SetProperty(ref _pairingState, value);
        }

        public Uri ServerUrl
        {
            get => _serverUrl;
            private set => SetProperty(ref _serverUrl, value);
        }

        /// <summary>
        /// The raw text a server-address entry field should show. Kept as
        /// its own property (rather than always deriving from
        /// <see cref="ServerUrl"/>) purely as a display convenience for
        /// pages that want to pre-fill a TextBox from it.
        /// </summary>
        public string ServerAddress
        {
            get => _serverAddress;
            private set => SetProperty(ref _serverAddress, value);
        }

        /// <summary>
        /// Whether a session is already persisted -- decides
        /// <c>App.OnLaunched</c>'s start page (HomePage vs LoginPage)
        /// without forcing a real API call. Presence alone is enough: an
        /// access token that has since expired but still has a good refresh
        /// token is still "signed in" as far as startup routing cares, and
        /// <c>PlayarrApiClient</c>'s internal token coordinator refreshes
        /// lazily on the first real request either way.
        /// </summary>
        public async Task<bool> HasPersistedSessionAsync(CancellationToken cancellationToken = default) =>
            await _tokenStore.GetSessionAsync(cancellationToken).ConfigureAwait(false) != null;

        /// <summary>
        /// Validates and normalises <paramref name="address"/>, persists it,
        /// rebuilds <see cref="ApiClient"/> and the device-flow client
        /// against it, signs out, and forgets the known-server group -- a
        /// different server invalidates whatever group was remembered for
        /// the old one. Returns <c>false</c> without any side effects when
        /// <paramref name="address"/> doesn't parse as an http(s) URL with a
        /// host.
        /// </summary>
        public bool SaveServerAddress(string address)
        {
            var normalized = NormalizeServerAddress(address);
            if (normalized is null)
            {
                return false;
            }

            ServerUrl = normalized;
            ServerAddress = normalized.ToString();
            _localSettings.Values[ServerUrlSettingsKey] = normalized.ToString();
            RebuildClients();
            SignOut();

            // Fire-and-forget, mirroring TVAppEnvironment.saveServerAddress()'s
            // `Task { await self.serverGroupStore.forget() }` -- the caller
            // doesn't need to wait for this to finish, and
            // LocalSettingsKnownServerGroupStore never truly awaits I/O
            // (LocalSettings access is synchronous under the Task wrapper).
            _ = _serverGroupStore.ForgetAsync();

            return true;
        }

        /// <summary>
        /// Requests a device code, retrying across every address this
        /// install has ever remembered for its current server group
        /// (<see cref="KnownServerGroup.CandidateUrls"/>: last-good first)
        /// before surfacing a failure, then polls for the token. The
        /// address that actually answers the device-code request becomes
        /// <see cref="ServerUrl"/> (and this install's new last-good
        /// address) so everything from here on -- polling, and every
        /// catalog/playback call once signed in -- consistently targets the
        /// address that's actually reachable, not whichever one happened to
        /// be configured before this attempt.
        /// </summary>
        public async Task StartPairingAsync(CancellationToken cancellationToken = default)
        {
            PairingState = PairingState.RequestingCode;

            try
            {
                var (pending, authorizer, answeredUrl) = await RequestDeviceCodeAcrossKnownAddressesAsync(cancellationToken)
                    .ConfigureAwait(false);

                if (answeredUrl != ServerUrl)
                {
                    AdoptWorkingServerUrl(answeredUrl);
                }

                _deviceFlowClient = authorizer;
                await _serverGroupStore
                    .RecordSuccessAsync(TrimTrailingSlash(answeredUrl), DateTimeOffset.UtcNow, cancellationToken)
                    .ConfigureAwait(false);

                PairingState = PairingState.AwaitingApproval(pending);

                var token = await authorizer
                    .PollForTokenAsync(
                        pending.DeviceCode,
                        TimeSpan.FromSeconds(pending.Interval),
                        TimeSpan.FromSeconds(pending.ExpiresIn),
                        cancellationToken: cancellationToken)
                    .ConfigureAwait(false);

                var session = new StoredAuthSession(
                    token.AccessToken,
                    token.RefreshToken,
                    token.TokenType,
                    DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn));
                await _tokenStore.StoreSessionAsync(session, cancellationToken).ConfigureAwait(false);

                PairingState = PairingState.SignedIn;
            }
            catch (OperationCanceledException)
            {
                PairingState = PairingState.SignedOut;
            }
            catch (DeviceFlowException error)
            {
                PairingState = PairingState.Failed(error.DisplayMessage);
            }
            catch (Exception error)
            {
                PairingState = PairingState.Failed(error.Message);
            }
        }

        /// <summary>Clears the persisted session and resets <see cref="PairingState"/>.</summary>
        public void SignOut()
        {
            PairingState = PairingState.SignedOut;

            // Fire-and-forget: PasswordVaultTokenStore's clear is a local,
            // fast, non-blocking operation, and every caller of SignOut
            // treats the state transition above as the observable effect --
            // nobody awaits SignOut() to know the vault entry is gone.
            _ = _tokenStore.ClearSessionAsync();
        }

        /// <summary>
        /// Tries <c>RequestDeviceCodeAsync()</c> against <see cref="ServerUrl"/>
        /// first, then every other address this install's
        /// <see cref="KnownServerGroup"/> remembers (last-good first,
        /// deduplicated) -- mirrors
        /// <c>TVAppEnvironment.requestDeviceCodeAcrossKnownAddresses()</c>.
        /// Rethrows the last failure once every candidate (at least
        /// <see cref="ServerUrl"/> itself) has failed.
        /// </summary>
        private async Task<(DeviceCodeResponse Pending, DeviceFlowClient Authorizer, Uri AnsweredUrl)>
            RequestDeviceCodeAcrossKnownAddressesAsync(CancellationToken cancellationToken)
        {
            Exception lastError = new ApiException(
                ApiErrorKind.Transport,
                "no server address answered the device-code request");

            foreach (var baseUrl in await CandidateServerUrlsAsync(cancellationToken).ConfigureAwait(false))
            {
                var authorizer = baseUrl == ServerUrl
                    ? _deviceFlowClient
                    : new DeviceFlowClient(baseUrl, clientPlatform: ClientPlatform.Xbox);

                try
                {
                    var pending = await authorizer.RequestDeviceCodeAsync(cancellationToken).ConfigureAwait(false);
                    return (pending, authorizer, baseUrl);
                }
                catch (Exception error)
                {
                    lastError = error;
                }
            }

            throw lastError;
        }

        /// <summary>
        /// <see cref="ServerUrl"/> first (today's only candidate when no
        /// group is known -- preserves single-address behavior exactly),
        /// then every other address this install's <see cref="KnownServerGroup"/>
        /// remembers.
        /// </summary>
        private async Task<IReadOnlyList<Uri>> CandidateServerUrlsAsync(CancellationToken cancellationToken)
        {
            var urls = new List<Uri> { ServerUrl };

            var group = await _serverGroupStore.GetGroupAsync(cancellationToken).ConfigureAwait(false);
            if (group is null)
            {
                return urls;
            }

            foreach (var candidate in group.CandidateUrls())
            {
                if (Uri.TryCreate(candidate, UriKind.Absolute, out var parsed) && !urls.Contains(parsed))
                {
                    urls.Add(parsed);
                }
            }

            return urls;
        }

        /// <summary>
        /// Adopts <paramref name="url"/> as the current <see cref="ServerUrl"/>
        /// once pairing has actually proven it reachable -- persists it the
        /// same way <see cref="SaveServerAddress"/> does, and rebuilds
        /// <see cref="ApiClient"/> so post-pairing catalog/playback calls
        /// target it too. Deliberately doesn't touch <c>_deviceFlowClient</c>
        /// (the caller already holds the exact authorizer instance that
        /// just succeeded) or call <see cref="SignOut"/> (pairing is still
        /// in progress).
        /// </summary>
        private void AdoptWorkingServerUrl(Uri url)
        {
            ServerUrl = url;
            ServerAddress = url.ToString();
            _localSettings.Values[ServerUrlSettingsKey] = url.ToString();
            _apiClient = BuildApiClient(url);
        }

        private void RebuildClients()
        {
            _apiClient = BuildApiClient(ServerUrl);
            _deviceFlowClient = new DeviceFlowClient(ServerUrl, clientPlatform: ClientPlatform.Xbox);
        }

        private IPlayarrApiClient BuildApiClient(Uri baseUrl)
        {
            var configuration = new ApiClientConfiguration(baseUrl, _deviceId)
            {
                ClientPlatform = ClientPlatform.Xbox,
                ClientVersion = AppVersion,
                DeviceName = "Playarr for Xbox",
            };

            return new PlayarrApiClient(configuration, _tokenStore, _serverGroupStore);
        }

        private Guid LoadOrCreateDeviceId()
        {
            if (_localSettings.Values.TryGetValue(DeviceIdSettingsKey, out var stored) &&
                stored is string text &&
                Guid.TryParse(text, out var parsed))
            {
                return parsed;
            }

            var generated = Guid.NewGuid();
            _localSettings.Values[DeviceIdSettingsKey] = generated.ToString();
            return generated;
        }

        private Uri LoadServerUrl()
        {
            if (_localSettings.Values.TryGetValue(ServerUrlSettingsKey, out var stored) &&
                stored is string text &&
                Uri.TryCreate(text, UriKind.Absolute, out var parsed))
            {
                return parsed;
            }

            return DefaultServerUrl;
        }

        /// <summary>
        /// Port of tvOS's <c>TVServerAddress.normalisedURL(from:)</c>: trims
        /// whitespace, assumes <c>http://</c> when no scheme is given, and
        /// accepts only http/https with a non-empty host.
        /// </summary>
        private static Uri? NormalizeServerAddress(string? input)
        {
            var trimmed = input?.Trim();
            if (string.IsNullOrEmpty(trimmed))
            {
                return null;
            }

            var candidate = trimmed!.Contains("://") ? trimmed : "http://" + trimmed;
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
            {
                return null;
            }

            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            {
                return null;
            }

            return string.IsNullOrEmpty(uri.Host) ? null : uri;
        }

        private static string TrimTrailingSlash(Uri url) => url.ToString().TrimEnd('/');

        /// <summary>
        /// Read from the installed package's own version rather than
        /// hard-coded, so the <c>X-Playarr-Client-Version</c> header
        /// always matches what actually shipped. Falls back to
        /// <c>Directory.Build.props</c>'s <c>0.1.0</c> for an unpackaged
        /// debug session (e.g. F5 without a packaging project active),
        /// where <see cref="Package.Current"/> throws.
        /// </summary>
        private static string AppVersion
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
    }
}
