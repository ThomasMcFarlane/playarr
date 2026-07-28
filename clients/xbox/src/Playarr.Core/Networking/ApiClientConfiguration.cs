using System;
using Playarr.Core.Models;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// How to talk to one Playarr server.
    /// </summary>
    /// <remarks>
    /// <see cref="BaseUrl"/> is the one value that must be user-configurable:
    /// a Playarr client points at an arbitrary operator-run instance, never
    /// at a vendor endpoint.
    /// </remarks>
    public sealed class ApiClientConfiguration
    {
        public ApiClientConfiguration(Uri baseUrl, Guid deviceId)
        {
            BaseUrl = baseUrl ?? throw new ArgumentNullException(nameof(baseUrl));
            DeviceId = deviceId;
        }

        public Uri BaseUrl { get; }

        /// <summary>
        /// Stable per install -- see <see cref="LoginRequest.DeviceId"/>.
        /// The application head persists this and passes the same value on
        /// every launch.
        /// </summary>
        public Guid DeviceId { get; }

        public ClientPlatform ClientPlatform { get; set; } = ClientPlatform.Xbox;

        public string ClientVersion { get; set; } = "0.1.0";

        public string DeviceName { get; set; } = "Playarr for Xbox";
    }
}
