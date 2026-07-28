using Windows.System.Profile;
using Playarr.Core.Playback;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// Best-effort console model detection, feeding
    /// <see cref="XboxPlaybackProfile.ForModel"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="AnalyticsInfo.VersionInfo"/>'s <c>DeviceFamily</c> confirms
    /// "this process is running on some Xbox" (the family string
    /// <c>"Windows.Xbox"</c>) but not which one. Reliably telling One / One
    /// S / One X / Series S / Series X apart needs the Xbox-exclusive
    /// extension SDK -- the <c>Windows.Xbox.System</c> namespace, reached
    /// only behind
    /// <c>Windows.Foundation.Metadata.ApiInformation.IsTypePresent</c>
    /// checks because it doesn't exist outside an Xbox-targeted build that
    /// references that extension SDK. Neither a real console nor that
    /// extension SDK is available to verify against from this environment,
    /// so that finer-grained lookup is deliberately not attempted here.
    /// </para>
    /// <para>
    /// Defaulting to <see cref="XboxModel.Unknown"/> whenever detection
    /// isn't confident is intentional, not a shortcut:
    /// <see cref="XboxPlaybackProfile.ForModel"/> already treats
    /// <see cref="XboxModel.Unknown"/> as the deliberately conservative
    /// floor (H.264-only, 1080p, the original Xbox One's bitrate ceiling),
    /// so under-detecting only ever costs a server-side transcode that
    /// would otherwise have been a direct play -- never a direct play the
    /// console actually can't decode.
    /// </para>
    /// </remarks>
    public static class XboxModelDetector
    {
        private const string XboxDeviceFamily = "Windows.Xbox";

        /// <summary>
        /// <see cref="XboxModel.Unknown"/> unless this process is confirmed
        /// running on an Xbox device family -- e.g. in the Xbox Dev Mode
        /// emulator, on a desktop debug session, or on any non-Xbox Windows
        /// device, this always returns <see cref="XboxModel.Unknown"/>.
        /// </summary>
        public static XboxModel DetectModel()
        {
            string family;
            try
            {
                family = AnalyticsInfo.VersionInfo.DeviceFamily;
            }
            catch
            {
                // A design-time or otherwise unusual host can throw here
                // rather than returning a sentinel -- "unknown" either way.
                return XboxModel.Unknown;
            }

            if (family != XboxDeviceFamily)
            {
                return XboxModel.Unknown;
            }

            // Confirmed some Xbox, but not which one -- see the type-level
            // remarks on why finer-grained detection isn't attempted here.
            // Falls through to the conservative floor.
            return XboxModel.Unknown;
        }
    }
}
