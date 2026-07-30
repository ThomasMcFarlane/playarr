using System;
using System.Collections.Generic;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using Playarr.Core.Networking;

namespace Playarr.Core.Models
{
    /// <summary>
    /// The two entry shapes returned by the path-safe folder browser.
    /// Unknown values remain renderable by older client builds.
    /// </summary>
    [JsonConverter(typeof(TolerantEnumConverter))]
    public enum FolderEntryType
    {
        Unknown = 0,

        [EnumMember(Value = "directory")] Directory,
        [EnumMember(Value = "media")] Media,
    }

    /// <summary>
    /// One source root available to the signed-in profile. <see cref="Id"/>
    /// is opaque; the server deliberately never exposes a filesystem path.
    /// </summary>
    public sealed class FolderRoot
    {
        [JsonProperty("id")] public Guid Id { get; set; }

        [JsonProperty("source_instance_id")] public Guid SourceInstanceId { get; set; }

        [JsonProperty("source_name")] public string SourceName { get; set; } = string.Empty;

        [JsonProperty("library_kind")] public WorkKind LibraryKind { get; set; }

        [JsonProperty("name")] public string Name { get; set; } = string.Empty;

        [JsonProperty("available")] public bool Available { get; set; }

        [JsonProperty("unavailable_reason")] public string? UnavailableReason { get; set; }
    }

    /// <summary>
    /// A source-specific discovery failure which did not prevent other
    /// source roots from being returned.
    /// </summary>
    public sealed class FolderRootError
    {
        [JsonProperty("source_instance_id")] public Guid SourceInstanceId { get; set; }

        [JsonProperty("source_name")] public string SourceName { get; set; } = string.Empty;

        [JsonProperty("message")] public string Message { get; set; } = string.Empty;
    }

    public sealed class FolderRootsResponse
    {
        [JsonProperty("roots")] public IList<FolderRoot> Roots { get; set; } = new List<FolderRoot>();

        [JsonProperty("errors")] public IList<FolderRootError> Errors { get; set; } =
            new List<FolderRootError>();
    }

    public sealed class FolderBreadcrumb
    {
        [JsonProperty("name")] public string Name { get; set; } = string.Empty;

        [JsonProperty("path")] public string Path { get; set; } = string.Empty;
    }

    /// <summary>
    /// One immediate directory or media child. All optional descriptive
    /// fields and <see cref="ThumbnailUrl"/> are derived from the file by
    /// Playarr Server, never copied from a source application's catalogue.
    /// </summary>
    public sealed class FolderEntry
    {
        [JsonProperty("entry_type")] public FolderEntryType EntryType { get; set; }

        [JsonProperty("name")] public string Name { get; set; } = string.Empty;

        [JsonProperty("path")] public string Path { get; set; } = string.Empty;

        [JsonProperty("media_file_id")] public Guid? MediaFileId { get; set; }

        [JsonProperty("media_kind")] public WorkKind? MediaKind { get; set; }

        [JsonProperty("title")] public string? Title { get; set; }

        [JsonProperty("artist")] public string? Artist { get; set; }

        [JsonProperty("album")] public string? Album { get; set; }

        [JsonProperty("container")] public string? Container { get; set; }

        [JsonProperty("video_codec")] public string? VideoCodec { get; set; }

        [JsonProperty("audio_codec")] public string? AudioCodec { get; set; }

        [JsonProperty("duration_ms")] public long? DurationMs { get; set; }

        [JsonProperty("bitrate_bps")] public long? BitrateBps { get; set; }

        [JsonProperty("size_bytes")] public long? SizeBytes { get; set; }

        [JsonProperty("width")] public int? Width { get; set; }

        [JsonProperty("height")] public int? Height { get; set; }

        [JsonProperty("modified_at")] public DateTimeOffset? ModifiedAt { get; set; }

        [JsonProperty("thumbnail_url")] public string? ThumbnailUrl { get; set; }

        /// <summary>Embedded title when present, otherwise the filename.</summary>
        [JsonIgnore]
        public string DisplayTitle => string.IsNullOrWhiteSpace(Title) ? Name : Title!;
    }

    public sealed class FolderBrowseResponse
    {
        [JsonProperty("root")] public FolderRoot Root { get; set; } = new FolderRoot();

        [JsonProperty("path")] public string Path { get; set; } = string.Empty;

        [JsonProperty("breadcrumbs")] public IList<FolderBreadcrumb> Breadcrumbs { get; set; } =
            new List<FolderBreadcrumb>();

        [JsonProperty("entries")] public IList<FolderEntry> Entries { get; set; } = new List<FolderEntry>();

        [JsonProperty("total")] public long Total { get; set; }

        [JsonProperty("offset")] public int Offset { get; set; }

        [JsonProperty("limit")] public int Limit { get; set; }
    }

    /// <summary>
    /// The minimum path-safe state needed to rebuild the native library's
    /// Folders view after returning from playback. The root id is opaque and
    /// <see cref="Path"/> is server-issued and relative to that root.
    /// </summary>
    public sealed class LibraryFolderNavigationState
    {
        /// <summary>
        /// Bounds automatic page restoration if a future caller supplies a
        /// corrupt or stale value rather than a count captured by the app.
        /// </summary>
        public const int MaximumRestoredEntryCount = 1_000;

        public LibraryFolderNavigationState(
            WorkKind libraryKind,
            Guid rootFolderId,
            string? path,
            int loadedEntryCount)
        {
            LibraryKind = libraryKind;
            RootFolderId = rootFolderId;
            Path = path ?? string.Empty;
            LoadedEntryCount = Math.Max(0, Math.Min(loadedEntryCount, MaximumRestoredEntryCount));
        }

        public WorkKind LibraryKind { get; }

        public Guid RootFolderId { get; }

        public string Path { get; }

        public int LoadedEntryCount { get; }
    }
}
