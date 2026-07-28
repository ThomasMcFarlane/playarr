using System;
using System.Text;
using Newtonsoft.Json.Linq;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// Reads claims out of a JWT access token's payload segment
    /// <em>without verifying the signature</em>. Port of
    /// <c>JWTClaims</c> in the iOS client's PlayarrKit.
    /// </summary>
    /// <remarks>
    /// This client already trusts the token, because it was just handed it
    /// over HTTPS by the server it is talking to (via
    /// <c>POST /api/v1/auth/login</c> or the RFC 8628 device flow). These
    /// helpers only read back an identifier the client itself was just
    /// given -- they are a routing hint, never an authorization decision.
    /// Never use them to <em>trust</em> a token originating anywhere else.
    /// </remarks>
    public static class JwtClaims
    {
        /// <summary>
        /// The token's <c>sub</c> claim as a <see cref="Guid"/>, or
        /// <c>null</c> if the token is not a well-formed three-segment JWT,
        /// its payload is not valid base64url JSON, or <c>sub</c> is absent
        /// or not a GUID. Callers should treat any of those as "unknown".
        /// </summary>
        public static Guid? Subject(string? accessToken) => ClaimAsGuid(accessToken, "sub");

        /// <summary>
        /// The token's <c>iss</c> claim as a <see cref="Guid"/> -- the peer
        /// node that minted this access token.
        /// </summary>
        /// <remarks>
        /// Per <c>docs/architecture/peer-groups.md</c> §5.4, a grouped node
        /// signs tokens with <c>iss</c> set to its own peer id, while a
        /// standalone node uses its configured HS256 issuer string (e.g.
        /// <c>"playarr"</c>) -- which does not parse as a GUID and so
        /// correctly yields <c>null</c> here. <c>null</c> also covers a
        /// malformed token. Used by
        /// <c>KnownServerGroup.SameNodeAddresses</c> to decide which
        /// remembered addresses belong to this session's own node.
        /// </remarks>
        public static Guid? IssuerPeerId(string? accessToken) => ClaimAsGuid(accessToken, "iss");

        private static Guid? ClaimAsGuid(string? token, string claim)
        {
            if (string.IsNullOrEmpty(token))
            {
                return null;
            }

            var segments = token!.Split('.');
            if (segments.Length != 3)
            {
                return null;
            }

            var payload = Base64UrlDecode(segments[1]);
            if (payload is null)
            {
                return null;
            }

            try
            {
                var value = JObject.Parse(payload).Value<string>(claim);
                return Guid.TryParse(value, out var parsed) ? parsed : (Guid?)null;
            }
            catch (Exception)
            {
                // A payload that is not valid JSON is "unknown", not fatal.
                return null;
            }
        }

        private static string? Base64UrlDecode(string value)
        {
            var normalised = value.Replace('-', '+').Replace('_', '/');
            switch (normalised.Length % 4)
            {
                case 2:
                    normalised += "==";
                    break;
                case 3:
                    normalised += "=";
                    break;
                case 1:
                    // Not a valid base64 length under any padding.
                    return null;
            }

            try
            {
                return Encoding.UTF8.GetString(Convert.FromBase64String(normalised));
            }
            catch (FormatException)
            {
                return null;
            }
        }
    }
}
