using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;

namespace Playarr.Core.Auth
{
    /// <summary>
    /// Where a session obtained by login, refresh rotation, or RFC 8628
    /// device pairing is persisted.
    /// </summary>
    /// <remarks>
    /// A boundary rather than a concrete type for two reasons: this assembly
    /// cannot reference <c>Windows.Security.Credentials.PasswordVault</c>
    /// (the real Xbox implementation lives in the application head), and
    /// tests need an in-memory substitute. Mirrors
    /// <c>AccessTokenProviding</c> in the iOS client's PlayarrKit.
    /// </remarks>
    public interface ITokenStore
    {
        Task<StoredAuthSession?> GetSessionAsync(CancellationToken cancellationToken = default);

        Task StoreSessionAsync(StoredAuthSession session, CancellationToken cancellationToken = default);

        Task ClearSessionAsync(CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// A non-persistent <see cref="ITokenStore"/>. Real enough for tests and
    /// for a "don't remember me" session; useless across app restarts.
    /// </summary>
    public sealed class InMemoryTokenStore : ITokenStore
    {
        private StoredAuthSession? _session;

        public Task<StoredAuthSession?> GetSessionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(_session);

        public Task StoreSessionAsync(StoredAuthSession session, CancellationToken cancellationToken = default)
        {
            _session = session;
            return Task.CompletedTask;
        }

        public Task ClearSessionAsync(CancellationToken cancellationToken = default)
        {
            _session = null;
            return Task.CompletedTask;
        }
    }
}
