using System;
using System.Collections.Generic;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using Playarr.Core.Networking;

namespace Playarr.Core.Models
{
    /// <summary>
    /// How the server decided this file should be delivered.
    /// </summary>
    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum PlaybackMode
    {
        Unknown = 0,

        /// <summary>
        /// The original file, served as-is. The Xbox media pipeline demuxes
        /// MP4 and Matroska natively, so this is the common case for a
        /// well-stocked library -- see <c>XboxPlaybackProfile</c>.
        /// </summary>
        [EnumMember(Value = "direct")] Direct,

        /// <summary>
        /// An on-demand HLS transcode. The server emits MPEG-TS segments
        /// (<c>segment_%05d.ts</c>), not fMP4, which matters here: a TS
        /// playlist carries no <c>EXT-X-MAP</c> tag, and
        /// <c>AdaptiveMediaSource</c> -- the UWP adaptive-streaming API this
        /// client plays through -- does not implement <c>EXT-X-MAP</c>. The
        /// server's existing output is therefore directly consumable, with
        /// no TS-versus-fMP4 negotiation needed on either side.
        /// </summary>
        [EnumMember(Value = "hls")] Hls,
    }

    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum WatchState
    {
        Unknown = 0,

        [EnumMember(Value = "unwatched")] Unwatched,
        [EnumMember(Value = "in_progress")] InProgress,
        [EnumMember(Value = "watched")] Watched,
    }

    public sealed class PlaybackTrackOption
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        [JsonProperty("label")] public string? Label { get; set; }

        [JsonProperty("language")] public string? Language { get; set; }
    }

    public sealed class PlaybackQualityOption
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        [JsonProperty("label")] public string? Label { get; set; }

        [JsonProperty("height")] public int? Height { get; set; }

        [JsonProperty("bitrate_bps")] public long? BitrateBps { get; set; }
    }

    /// <summary>
    /// The negotiated result of <c>GET /api/v1/playback/{media_file_id}</c>:
    /// where to play from, and what the viewer can switch between.
    /// </summary>
    public sealed class PlaybackInfoResponse
    {
        [JsonProperty("mode")] public PlaybackMode Mode { get; set; }

        /// <summary>
        /// Possibly server-relative -- resolve it through
        /// <c>IPlayarrApiClient.ResolveUrl</c> before handing it to a
        /// media element.
        /// </summary>
        [JsonProperty("url")] public string Url { get; set; } = string.Empty;

        [JsonProperty("audio_tracks")] public IList<PlaybackTrackOption> AudioTracks { get; set; } =
            new List<PlaybackTrackOption>();

        [JsonProperty("subtitle_tracks")] public IList<PlaybackTrackOption> SubtitleTracks { get; set; } =
            new List<PlaybackTrackOption>();

        [JsonProperty("quality_options")] public IList<PlaybackQualityOption> QualityOptions { get; set; } =
            new List<PlaybackQualityOption>();

        [JsonProperty("duration_ms")] public long DurationMs { get; set; }

        [JsonProperty("mime_type")] public string MimeType { get; set; } = string.Empty;

        [JsonProperty("selected_audio_track_id")] public string? SelectedAudioTrackId { get; set; }

        [JsonProperty("selected_quality_id")] public string SelectedQualityId { get; set; } = "original";

        [JsonProperty("selected_subtitle_track_id")] public string? SelectedSubtitleTrackId { get; set; }

        /// <summary>
        /// Present when the server opened a transcode session. Playback
        /// events are reported against it.
        /// </summary>
        [JsonProperty("session_id")] public Guid? SessionId { get; set; }

        /// <summary>
        /// How far into the source the returned stream actually starts. A
        /// seek-ahead transcode begins at a non-zero offset, so the player
        /// has to add this to its own position to report a true source
        /// position back.
        /// </summary>
        [JsonProperty("source_offset_ms")] public long SourceOffsetMs { get; set; }
    }

    public sealed class WatchProgress
    {
        [JsonProperty("media_file_id")] public Guid MediaFileId { get; set; }

        [JsonProperty("work_id")] public Guid WorkId { get; set; }

        [JsonProperty("position_ms")] public long PositionMs { get; set; }

        [JsonProperty("duration_ms")] public long DurationMs { get; set; }

        [JsonProperty("state")] public WatchState State { get; set; }

        [JsonProperty("updated_at")] public DateTimeOffset? UpdatedAt { get; set; }

        /// <summary>
        /// Fraction watched in <c>0.0..1.0</c>, or <c>0</c> when the duration
        /// is unknown. Used to draw the resume bar on a tile.
        /// </summary>
        public double Fraction =>
            DurationMs <= 0 ? 0 : Math.Min(1.0, (double)PositionMs / DurationMs);
    }

    public sealed class UpdateWatchProgressRequest
    {
        [JsonProperty("position_ms")] public long PositionMs { get; set; }

        [JsonProperty("duration_ms")] public long DurationMs { get; set; }
    }
}
