using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Playback;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// The shape of the Playarr HTTP API this client depends on,
    /// independent of how a request is actually made -- so screens can be
    /// tested against a substitute.
    /// </summary>
    /// <remarks>
    /// The RFC 8628 device-flow endpoints are deliberately absent: they live
    /// in <see cref="DeviceFlowClient"/>, because their unauthenticated,
    /// polling-with-backoff shape does not fit this interface's "one call in,
    /// one typed result out" pattern.
    /// </remarks>
    public interface IPlayarrApiClient
    {
        Uri BaseUrl { get; }

        Task<VersionEnvelope> GetVersionAsync(CancellationToken cancellationToken = default);

        Task<CatalogPage> BrowseCatalogAsync(
            WorkKind? kind = null,
            string? genre = null,
            string? sort = null,
            int? limit = null,
            int? offset = null,
            CancellationToken cancellationToken = default);

        Task<IList<Work>> SearchCatalogAsync(
            string query,
            int? limit = null,
            CancellationToken cancellationToken = default);

        Task<WorkDetail> GetWorkAsync(Guid id, CancellationToken cancellationToken = default);

        /// <summary>Works similar to <paramref name="id"/> (<c>/api/v1/catalog/{id}/similar</c>), used for end-of-playback suggestions.</summary>
        Task<IList<Work>> GetSimilarWorksAsync(Guid id, int? limit = null, CancellationToken cancellationToken = default);

        Task<IList<WorkKind>> ListCatalogKindsAsync(CancellationToken cancellationToken = default);

        Task<IList<AvailableProfile>> ListProfilesAsync(CancellationToken cancellationToken = default);

        Task<IList<WatchProgress>> ListWatchProgressAsync(CancellationToken cancellationToken = default);

        Task<WatchProgress> UpdateWatchProgressAsync(
            Guid mediaFileId,
            UpdateWatchProgressRequest body,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Negotiates delivery for one media file against this console's
        /// declared capabilities.
        /// </summary>
        Task<PlaybackInfoResponse> GetPlaybackInfoAsync(
            Guid mediaFileId,
            XboxPlaybackProfile profile,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// The <c>Authorization</c> header a media element must send when
        /// fetching the stream itself. <c>MediaPlayerElement</c> fetches
        /// segments outside this client, so it needs the token handed to it.
        /// </summary>
        Task<IDictionary<string, string>> GetPlaybackRequestHeadersAsync(
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Resolves a possibly server-relative URL (as returned in
        /// <see cref="PlaybackInfoResponse.Url"/>) against
        /// <see cref="BaseUrl"/>.
        /// </summary>
        Uri? ResolveUrl(string path);
    }

    /// <summary>
    /// One platform's row in the server's compatibility table.
    /// </summary>
    public sealed class CompatibilityEntry
    {
        [Newtonsoft.Json.JsonProperty("platform")] public ClientPlatform? Platform { get; set; }

        [Newtonsoft.Json.JsonProperty("latest_version")] public string LatestVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("min_supported_version")] public string MinSupportedVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("deprecated_below")] public string? DeprecatedBelow { get; set; }

        [Newtonsoft.Json.JsonProperty("sunset")] public string? Sunset { get; set; }
    }

    public sealed class VersionEnvelope
    {
        [Newtonsoft.Json.JsonProperty("instance_name")] public string InstanceName { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("server_version")] public string ServerVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("api_version")] public string ApiVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("build_sha")] public string? BuildSha { get; set; }

        [Newtonsoft.Json.JsonProperty("compatibility")] public IList<CompatibilityEntry> Compatibility { get; set; } =
            new List<CompatibilityEntry>();
    }

    /// <summary>
    /// Real <see cref="HttpClient"/>-backed implementation.
    /// </summary>
    public sealed class PlayarrApiClient : IPlayarrApiClient
    {
        public const string ClientPlatformHeader = "X-Playarr-Client-Platform";
        public const string ClientVersionHeader = "X-Playarr-Client-Version";

        private readonly ApiClientConfiguration _configuration;
        private readonly HttpClient _http;
        private readonly AccessTokenCoordinator? _tokens;

        public PlayarrApiClient(
            ApiClientConfiguration configuration,
            ITokenStore? tokenStore = null,
            IKnownServerGroupStore? serverGroupStore = null,
            HttpClient? httpClient = null,
            Func<DateTimeOffset>? clock = null)
        {
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _http = httpClient ?? new HttpClient();
            _tokens = tokenStore is null
                ? null
                : new AccessTokenCoordinator(configuration, tokenStore, serverGroupStore, _http, clock);
        }

        public Uri BaseUrl => _configuration.BaseUrl;

        public Task<VersionEnvelope> GetVersionAsync(CancellationToken cancellationToken = default) =>
            GetAsync<VersionEnvelope>("/api/system/version", null, authenticated: false, cancellationToken);

        public Task<CatalogPage> BrowseCatalogAsync(
            WorkKind? kind = null,
            string? genre = null,
            string? sort = null,
            int? limit = null,
            int? offset = null,
            CancellationToken cancellationToken = default)
        {
            var query = new Dictionary<string, string>();
            if (kind is { } workKind && workKind != WorkKind.Unknown)
            {
                query["kind"] = WireNameFor(workKind);
            }

            if (!string.IsNullOrEmpty(genre)) query["genre"] = genre!;
            if (!string.IsNullOrEmpty(sort)) query["sort"] = sort!;
            if (limit is { } l) query["limit"] = l.ToString(CultureInfo.InvariantCulture);
            if (offset is { } o) query["offset"] = o.ToString(CultureInfo.InvariantCulture);

            return GetAsync<CatalogPage>("/api/v1/catalog", query, authenticated: true, cancellationToken);
        }

        public Task<IList<Work>> SearchCatalogAsync(
            string query,
            int? limit = null,
            CancellationToken cancellationToken = default)
        {
            var parameters = new Dictionary<string, string> { ["q"] = query };
            if (limit is { } l) parameters["limit"] = l.ToString(CultureInfo.InvariantCulture);

            return GetAsync<IList<Work>>(
                "/api/v1/catalog/search", parameters, authenticated: true, cancellationToken);
        }

        public Task<WorkDetail> GetWorkAsync(Guid id, CancellationToken cancellationToken = default) =>
            GetAsync<WorkDetail>($"/api/v1/catalog/{id:D}", null, authenticated: true, cancellationToken);

        public Task<IList<Work>> GetSimilarWorksAsync(
            Guid id, int? limit = null, CancellationToken cancellationToken = default)
        {
            var query = new Dictionary<string, string>();
            if (limit is { } l) query["limit"] = l.ToString(CultureInfo.InvariantCulture);

            return GetAsync<IList<Work>>(
                $"/api/v1/catalog/{id:D}/similar", query, authenticated: true, cancellationToken);
        }

        public Task<IList<WorkKind>> ListCatalogKindsAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<WorkKind>>("/api/v1/catalog/kinds", null, authenticated: true, cancellationToken);

        public Task<IList<AvailableProfile>> ListProfilesAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<AvailableProfile>>(
                "/api/v1/users/profiles", null, authenticated: true, cancellationToken);

        public Task<IList<WatchProgress>> ListWatchProgressAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<WatchProgress>>(
                "/api/v1/playback/progress", null, authenticated: true, cancellationToken);

        public Task<WatchProgress> UpdateWatchProgressAsync(
            Guid mediaFileId,
            UpdateWatchProgressRequest body,
            CancellationToken cancellationToken = default) =>
            SendAsync<WatchProgress>(
                HttpMethod.Put,
                $"/api/v1/playback/{mediaFileId:D}/progress",
                JsonCoding.Serialize(body),
                cancellationToken);

        public Task<PlaybackInfoResponse> GetPlaybackInfoAsync(
            Guid mediaFileId,
            XboxPlaybackProfile profile,
            CancellationToken cancellationToken = default)
        {
            var query = new Dictionary<string, string>();
            foreach (var pair in profile.ToQueryParameters())
            {
                query[pair.Key] = pair.Value;
            }

            return GetAsync<PlaybackInfoResponse>(
                $"/api/v1/playback/{mediaFileId:D}", query, authenticated: true, cancellationToken);
        }

        public async Task<IDictionary<string, string>> GetPlaybackRequestHeadersAsync(
            CancellationToken cancellationToken = default)
        {
            if (_tokens is null)
            {
                return new Dictionary<string, string>();
            }

            var token = await _tokens.GetAccessTokenAsync(false, cancellationToken).ConfigureAwait(false);
            return new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" };
        }

        public Uri? ResolveUrl(string path) =>
            Uri.TryCreate(_configuration.BaseUrl, path, out var resolved) ? resolved : null;

        private static string WireNameFor(WorkKind kind) => kind switch
        {
            WorkKind.Movie => "movie",
            WorkKind.Series => "series",
            WorkKind.Site => "site",
            WorkKind.Artist => "artist",
            WorkKind.Author => "author",
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "not a filterable catalog kind"),
        };

        private async Task<T> GetAsync<T>(
            string path,
            IDictionary<string, string>? query,
            bool authenticated,
            CancellationToken cancellationToken)
            where T : class
        {
            try
            {
                return await SendOnceAsync<T>(
                    HttpMethod.Get, path, query, null, authenticated, false, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (ApiException error) when (
                error.Kind == ApiErrorKind.Unauthorized && authenticated && _tokens != null)
            {
                // One forced refresh, then one retry. A second 401 is a real
                // authorization failure, not a stale token.
                return await SendOnceAsync<T>(
                    HttpMethod.Get, path, query, null, true, true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        private async Task<T> SendAsync<T>(
            HttpMethod method,
            string path,
            string? body,
            CancellationToken cancellationToken)
            where T : class
        {
            try
            {
                return await SendOnceAsync<T>(method, path, null, body, true, false, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                return await SendOnceAsync<T>(method, path, null, body, true, true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        private async Task<T> SendOnceAsync<T>(
            HttpMethod method,
            string path,
            IDictionary<string, string>? query,
            string? body,
            bool authenticated,
            bool forceRefresh,
            CancellationToken cancellationToken)
            where T : class
        {
            using var request = new HttpRequestMessage(method, BuildUri(path, query));
            request.Headers.TryAddWithoutValidation("Accept", "application/json");
            request.Headers.TryAddWithoutValidation(
                ClientPlatformHeader, _configuration.ClientPlatform.WireName());
            request.Headers.TryAddWithoutValidation(ClientVersionHeader, _configuration.ClientVersion);

            if (body != null)
            {
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            }

            if (authenticated && _tokens != null)
            {
                var token = await _tokens
                    .GetAccessTokenAsync(forceRefresh, cancellationToken)
                    .ConfigureAwait(false);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
            }

            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception transport) when (transport is HttpRequestException or OperationCanceledException
                                              && !cancellationToken.IsCancellationRequested)
            {
                throw new ApiException(
                    ApiErrorKind.Transport, "the request could not be sent", innerException: transport);
            }

            using (response)
            {
                var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                if (!response.IsSuccessStatusCode)
                {
                    throw ApiException.ForStatus(
                        response.StatusCode, JsonCoding.Deserialize<ApiErrorBody>(payload));
                }

                try
                {
                    return JsonCoding.Deserialize<T>(payload)
                        ?? throw new ApiException(
                            ApiErrorKind.Decoding, $"unreadable {typeof(T).Name} response");
                }
                catch (Newtonsoft.Json.JsonException decoding)
                {
                    throw new ApiException(
                        ApiErrorKind.Decoding,
                        $"the server's {typeof(T).Name} response did not match this build",
                        response.StatusCode,
                        innerException: decoding);
                }
            }
        }

        /// <summary>
        /// Appends to the base URL's path rather than replacing it, so an
        /// operator serving Playarr behind a reverse-proxy prefix keeps
        /// working.
        /// </summary>
        private Uri BuildUri(string path, IDictionary<string, string>? query)
        {
            var builder = new UriBuilder(_configuration.BaseUrl);
            builder.Path = builder.Path.TrimEnd('/') + path;

            if (query is { Count: > 0 })
            {
                var parts = new List<string>();
                foreach (var pair in query)
                {
                    parts.Add($"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}");
                }

                builder.Query = string.Join("&", parts);
            }

            return builder.Uri;
        }
    }
}
