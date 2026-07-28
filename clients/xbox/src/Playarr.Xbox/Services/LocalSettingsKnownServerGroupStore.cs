using System;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage;
using Playarr.Core.Auth;
using Playarr.Core.Networking;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// The real Windows <see cref="IKnownServerGroupStore"/>, backed by
    /// <see cref="ApplicationData.LocalSettings"/>. Playarr.Core only ships
    /// <c>InMemoryKnownServerGroupStore</c> for the same reason it only
    /// ships <c>InMemoryTokenStore</c> -- see that assembly's remarks.
    /// </summary>
    /// <remarks>
    /// A server address is configuration, not a secret -- see the reasoning
    /// already documented on <see cref="IKnownServerGroupStore"/> itself in
    /// Playarr.Core, which is exactly why this belongs in
    /// <see cref="ApplicationData.LocalSettings"/> rather than
    /// <see cref="Windows.Security.Credentials.PasswordVault"/> the way
    /// <see cref="PasswordVaultTokenStore"/> is. One consequence worth
    /// noting: unlike PasswordVault, LocalSettings access is synchronous, so
    /// every method here completes without ever truly awaiting anything --
    /// they still return <see cref="Task"/> only to satisfy the interface.
    /// </remarks>
    public sealed class LocalSettingsKnownServerGroupStore : IKnownServerGroupStore
    {
        private const string SettingsKey = "KnownServerGroup";

        public Task<KnownServerGroup?> GetGroupAsync(CancellationToken cancellationToken = default)
        {
            var values = ApplicationData.Current.LocalSettings.Values;
            if (values.TryGetValue(SettingsKey, out var stored) && stored is string json)
            {
                return Task.FromResult(JsonCoding.Deserialize<KnownServerGroup>(json));
            }

            return Task.FromResult<KnownServerGroup?>(null);
        }

        public Task RememberAsync(KnownServerGroup group, CancellationToken cancellationToken = default)
        {
            if (group is null)
            {
                throw new ArgumentNullException(nameof(group));
            }

            ApplicationData.Current.LocalSettings.Values[SettingsKey] = JsonCoding.Serialize(group);
            return Task.CompletedTask;
        }

        public Task ForgetAsync(CancellationToken cancellationToken = default)
        {
            ApplicationData.Current.LocalSettings.Values.Remove(SettingsKey);
            return Task.CompletedTask;
        }
    }
}
