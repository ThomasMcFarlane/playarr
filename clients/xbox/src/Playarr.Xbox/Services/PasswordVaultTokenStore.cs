using System;
using System.Threading;
using System.Threading.Tasks;
using Windows.Security.Credentials;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// The real Windows <see cref="ITokenStore"/>, backed by
    /// <see cref="PasswordVault"/>. Playarr.Core only ships
    /// <c>InMemoryTokenStore</c> (see <c>Auth/ITokenStore.cs</c>'s remarks
    /// on why: that assembly can't reference <c>Windows.Security.Credentials</c>
    /// and needs an in-memory substitute for its own tests) -- this is the
    /// application head's real implementation.
    /// </summary>
    /// <remarks>
    /// One console, one signed-in account at a time, so the stored
    /// <see cref="StoredAuthSession"/> lives under one fixed
    /// resource/username pair rather than being keyed per server or per
    /// profile.
    /// </remarks>
    public sealed class PasswordVaultTokenStore : ITokenStore
    {
        private const string ResourceName = "Playarr";
        private const string UserName = "session";

        public Task<StoredAuthSession?> GetSessionAsync(CancellationToken cancellationToken = default)
        {
            var vault = new PasswordVault();
            PasswordCredential credential;
            try
            {
                credential = vault.Retrieve(ResourceName, UserName);
            }
            catch (Exception)
            {
                // PasswordVault.Retrieve throws (typically a COMException
                // wrapping HRESULT 0x80070490, ERROR_NOT_FOUND) rather than
                // returning null when no matching credential exists. "Never
                // paired yet" / "signed out" is the overwhelmingly common
                // reason this throws -- not an exceptional condition, hence
                // caught and translated to a null session rather than left
                // to propagate.
                return Task.FromResult<StoredAuthSession?>(null);
            }

            credential.RetrievePassword();
            var session = JsonCoding.Deserialize<StoredAuthSession>(credential.Password);
            return Task.FromResult(session);
        }

        public Task StoreSessionAsync(StoredAuthSession session, CancellationToken cancellationToken = default)
        {
            if (session is null)
            {
                throw new ArgumentNullException(nameof(session));
            }

            var vault = new PasswordVault();

            // PasswordVault.Add throws if a credential already exists for
            // this resource/username pair -- unlike a plain upsert, so any
            // previous session has to be removed first.
            RemoveExisting(vault);

            var json = JsonCoding.Serialize(session);
            vault.Add(new PasswordCredential(ResourceName, UserName, json));

            return Task.CompletedTask;
        }

        public Task ClearSessionAsync(CancellationToken cancellationToken = default)
        {
            var vault = new PasswordVault();
            RemoveExisting(vault);
            return Task.CompletedTask;
        }

        private static void RemoveExisting(PasswordVault vault)
        {
            try
            {
                var credential = vault.Retrieve(ResourceName, UserName);
                vault.Remove(credential);
            }
            catch (Exception)
            {
                // Nothing to remove -- fine. Both StoreSessionAsync (clearing
                // the way for the new credential) and ClearSessionAsync
                // treat "wasn't there" as a no-op rather than an error.
            }
        }
    }
}
