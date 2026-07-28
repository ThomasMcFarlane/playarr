using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Playarr.Core.Models
{
    /// <summary>
    /// The generic error body every non-OAuth endpoint returns on failure:
    /// <c>{"error": "&lt;code&gt;", "message": "&lt;...&gt;"}</c>.
    /// </summary>
    public sealed class ApiErrorBody
    {
        [JsonProperty("error")] public string Error { get; set; } = string.Empty;

        [JsonProperty("message")] public string Message { get; set; } = string.Empty;
    }

    /// <summary>
    /// One peer node's client-reachable address.
    /// </summary>
    public sealed class PeerAddressEntry
    {
        [JsonProperty("peer_node_id")] public Guid PeerNodeId { get; set; }

        [JsonProperty("url")] public string Url { get; set; } = string.Empty;
    }

    /// <summary>
    /// The server's self-healing address book, attached to login and refresh
    /// responses so a client picks up added or removed peers without a
    /// separate round trip. See <c>docs/architecture/peer-groups.md</c> §7.1.
    /// </summary>
    /// <remarks>
    /// <see cref="Addresses"/> is always the server's full, fresh,
    /// priority-ordered member list -- so a client folds it in wholesale
    /// rather than merging entry by entry. Absent for a standalone node that
    /// has never founded or joined a group.
    /// </remarks>
    public sealed class PeerAddressBundle
    {
        [JsonProperty("group_id")] public Guid? GroupId { get; set; }

        [JsonProperty("group_name")] public string? GroupName { get; set; }

        [JsonProperty("addresses")] public IList<PeerAddressEntry> Addresses { get; set; } =
            new List<PeerAddressEntry>();
    }

    public sealed class LoginRequest
    {
        /// <summary>
        /// Client-generated and stable per install. The same value must be
        /// resent on every subsequent login and refresh from this
        /// installation -- a fresh GUID per launch would register a new
        /// device row every time the app starts.
        /// </summary>
        [JsonProperty("device_id")] public Guid DeviceId { get; set; }

        [JsonProperty("device_name")] public string DeviceName { get; set; } = string.Empty;

        [JsonProperty("client_platform")] public ClientPlatform ClientPlatform { get; set; } = ClientPlatform.Xbox;

        [JsonProperty("client_version")] public string ClientVersion { get; set; } = string.Empty;

        [JsonProperty("password")] public string? Password { get; set; }

        [JsonProperty("pin")] public string? Pin { get; set; }

        /// <summary>Managed-profiles deployments only; ignored elsewhere.</summary>
        [JsonProperty("profile_user_id")] public Guid? ProfileUserId { get; set; }

        /// <summary>Full-account deployments only; ignored elsewhere.</summary>
        [JsonProperty("username")] public string? Username { get; set; }
    }

    public sealed class LoginResponse
    {
        [JsonProperty("access_token")] public string AccessToken { get; set; } = string.Empty;

        [JsonProperty("refresh_token")] public string RefreshToken { get; set; } = string.Empty;

        [JsonProperty("token_type")] public string TokenType { get; set; } = "Bearer";

        [JsonProperty("expires_in")] public long ExpiresIn { get; set; }

        [JsonProperty("user_id")] public Guid UserId { get; set; }

        [JsonProperty("peer_addresses")] public PeerAddressBundle? PeerAddresses { get; set; }
    }

    public sealed class RefreshRequest
    {
        [JsonProperty("device_id")] public Guid DeviceId { get; set; }

        [JsonProperty("refresh_token")] public string RefreshToken { get; set; } = string.Empty;
    }

    public sealed class RefreshResponse
    {
        [JsonProperty("access_token")] public string AccessToken { get; set; } = string.Empty;

        [JsonProperty("refresh_token")] public string RefreshToken { get; set; } = string.Empty;

        [JsonProperty("token_type")] public string TokenType { get; set; } = "Bearer";

        [JsonProperty("expires_in")] public long ExpiresIn { get; set; }

        [JsonProperty("user_id")] public Guid UserId { get; set; }

        [JsonProperty("peer_addresses")] public PeerAddressBundle? PeerAddresses { get; set; }
    }

    public sealed class DeviceCodeRequest
    {
        [JsonProperty("client_platform")] public ClientPlatform ClientPlatform { get; set; } = ClientPlatform.Xbox;
    }

    public sealed class DeviceCodeResponse
    {
        [JsonProperty("device_code")] public string DeviceCode { get; set; } = string.Empty;

        /// <summary>The short code the viewer types on their phone or laptop.</summary>
        [JsonProperty("user_code")] public string UserCode { get; set; } = string.Empty;

        [JsonProperty("verification_uri")] public string VerificationUri { get; set; } = string.Empty;

        /// <summary>Verification URI with the code embedded -- what the QR encodes.</summary>
        [JsonProperty("verification_uri_complete")] public string VerificationUriComplete { get; set; } = string.Empty;

        [JsonProperty("expires_in")] public long ExpiresIn { get; set; }

        /// <summary>Seconds to wait between polls, per RFC 8628 §3.5.</summary>
        [JsonProperty("interval")] public long Interval { get; set; }
    }

    public sealed class DeviceTokenRequest
    {
        /// <summary>
        /// The RFC 8628 §3.4 device-code grant type URN -- the only value the
        /// server accepts for <c>grant_type</c>.
        /// </summary>
        public const string DeviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code";

        [JsonProperty("device_code")] public string DeviceCode { get; set; } = string.Empty;

        [JsonProperty("grant_type")] public string GrantType { get; set; } = DeviceCodeGrantType;
    }

    public sealed class TokenResponse
    {
        [JsonProperty("access_token")] public string AccessToken { get; set; } = string.Empty;

        [JsonProperty("token_type")] public string TokenType { get; set; } = "Bearer";

        [JsonProperty("expires_in")] public long ExpiresIn { get; set; }

        [JsonProperty("refresh_token")] public string RefreshToken { get; set; } = string.Empty;
    }

    /// <summary>
    /// RFC 8628 §3.5's error shape -- <c>{"error": "&lt;code&gt;"}</c> only,
    /// deliberately narrower than <see cref="ApiErrorBody"/>.
    /// </summary>
    public sealed class OAuthErrorBody
    {
        [JsonProperty("error")] public string Error { get; set; } = string.Empty;
    }

    /// <summary>
    /// A persisted session. Written after login, device pairing, or a
    /// refresh-token rotation.
    /// </summary>
    public sealed class StoredAuthSession
    {
        [JsonProperty("access_token")] public Sensitive<string> AccessToken { get; set; }

        [JsonProperty("refresh_token")] public Sensitive<string> RefreshToken { get; set; }

        [JsonProperty("token_type")] public string TokenType { get; set; } = "Bearer";

        [JsonProperty("expires_at")] public DateTimeOffset ExpiresAt { get; set; }

        public StoredAuthSession()
        {
            AccessToken = new Sensitive<string>(string.Empty);
            RefreshToken = new Sensitive<string>(string.Empty);
        }

        public StoredAuthSession(
            string accessToken,
            string refreshToken,
            string tokenType,
            DateTimeOffset expiresAt)
        {
            AccessToken = new Sensitive<string>(accessToken);
            RefreshToken = new Sensitive<string>(refreshToken);
            TokenType = tokenType;
            ExpiresAt = expiresAt;
        }
    }
}
