using System;
using System.Collections.Generic;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using Playarr.Core.Networking;

namespace Playarr.Core.Models
{
    /// <summary>
    /// What kind of thing a <see cref="Work"/> is. Mirrors
    /// <c>playarr_model::WorkKind</c>.
    /// </summary>
    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum WorkKind
    {
        /// <summary>A kind this build does not know. See <see cref="TolerantEnumConverter"/>.</summary>
        Unknown = 0,

        [EnumMember(Value = "movie")] Movie,
        [EnumMember(Value = "series")] Series,
        [EnumMember(Value = "site")] Site,
        [EnumMember(Value = "artist")] Artist,
        [EnumMember(Value = "author")] Author,
    }

    /// <summary>How much of a work has actually landed on disk.</summary>
    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum Availability
    {
        [EnumMember(Value = "unknown")] Unknown = 0,
        [EnumMember(Value = "pending")] Pending,
        [EnumMember(Value = "processing")] Processing,
        [EnumMember(Value = "partially_available")] PartiallyAvailable,
        [EnumMember(Value = "available")] Available,
        [EnumMember(Value = "deleted")] Deleted,
    }

    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum ImageKind
    {
        Unknown = 0,

        [EnumMember(Value = "poster")] Poster,
        [EnumMember(Value = "backdrop")] Backdrop,
        [EnumMember(Value = "banner")] Banner,
        [EnumMember(Value = "logo")] Logo,
        [EnumMember(Value = "thumb")] Thumb,
    }

    public sealed class ImageAsset
    {
        [JsonProperty("kind")] public ImageKind Kind { get; set; }

        [JsonProperty("url")] public string Url { get; set; } = string.Empty;

        [JsonProperty("width")] public int? Width { get; set; }

        [JsonProperty("height")] public int? Height { get; set; }
    }

    /// <summary>
    /// An identifier for this work at an external metadata provider.
    /// </summary>
    /// <remarks>
    /// The server models the provider as an externally-tagged Rust enum, so
    /// a first-class provider arrives as a bare string (<c>"tmdb"</c>) while
    /// anything else arrives as <c>{"other": "anidb"}</c>. Both shapes are
    /// flattened here into a single <see cref="Provider"/> string, because no
    /// screen in this client branches on the provider -- it only ever
    /// displays or forwards it.
    /// </remarks>
    [JsonConverter(typeof(ExternalRefConverter))]
    public sealed class ExternalRef
    {
        public string Provider { get; set; } = string.Empty;

        public string ExternalId { get; set; } = string.Empty;
    }

    internal sealed class ExternalRefConverter : JsonConverter
    {
        public override bool CanConvert(Type objectType) => objectType == typeof(ExternalRef);

        public override object? ReadJson(
            JsonReader reader,
            Type objectType,
            object? existingValue,
            JsonSerializer serializer)
        {
            var token = Newtonsoft.Json.Linq.JObject.Load(reader);
            var provider = token["provider"];

            return new ExternalRef
            {
                // A bare string for a known provider; {"other": "..."} otherwise.
                Provider = provider?.Type == Newtonsoft.Json.Linq.JTokenType.Object
                    ? provider["other"]?.ToObject<string>() ?? string.Empty
                    : provider?.ToObject<string>() ?? string.Empty,
                ExternalId = token["external_id"]?.ToObject<string>() ?? string.Empty,
            };
        }

        public override void WriteJson(JsonWriter writer, object? value, JsonSerializer serializer)
        {
            if (value is not ExternalRef reference)
            {
                writer.WriteNull();
                return;
            }

            writer.WriteStartObject();
            writer.WritePropertyName("provider");
            writer.WriteValue(reference.Provider);
            writer.WritePropertyName("external_id");
            writer.WriteValue(reference.ExternalId);
            writer.WriteEndObject();
        }
    }

    /// <summary>
    /// One catalog entry -- a film, a series, an artist, an author, a site.
    /// Mirrors <c>playarr_model::Work</c>.
    /// </summary>
    public sealed class Work
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("kind")] public WorkKind Kind { get; set; }

        [JsonProperty("external_refs")] public IList<ExternalRef> ExternalRefs { get; set; } = new List<ExternalRef>();

        [JsonProperty("title")] public string Title { get; set; } = string.Empty;

        [JsonProperty("sort_title")] public string SortTitle { get; set; } = string.Empty;

        [JsonProperty("overview")] public string? Overview { get; set; }

        [JsonProperty("images")] public IList<ImageAsset> Images { get; set; } = new List<ImageAsset>();

        [JsonProperty("genres")] public IList<string> Genres { get; set; } = new List<string>();

        [JsonProperty("tags")] public IList<string> Tags { get; set; } = new List<string>();

        [JsonProperty("added_at")] public DateTimeOffset AddedAt { get; set; }

        [JsonProperty("monitored")] public bool Monitored { get; set; }

        [JsonProperty("availability")] public Availability Availability { get; set; }

        /// <summary>ISO release date; the only source of a title's year (never <see cref="AddedAt"/>).</summary>
        [JsonProperty("release_date")] public string? ReleaseDate { get; set; }

        /// <summary>ISO date a series ended; set by the server only once the source reports it ended.</summary>
        [JsonProperty("end_date")] public string? EndDate { get; set; }

        /// <summary>
        /// The best artwork of <paramref name="kind"/>, or <c>null</c>. A
        /// convenience for the tile and detail views, which both want "the
        /// poster" without caring that the server returns a list.
        /// </summary>
        public ImageAsset? Image(ImageKind kind)
        {
            foreach (var image in Images)
            {
                if (image.Kind == kind)
                {
                    return image;
                }
            }

            return null;
        }
    }

    public sealed class CatalogPage
    {
        [JsonProperty("items")] public IList<Work> Items { get; set; } = new List<Work>();

        [JsonProperty("total")] public long? Total { get; set; }
    }

    public sealed class Season
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("series_work_id")] public Guid SeriesWorkId { get; set; }

        [JsonProperty("season_number")] public int SeasonNumber { get; set; }

        [JsonProperty("title")] public string? Title { get; set; }

        [JsonProperty("overview")] public string? Overview { get; set; }

        [JsonProperty("monitored")] public bool Monitored { get; set; }

        [JsonProperty("availability")] public Availability Availability { get; set; }
    }

    public sealed class Episode
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("season_id")] public Guid SeasonId { get; set; }

        [JsonProperty("episode_number")] public int EpisodeNumber { get; set; }

        [JsonProperty("title")] public string? Title { get; set; }

        [JsonProperty("overview")] public string? Overview { get; set; }

        [JsonProperty("air_date")] public string? AirDate { get; set; }

        [JsonProperty("runtime_minutes")] public int? RuntimeMinutes { get; set; }

        [JsonProperty("images")] public IList<ImageAsset> Images { get; set; } = new List<ImageAsset>();

        [JsonProperty("monitored")] public bool Monitored { get; set; }

        [JsonProperty("availability")] public Availability Availability { get; set; }
    }

    /// <summary>
    /// An episode plus the media file that actually plays it.
    /// <see cref="MediaFileId"/> is <c>null</c> until a file has synced.
    /// </summary>
    public sealed class EpisodeDetail
    {
        [JsonProperty("episode")] public Episode Episode { get; set; } = new Episode();

        [JsonProperty("media_file_id")] public Guid? MediaFileId { get; set; }

        [JsonProperty("runtime_ms")] public long? RuntimeMs { get; set; }
    }

    public sealed class SeasonDetail
    {
        [JsonProperty("season")] public Season Season { get; set; } = new Season();

        [JsonProperty("episodes")] public IList<EpisodeDetail> Episodes { get; set; } = new List<EpisodeDetail>();
    }

    /// <summary>
    /// A work's playable children, discriminated by the parent's kind.
    /// </summary>
    /// <remarks>
    /// The server serialises this as an externally-tagged Rust enum: the
    /// bare string <c>"Movie"</c> for a film (whose playable leaf is the
    /// work itself, via <see cref="WorkDetail.MediaFileId"/>), or a
    /// single-key object such as <c>{"Series": [...]}</c> otherwise. This
    /// client only renders series children today, so album and book payloads
    /// are recognised and counted but not modelled in detail.
    /// </remarks>
    [JsonConverter(typeof(WorkChildrenConverter))]
    public sealed class WorkChildren
    {
        public WorkKind ParentKind { get; set; } = WorkKind.Movie;

        public IList<SeasonDetail> Seasons { get; set; } = new List<SeasonDetail>();
    }

    internal sealed class WorkChildrenConverter : JsonConverter
    {
        public override bool CanConvert(Type objectType) => objectType == typeof(WorkChildren);

        public override object? ReadJson(
            JsonReader reader,
            Type objectType,
            object? existingValue,
            JsonSerializer serializer)
        {
            if (reader.TokenType == JsonToken.String)
            {
                // "Movie" -- no children; the work is its own playable leaf.
                return new WorkChildren { ParentKind = WorkKind.Movie };
            }

            var token = Newtonsoft.Json.Linq.JObject.Load(reader);

            if (token["Series"] is { } series)
            {
                return new WorkChildren
                {
                    ParentKind = WorkKind.Series,
                    Seasons = series.ToObject<List<SeasonDetail>>(serializer) ?? new List<SeasonDetail>(),
                };
            }

            if (token["Artist"] is not null)
            {
                return new WorkChildren { ParentKind = WorkKind.Artist };
            }

            if (token["Author"] is not null)
            {
                return new WorkChildren { ParentKind = WorkKind.Author };
            }

            return new WorkChildren { ParentKind = WorkKind.Unknown };
        }

        public override bool CanWrite => false;

        public override void WriteJson(JsonWriter writer, object? value, JsonSerializer serializer) =>
            throw new NotSupportedException("WorkChildren is response-only");
    }

    public sealed class WorkDetail
    {
        [JsonProperty("work")] public Work Work { get; set; } = new Work();

        [JsonProperty("children")] public WorkChildren Children { get; set; } = new WorkChildren();

        /// <summary>
        /// The playable leaf for a film. Always <c>null</c> for series,
        /// artist and author works -- their leaves are their children -- and
        /// <c>null</c> for a film too until a file has synced for it.
        /// </summary>
        [JsonProperty("media_file_id")] public Guid? MediaFileId { get; set; }

        [JsonProperty("runtime_ms")] public long? RuntimeMs { get; set; }

        /// <summary>
        /// Every playable file of the work with its runtime: the film itself, or each episode with a file. What the
        /// web's "Mark as Watched/Unwatched" updates (MediaContextMenu <c>playableLeaves</c>).
        /// </summary>
        public IList<(Guid MediaFileId, long RuntimeMs)> PlayableLeaves()
        {
            var leaves = new List<(Guid, long)>();
            if (MediaFileId is { } film)
            {
                leaves.Add((film, RuntimeMs ?? 0));
            }

            foreach (var season in Children.Seasons)
            {
                foreach (var episode in season.Episodes)
                {
                    if (episode.MediaFileId is { } file)
                    {
                        leaves.Add((file, episode.RuntimeMs ?? 0));
                    }
                }
            }

            return leaves;
        }
    }

    public sealed class AvailableProfile
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("username")] public string Username { get; set; } = string.Empty;

        [JsonProperty("display_name")] public string DisplayName { get; set; } = string.Empty;

        [JsonProperty("pin_locked")] public bool PinLocked { get; set; }

        [JsonProperty("is_current")] public bool IsCurrent { get; set; }
    }

    /// <summary>One server-computed Home rail (<c>GET /api/v1/home/rails</c>); empty rails are omitted, titles localised.</summary>
    public sealed class HomeRail
    {
        [JsonProperty("id")] public string Id { get; set; } = string.Empty;

        [JsonProperty("kind")] public string Kind { get; set; } = string.Empty;

        [JsonProperty("title")] public string Title { get; set; } = string.Empty;

        [JsonProperty("items")] public IList<Work> Items { get; set; } = new List<Work>();
    }

    public sealed class HomeRailsResponse
    {
        [JsonProperty("rails")] public IList<HomeRail> Rails { get; set; } = new List<HomeRail>();
    }

    /// <summary>Card captions, matching the web's <c>lib/workYear.ts</c>.</summary>
    public static class WorkLabels
    {
        /// <summary>"2011", or "2011–2019" for a series that ended in a later year; null without a release year.</summary>
        public static string? YearRange(Work work)
        {
            var start = YearOf(work.ReleaseDate);
            if (start == null)
            {
                return null;
            }

            var end = YearOf(work.EndDate);
            return end != null && end > start ? $"{start}\u2013{end}" : start.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>"Movie · 2019" or "Series · 2011–2019"; the bare kind label when no year is known.</summary>
        public static string KindWithYear(Work work)
        {
            var label = KindLabel(work.Kind);
            var years = YearRange(work);
            return years == null ? label : label.Length == 0 ? years : $"{label} \u00b7 {years}";
        }

        /// <summary>
        /// Library title order, as the web's <c>Intl.Collator(undefined, {numeric: true, sensitivity: "base"})</c> on
        /// <c>sort_title || title</c>: case-insensitive, digit runs compared as numbers ("2 …" before "10 …").
        /// </summary>
        public static int CompareTitles(Work a, Work b) =>
            NaturalCompare(
                string.IsNullOrEmpty(a.SortTitle) ? a.Title : a.SortTitle,
                string.IsNullOrEmpty(b.SortTitle) ? b.Title : b.SortTitle);

        public static int NaturalCompare(string x, string y)
        {
            int i = 0, j = 0;
            while (i < x.Length && j < y.Length)
            {
                if (char.IsDigit(x[i]) && char.IsDigit(y[j]))
                {
                    int si = i, sj = j;
                    while (i < x.Length && char.IsDigit(x[i])) i++;
                    while (j < y.Length && char.IsDigit(y[j])) j++;
                    var nx = x.Substring(si, i - si).TrimStart('0');
                    var ny = y.Substring(sj, j - sj).TrimStart('0');
                    var c = nx.Length != ny.Length ? nx.Length.CompareTo(ny.Length) : string.CompareOrdinal(nx, ny);
                    if (c != 0) return c;
                    continue;
                }

                var d = string.Compare(x[i].ToString(), y[j].ToString(), System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.CompareOptions.IgnoreCase | System.Globalization.CompareOptions.IgnoreNonSpace);
                if (d != 0) return d;
                i++; j++;
            }

            return (x.Length - i).CompareTo(y.Length - j);
        }

        /// <summary>Singular kind label ("Movie", "Series"); empty for kinds the web does not label.</summary>
        public static string KindLabel(WorkKind kind) => kind switch
        {
            WorkKind.Movie => "Movie",
            WorkKind.Series => "Series",
            WorkKind.Artist => "Artist",
            WorkKind.Author => "Author",
            _ => string.Empty,
        };

        private static int? YearOf(string? value)
        {
            if (string.IsNullOrEmpty(value)
                || !DateTimeOffset.TryParse(value, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal, out var date))
            {
                return null;
            }

            var year = date.UtcDateTime.Year;
            return year > 0 ? year : (int?)null;
        }
    }
}
