using System;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The <c>Frame.Navigate</c> parameter for <see cref="PlayerPage"/>.
    /// </summary>
    /// <remarks>
    /// A plain typed class rather than a bare <see cref="Guid"/> so a future
    /// caller (a work-detail or episode-list screen, once the Screens phase
    /// -- task #5 -- builds one) can also hand across a resume position and
    /// a display title without <see cref="PlayerPage"/> having to re-fetch
    /// either before it can render anything. Both optional members are
    /// <c>null</c>-safe: a caller with only a media file id can construct
    /// this with just that.
    /// </remarks>
    public sealed class PlayerNavigationParameter
    {
        public PlayerNavigationParameter(Guid mediaFileId, long? resumePositionMs = null, string? title = null)
        {
            MediaFileId = mediaFileId;
            ResumePositionMs = resumePositionMs;
            Title = title;
        }

        /// <summary>The media file to negotiate and play.</summary>
        public Guid MediaFileId { get; }

        /// <summary>
        /// Where to resume from, in milliseconds of true source position
        /// (i.e. already comparable to <c>PlaybackInfoResponse.SourceOffsetMs</c>
        /// plus a reported play position -- see <c>PlayerViewModel</c>'s
        /// remarks on <c>SourceOffsetMs</c>). <c>null</c> starts from the
        /// beginning.
        /// </summary>
        public long? ResumePositionMs { get; }

        /// <summary>
        /// Display title for the on-screen title overlay and the System
        /// Media Transport Controls "now playing" card. <c>null</c>/empty
        /// hides the overlay and falls back to a generic SMTC title.
        /// </summary>
        public string? Title { get; }
    }
}
