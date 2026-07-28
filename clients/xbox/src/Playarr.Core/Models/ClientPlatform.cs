using System;

namespace Playarr.Core.Models
{
    /// <summary>
    /// Hand-written mirror of <c>playarr_model::ClientPlatform</c>
    /// (<c>backend/crates/playarr-model/src/platform.rs</c>), matching the
    /// Kotlin mirror in the Android client and the Swift mirror in
    /// PlayarrKit.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The wire values are kebab-case, produced on the server by a
    /// container-level <c>#[serde(rename_all = "kebab-case")]</c>. They are
    /// spelled out explicitly in <see cref="ClientPlatformExtensions"/>
    /// rather than derived from the C# names, because the two conventions
    /// disagree on brand capitalisation: the Rust variant is
    /// <c>TvWebos</c> (so that it kebab-cases to <c>tv-webos</c> rather than
    /// <c>tv-web-o-s</c>) while the natural C# spelling is
    /// <c>TvWebOS</c>.
    /// </para>
    /// <para>
    /// <c>playarr-admin</c> is deliberately absent, matching the Kotlin
    /// and Swift mirrors: it identifies Playarr's own admin UI, which no
    /// Playarr client ever claims to be.
    /// </para>
    /// </remarks>
    public enum ClientPlatform
    {
        AndroidMobile,
        AndroidTv,
        Ios,
        Web,
        TvWebOS,
        TvTizen,
        TvVidaa,

        /// <summary>
        /// This client. Sent in the <c>X-Playarr-Client-Platform</c>
        /// header on every request and as
        /// <c>DeviceCodeRequest.client_platform</c> when pairing.
        /// </summary>
        Xbox,
    }

    public static class ClientPlatformExtensions
    {
        /// <summary>
        /// The wire value for this platform, e.g. <c>"xbox"</c>. Mirrors
        /// <c>ClientPlatform::wire_name</c> on the backend.
        /// </summary>
        public static string WireName(this ClientPlatform platform)
        {
            switch (platform)
            {
                case ClientPlatform.AndroidMobile: return "android-mobile";
                case ClientPlatform.AndroidTv: return "android-tv";
                case ClientPlatform.Ios: return "ios";
                case ClientPlatform.Web: return "web";
                case ClientPlatform.TvWebOS: return "tv-webos";
                case ClientPlatform.TvTizen: return "tv-tizen";
                case ClientPlatform.TvVidaa: return "tv-vidaa";
                case ClientPlatform.Xbox: return "xbox";
                default:
                    throw new ArgumentOutOfRangeException(
                        nameof(platform),
                        platform,
                        "unknown ClientPlatform -- add its wire name here and to the backend enum");
            }
        }

        /// <summary>
        /// Parses a wire value back into a <see cref="ClientPlatform"/>, or
        /// returns <c>null</c> for a value this build does not know.
        /// </summary>
        /// <remarks>
        /// Returning <c>null</c> rather than throwing is deliberate and is
        /// the one place this mirror improves on the Kotlin and Swift ones.
        /// Those throw on an unrecognised value, so a server that learns a
        /// new platform hard-breaks decoding of any envelope mentioning it.
        /// Callers here can treat an unknown platform as "some other
        /// client", which is always a safe reading.
        /// </remarks>
        public static ClientPlatform? FromWireName(string? name)
        {
            switch (name)
            {
                case "android-mobile": return ClientPlatform.AndroidMobile;
                case "android-tv": return ClientPlatform.AndroidTv;
                case "ios": return ClientPlatform.Ios;
                case "web": return ClientPlatform.Web;
                case "tv-webos": return ClientPlatform.TvWebOS;
                case "tv-tizen": return ClientPlatform.TvTizen;
                case "tv-vidaa": return ClientPlatform.TvVidaa;
                case "xbox": return ClientPlatform.Xbox;
                default: return null;
            }
        }
    }
}
