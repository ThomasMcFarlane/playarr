using System;
using System.Collections.Generic;
using System.Linq;

namespace Playarr.Core.Playback
{
    /// <summary>
    /// The console generation this client is running on. Supplied by the
    /// application head (which reads it from
    /// <c>Windows.System.Profile.GamingDeviceInformation</c>); this assembly
    /// stays free of any <c>Windows.*</c> reference, so the model arrives as
    /// plain data and the whole profile stays unit-testable on Linux.
    /// </summary>
    public enum XboxModel
    {
        /// <summary>
        /// Model could not be determined. Resolves to the most conservative
        /// profile -- see <see cref="XboxPlaybackProfile.ForModel"/>.
        /// </summary>
        Unknown,

        /// <summary>Original Xbox One (2013). No hardware HEVC decode.</summary>
        XboxOne,

        XboxOneS,
        XboxOneX,
        XboxSeriesS,
        XboxSeriesX,
    }

    /// <summary>
    /// What this Xbox can decode, expressed as the container/codec/bitrate
    /// declaration the server negotiates direct play against.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The backend deliberately has no per-platform capability table: see
    /// <c>playarr-transcode</c>'s <c>ClientCapabilities</c>, which notes
    /// that "real-world support varies per device/OS/app-version more than
    /// platform alone predicts". The client therefore declares its own
    /// support via the <c>containers</c>, <c>video_codecs</c>,
    /// <c>audio_codecs</c>, and <c>max_bitrate_bps</c> query parameters on
    /// <c>GET /api/v1/playback/{media_file_id}</c>. This type produces
    /// exactly those values. It is the Xbox equivalent of
    /// <c>clients/tv-web/web/src/lib/playbackCapabilities.ts</c>.
    /// </para>
    /// <para>
    /// <strong>These figures describe the app (Media Foundation) partition
    /// that a native UWP <c>MediaPlayerElement</c> uses -- not the Chromium
    /// runtime.</strong> The distinction is not academic: Xbox's web runtime
    /// reports HEVC as supported through
    /// <c>MediaSource.isTypeSupported</c> and then fails to decode it, has
    /// no Matroska demuxer at all, and reports AV1 as supported while
    /// decoding it in software. A native client sidesteps every one of those
    /// and is the reason this profile can be as wide as it is.
    /// </para>
    /// <para>
    /// Source: Microsoft's "supported technologies" table for apps on Xbox
    /// (<c>learn.microsoft.com/windows/uwp/apps-for-xbox/supported-technologies</c>).
    /// </para>
    /// </remarks>
    public sealed class XboxPlaybackProfile
    {
        /// <summary>
        /// Value passed as the <c>profile</c> query parameter, so server-side
        /// logs and session records attribute a decision to this client.
        /// </summary>
        public const string ProfileName = "xbox";

        /// <summary>
        /// Every Xbox caps video playback at 60 fps. 4K120 media playback is
        /// explicitly unsupported even on Series X, whose 120 Hz output modes
        /// apply to games rather than to the media pipeline.
        /// </summary>
        public const int MaxFrameRate = 60;

        private XboxPlaybackProfile(
            XboxModel model,
            IReadOnlyList<string> containers,
            IReadOnlyList<string> videoCodecs,
            IReadOnlyList<string> audioCodecs,
            int maxHeight,
            long maxBitrateBps)
        {
            Model = model;
            Containers = containers;
            VideoCodecs = videoCodecs;
            AudioCodecs = audioCodecs;
            MaxHeight = maxHeight;
            MaxBitrateBps = maxBitrateBps;
        }

        public XboxModel Model { get; }

        public IReadOnlyList<string> Containers { get; }

        public IReadOnlyList<string> VideoCodecs { get; }

        public IReadOnlyList<string> AudioCodecs { get; }

        /// <summary>Tallest picture this console decodes in hardware.</summary>
        public int MaxHeight { get; }

        public long MaxBitrateBps { get; }

        /// <summary>
        /// Containers the native media pipeline demuxes. MKV is included
        /// deliberately -- Xbox media apps handle Matroska natively, which is
        /// the single largest direct-play win a native client has over the
        /// web client on the same hardware.
        /// </summary>
        private static readonly string[] BaseContainers =
        {
            "mp4", "m4v", "mov", "mkv", "ts", "m4a", "mp3", "flac", "wav",
        };

        /// <summary>
        /// Audio the app partition decodes. Dolby Atmos and DTS:X reach a
        /// receiver by bitstream pass-through rather than app-side decoding,
        /// and have been free to third-party apps since the May 2021 system
        /// update -- so they need no entry here, only the console's
        /// "allow pass-through" setting.
        /// </summary>
        private static readonly string[] BaseAudioCodecs =
        {
            "aac", "ac3", "eac3", "mp3", "mp2", "alac", "flac", "wmav2", "pcm_s16le",
        };

        /// <summary>
        /// Builds the capability declaration for a console model.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Three model-dependent facts drive the differences:
        /// </para>
        /// <list type="bullet">
        /// <item><description>
        /// <strong>H.264 is capped at 1080p60 High on every console</strong>,
        /// including Series X. No Xbox direct-plays 4K H.264 in an app; 4K
        /// has to arrive as HEVC or VP9. This is the most commonly
        /// mis-stated fact about Xbox playback.
        /// </description></item>
        /// <item><description>
        /// <strong>HEVC (Main/Main10, up to 2160p60) is available on
        /// everything except the original Xbox One</strong>, which has no
        /// hardware HEVC decoder at all.
        /// </description></item>
        /// <item><description>
        /// <strong>VP9 Profile 2 (up to 2160p60) is limited to One X, Series
        /// S and Series X.</strong>
        /// </description></item>
        /// </list>
        /// <para>
        /// <strong>AV1 is absent from every profile.</strong> No Xbox has
        /// AV1 hardware decode -- not even Series X. Some third-party
        /// specification listings claim otherwise; they are wrong, and
        /// advertising AV1 here would trade a clean server-side transcode for
        /// a software-decode stutter.
        /// </para>
        /// <para>
        /// <see cref="XboxModel.Unknown"/> resolves to the original Xbox One
        /// profile. Under-declaring costs a needless transcode;
        /// over-declaring produces a direct play that fails at the decoder,
        /// which is far worse to diagnose from a sofa.
        /// </para>
        /// </remarks>
        public static XboxPlaybackProfile ForModel(XboxModel model)
        {
            var videoCodecs = new List<string> { "h264" };
            var maxHeight = 1080;

            if (model != XboxModel.XboxOne && model != XboxModel.Unknown)
            {
                videoCodecs.Add("hevc");
                maxHeight = 2160;
            }

            if (model == XboxModel.XboxOneX ||
                model == XboxModel.XboxSeriesS ||
                model == XboxModel.XboxSeriesX)
            {
                videoCodecs.Add("vp9");
            }

            return new XboxPlaybackProfile(
                model,
                BaseContainers,
                videoCodecs,
                BaseAudioCodecs,
                maxHeight,
                MaxBitrateBpsForModel(model));
        }

        /// <summary>
        /// Ceiling advertised to the server.
        /// </summary>
        /// <remarks>
        /// Microsoft documents no hard playback bitrate limit for the app
        /// partition, so this is a deliberate choice rather than a reported
        /// capability: high enough that a remux on a wired LAN direct-plays,
        /// low enough that a pathological source still gets transcoded rather
        /// than starving the ~1 GB app memory budget. The cautionary tale is
        /// Jellyfin's Xbox client, which inherited an unexplained 12 Mbps cap
        /// that silently forced every 4K remux through a transcode for years.
        /// If this value ever needs to change, change it here with a reason.
        /// </remarks>
        private static long MaxBitrateBpsForModel(XboxModel model)
        {
            switch (model)
            {
                case XboxModel.XboxOne:
                case XboxModel.Unknown:
                    return 20_000_000L;
                case XboxModel.XboxOneS:
                    return 40_000_000L;
                default:
                    return 120_000_000L;
            }
        }

        /// <summary>
        /// The capability query parameters for
        /// <c>GET /api/v1/playback/{media_file_id}</c>, in the comma-joined
        /// shape the endpoint expects.
        /// </summary>
        public IReadOnlyDictionary<string, string> ToQueryParameters() =>
            new Dictionary<string, string>
            {
                ["containers"] = string.Join(",", Containers),
                ["video_codecs"] = string.Join(",", VideoCodecs),
                ["audio_codecs"] = string.Join(",", AudioCodecs),
                ["max_bitrate_bps"] = MaxBitrateBps.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["profile"] = ProfileName,
            };

        public bool SupportsVideoCodec(string codec) =>
            VideoCodecs.Contains(codec, StringComparer.OrdinalIgnoreCase);

        public bool SupportsContainer(string container) =>
            Containers.Contains(container, StringComparer.OrdinalIgnoreCase);
    }
}
