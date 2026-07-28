using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Playarr.Core.Models;

namespace Playarr.Core.Auth
{
    /// <summary>
    /// One remembered address within a group.
    /// </summary>
    /// <remarks>
    /// Port of <c>KnownServer</c> in the iOS client's PlayarrKit, itself a
    /// mirror of <c>knownServers.ts</c> in the TV/web workspace. See
    /// <c>docs/architecture/peer-groups.md</c> §6.4/§7.1.
    /// </remarks>
    public sealed class KnownServer
    {
        [JsonProperty("url")] public string Url { get; set; } = string.Empty;

        /// <summary>
        /// The peer node this address belongs to. <c>null</c> only for an
        /// address remembered before this attribution existed, or one that
        /// arrived without a bundle at all.
        /// </summary>
        /// <remarks>
        /// Per §3.7, refresh tokens are never synced across peer nodes, so a
        /// refresh retry only ever considers addresses whose
        /// <see cref="PeerNodeId"/> matches the node that issued the token
        /// being refreshed. A <c>null</c> here never matches -- deliberately:
        /// unattributed data degrades to "don't retry", not "retry
        /// everywhere".
        /// </remarks>
        [JsonProperty("peer_node_id")] public Guid? PeerNodeId { get; set; }

        [JsonProperty("last_success_at")] public DateTimeOffset? LastSuccessAt { get; set; }
    }

    /// <summary>
    /// A remembered, priority-ordered group of server addresses for one
    /// account -- the answer to "which server do I talk to" once a client
    /// has met a peer group, which is a list that can fail over rather than
    /// a single URL.
    /// </summary>
    public sealed class KnownServerGroup
    {
        [JsonProperty("group_id")] public string? GroupId { get; set; }

        [JsonProperty("group_name")] public string? GroupName { get; set; }

        /// <summary>Priority-ordered.</summary>
        [JsonProperty("servers")] public IList<KnownServer> Servers { get; set; } = new List<KnownServer>();

        /// <summary>
        /// Fast path: tried before <see cref="Servers"/>, so a healthy
        /// reconnect skips a probe round trip entirely.
        /// </summary>
        [JsonProperty("last_good_url")] public string? LastGoodUrl { get; set; }

        /// <summary>
        /// Folds a server's self-healing bundle into a group, promoting the
        /// address that just answered to <see cref="LastGoodUrl"/>.
        /// </summary>
        /// <remarks>
        /// <paramref name="bundle"/> is always the server's full, fresh,
        /// priority-ordered, node-attributed member list, so this replaces
        /// <see cref="Servers"/> wholesale rather than merging entry by
        /// entry. Previously recorded success timestamps are preserved for
        /// addresses present in both snapshots; attribution always comes
        /// fresh from the bundle, since the server is the one source of
        /// truth for it.
        /// </remarks>
        public static KnownServerGroup Merging(
            PeerAddressBundle bundle,
            string successfulUrl,
            KnownServerGroup? existing,
            DateTimeOffset now)
        {
            var previousSuccess = new Dictionary<string, DateTimeOffset?>(StringComparer.Ordinal);
            if (existing != null)
            {
                foreach (var server in existing.Servers)
                {
                    previousSuccess[server.Url] = server.LastSuccessAt;
                }
            }

            var servers = new List<KnownServer>();
            foreach (var entry in bundle.Addresses)
            {
                servers.Add(new KnownServer
                {
                    Url = entry.Url,
                    PeerNodeId = entry.PeerNodeId,
                    LastSuccessAt = string.Equals(entry.Url, successfulUrl, StringComparison.Ordinal)
                        ? now
                        : previousSuccess.TryGetValue(entry.Url, out var previous) ? previous : null,
                });
            }

            return new KnownServerGroup
            {
                GroupId = bundle.GroupId?.ToString(),
                GroupName = bundle.GroupName,
                Servers = servers,
                LastGoodUrl = successfulUrl,
            };
        }

        /// <summary>
        /// Candidate addresses in priority order: <see cref="LastGoodUrl"/>
        /// first, then <see cref="Servers"/>, deduplicated.
        /// </summary>
        public IReadOnlyList<string> CandidateUrls()
        {
            var candidates = new List<string>();

            if (!string.IsNullOrEmpty(LastGoodUrl))
            {
                candidates.Add(LastGoodUrl!);
            }

            foreach (var server in Servers)
            {
                if (!candidates.Contains(server.Url))
                {
                    candidates.Add(server.Url);
                }
            }

            return candidates;
        }

        /// <summary>
        /// Addresses attributed to <paramref name="peerNodeId"/>, in the same
        /// order as <see cref="CandidateUrls"/> but filtered to matching
        /// entries.
        /// </summary>
        /// <remarks>
        /// Refresh tokens are never synced across peer nodes (§3.7), so a
        /// refresh retry only makes sense against another address of the
        /// <em>same</em> node that issued the token -- a genuinely different
        /// node is guaranteed to reject a token it never issued, and
        /// retrying there is several certain-401 round trips before the real
        /// fallback. An address with no recorded attribution never matches,
        /// so a group with no attribution at all yields an empty list rather
        /// than "every address": a fail-closed default matching this
        /// method's whole purpose.
        /// </remarks>
        public IReadOnlyList<string> SameNodeAddresses(Guid peerNodeId)
        {
            var candidates = new List<string>();

            if (!string.IsNullOrEmpty(LastGoodUrl))
            {
                foreach (var server in Servers)
                {
                    if (string.Equals(server.Url, LastGoodUrl, StringComparison.Ordinal) &&
                        server.PeerNodeId == peerNodeId)
                    {
                        candidates.Add(LastGoodUrl!);
                        break;
                    }
                }
            }

            foreach (var server in Servers)
            {
                if (server.PeerNodeId == peerNodeId && !candidates.Contains(server.Url))
                {
                    candidates.Add(server.Url);
                }
            }

            return candidates;
        }
    }

    /// <summary>
    /// Storage boundary for a remembered <see cref="KnownServerGroup"/>.
    /// </summary>
    /// <remarks>
    /// One fixed storage slot rather than a per-server one: unlike a session
    /// (scoped to one server), a known-server group is the single address
    /// book for this install, independent of which address is currently in
    /// use. A server address is configuration, not a secret, so the real
    /// implementation belongs in application settings rather than alongside
    /// the token store.
    /// </remarks>
    public interface IKnownServerGroupStore
    {
        Task<KnownServerGroup?> GetGroupAsync(CancellationToken cancellationToken = default);

        Task RememberAsync(KnownServerGroup group, CancellationToken cancellationToken = default);

        Task ForgetAsync(CancellationToken cancellationToken = default);
    }

    public static class KnownServerGroupStoreExtensions
    {
        /// <summary>
        /// Records a successful call against <paramref name="url"/>: bumps
        /// that address's timestamp and promotes it to the fast path,
        /// without physically reordering the list.
        /// </summary>
        /// <remarks>
        /// A no-op when no group is remembered yet. It deliberately never
        /// materialises a one-server group out of a bare URL -- that is
        /// <see cref="IKnownServerGroupStore.RememberAsync"/>'s job.
        /// </remarks>
        public static async Task RecordSuccessAsync(
            this IKnownServerGroupStore store,
            string url,
            DateTimeOffset now,
            CancellationToken cancellationToken = default)
        {
            var group = await store.GetGroupAsync(cancellationToken).ConfigureAwait(false);
            if (group is null)
            {
                return;
            }

            foreach (var server in group.Servers)
            {
                if (string.Equals(server.Url, url, StringComparison.Ordinal))
                {
                    server.LastSuccessAt = now;
                }
            }

            group.LastGoodUrl = url;
            await store.RememberAsync(group, cancellationToken).ConfigureAwait(false);
        }

        /// <summary>
        /// Folds a fresh bundle from a login or refresh response into
        /// whatever group is currently remembered, then persists it.
        /// </summary>
        public static async Task MergeAsync(
            this IKnownServerGroupStore store,
            PeerAddressBundle bundle,
            string successfulUrl,
            DateTimeOffset now,
            CancellationToken cancellationToken = default)
        {
            var existing = await store.GetGroupAsync(cancellationToken).ConfigureAwait(false);
            await store
                .RememberAsync(
                    KnownServerGroup.Merging(bundle, successfulUrl, existing, now),
                    cancellationToken)
                .ConfigureAwait(false);
        }
    }

    /// <summary>
    /// A non-persistent <see cref="IKnownServerGroupStore"/> for tests.
    /// </summary>
    public sealed class InMemoryKnownServerGroupStore : IKnownServerGroupStore
    {
        private KnownServerGroup? _group;

        public Task<KnownServerGroup?> GetGroupAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(_group);

        public Task RememberAsync(KnownServerGroup group, CancellationToken cancellationToken = default)
        {
            _group = group;
            return Task.CompletedTask;
        }

        public Task ForgetAsync(CancellationToken cancellationToken = default)
        {
            _group = null;
            return Task.CompletedTask;
        }
    }
}
