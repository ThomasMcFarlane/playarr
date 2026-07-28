using System;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Core.Auth
{
    /// <summary>
    /// The RFC 8628 §3.5 error codes the token endpoint returns while
    /// polling, plus RFC 6749 §5.2's <c>unsupported_grant_type</c>.
    /// </summary>
    public enum DeviceFlowErrorCode
    {
        /// <summary>An unrecognised code. Surfaced rather than swallowed.</summary>
        Other = 0,

        AuthorizationPending,
        SlowDown,
        ExpiredToken,
        AccessDenied,
        UnsupportedGrantType,
    }

    public sealed class DeviceFlowException : Exception
    {
        public DeviceFlowException(
            DeviceFlowErrorCode code,
            string message,
            Exception? innerException = null)
            : base(message, innerException)
        {
            Code = code;
        }

        public DeviceFlowErrorCode Code { get; }

        public static DeviceFlowErrorCode ParseCode(string? wireValue)
        {
            switch (wireValue)
            {
                case "authorization_pending": return DeviceFlowErrorCode.AuthorizationPending;
                case "slow_down": return DeviceFlowErrorCode.SlowDown;
                case "expired_token": return DeviceFlowErrorCode.ExpiredToken;
                case "access_denied": return DeviceFlowErrorCode.AccessDenied;
                case "unsupported_grant_type": return DeviceFlowErrorCode.UnsupportedGrantType;
                default: return DeviceFlowErrorCode.Other;
            }
        }

        /// <summary>A message worth putting in front of a viewer.</summary>
        public string DisplayMessage
        {
            get
            {
                switch (Code)
                {
                    case DeviceFlowErrorCode.ExpiredToken:
                        return "The pairing code expired. Request a new code.";
                    case DeviceFlowErrorCode.AccessDenied:
                        return "The pairing request was denied.";
                    case DeviceFlowErrorCode.UnsupportedGrantType:
                        return "This server doesn't support pairing from a console.";
                    default:
                        return "Playarr couldn't complete device pairing.";
                }
            }
        }
    }

    /// <summary>
    /// Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) against
    /// <c>POST /api/v1/oauth/device/code</c> and
    /// <c>POST /api/v1/oauth/token</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is how an Xbox signs in. Typing a password with a gamepad is
    /// miserable, so the console shows a short code and a URL, the viewer
    /// finishes on a phone or laptop, and the console polls until a token
    /// arrives.
    /// </para>
    /// <para>
    /// Kept as its own component rather than folded into
    /// <c>PlayarrApiClient</c> because the shape is genuinely different
    /// from every other endpoint: unauthenticated, and the token call needs
    /// its own backoff-and-expiry loop rather than one request/response
    /// round trip. Note both endpoints take and return plain JSON, not
    /// <c>application/x-www-form-urlencoded</c> as a generic OAuth server
    /// would.
    /// </para>
    /// </remarks>
    public sealed class DeviceFlowClient
    {
        private const string DeviceCodePath = "/api/v1/oauth/device/code";
        private const string TokenPath = "/api/v1/oauth/token";

        private readonly HttpClient _http;

        public DeviceFlowClient(
            Uri baseUrl,
            HttpClient? httpClient = null,
            ClientPlatform clientPlatform = ClientPlatform.Xbox)
        {
            BaseUrl = baseUrl ?? throw new ArgumentNullException(nameof(baseUrl));
            ClientPlatform = clientPlatform;
            _http = httpClient ?? new HttpClient();
        }

        /// <summary>
        /// The server this instance talks to. Exposed so a caller retrying
        /// across every remembered address can tell which one actually
        /// answered.
        /// </summary>
        public Uri BaseUrl { get; }

        public ClientPlatform ClientPlatform { get; }

        /// <summary>
        /// RFC 8628 §3.1/§3.2: request a device code and a user code.
        /// </summary>
        public async Task<DeviceCodeResponse> RequestDeviceCodeAsync(
            CancellationToken cancellationToken = default)
        {
            var body = JsonCoding.Serialize(new DeviceCodeRequest { ClientPlatform = ClientPlatform });
            using var response = await PostAsync(DeviceCodePath, body, cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                throw new DeviceFlowException(
                    DeviceFlowException.ParseCode(JsonCoding.Deserialize<OAuthErrorBody>(payload)?.Error),
                    $"device code request failed with HTTP {(int)response.StatusCode}");
            }

            return JsonCoding.Deserialize<DeviceCodeResponse>(payload)
                ?? throw new DeviceFlowException(
                    DeviceFlowErrorCode.Other,
                    "the server returned an unreadable device code response");
        }

        /// <summary>
        /// RFC 8628 §3.4/§3.5: poll until the viewer approves, the code
        /// expires, or access is denied.
        /// </summary>
        /// <remarks>
        /// Honours <c>slow_down</c> by adding 5 seconds to the poll interval,
        /// per §3.5. <paramref name="delay"/> is injectable so tests can run
        /// the loop without real waiting.
        /// </remarks>
        public async Task<TokenResponse> PollForTokenAsync(
            string deviceCode,
            TimeSpan interval,
            TimeSpan expiresIn,
            Func<TimeSpan, CancellationToken, Task>? delay = null,
            Func<DateTimeOffset>? clock = null,
            CancellationToken cancellationToken = default)
        {
            var now = clock ?? (() => DateTimeOffset.UtcNow);
            var wait = delay ?? ((duration, token) => Task.Delay(duration, token));

            var deadline = now().Add(expiresIn);
            var currentInterval = interval < TimeSpan.FromSeconds(1)
                ? TimeSpan.FromSeconds(1)
                : interval;

            while (true)
            {
                if (now() >= deadline)
                {
                    throw new DeviceFlowException(
                        DeviceFlowErrorCode.ExpiredToken,
                        "device authorization expired before it was approved");
                }

                await wait(currentInterval, cancellationToken).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();

                try
                {
                    return await RequestTokenAsync(deviceCode, cancellationToken).ConfigureAwait(false);
                }
                catch (DeviceFlowException error)
                {
                    switch (error.Code)
                    {
                        case DeviceFlowErrorCode.AuthorizationPending:
                            continue;
                        case DeviceFlowErrorCode.SlowDown:
                            currentInterval += TimeSpan.FromSeconds(5);
                            continue;
                        default:
                            // Not a transient polling state -- either the
                            // viewer declined, the code died, or this client
                            // is asking for something the server won't do.
                            // Surface it rather than spinning forever.
                            throw;
                    }
                }
            }
        }

        private async Task<TokenResponse> RequestTokenAsync(
            string deviceCode,
            CancellationToken cancellationToken)
        {
            var body = JsonCoding.Serialize(new DeviceTokenRequest { DeviceCode = deviceCode });
            using var response = await PostAsync(TokenPath, body, cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return JsonCoding.Deserialize<TokenResponse>(payload)
                    ?? throw new DeviceFlowException(
                        DeviceFlowErrorCode.Other,
                        "the server returned an unreadable token response");
            }

            // §3.5: a non-200 poll response is always {"error": "<code>"},
            // not the {"error", "message"} shape the rest of the API uses.
            var oauthError = JsonCoding.Deserialize<OAuthErrorBody>(payload);
            throw new DeviceFlowException(
                DeviceFlowException.ParseCode(oauthError?.Error),
                $"token poll returned HTTP {(int)response.StatusCode}");
        }

        private Task<HttpResponseMessage> PostAsync(
            string path,
            string json,
            CancellationToken cancellationToken)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, BuildUri(path))
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            request.Headers.TryAddWithoutValidation("Accept", "application/json");

            return _http.SendAsync(request, cancellationToken);
        }

        /// <summary>
        /// Appends to the base URL's path rather than replacing it, so a
        /// server hosted behind a reverse-proxy prefix keeps working.
        /// </summary>
        private Uri BuildUri(string path)
        {
            var builder = new UriBuilder(BaseUrl);
            builder.Path = builder.Path.TrimEnd('/') + path;
            return builder.Uri;
        }
    }
}
