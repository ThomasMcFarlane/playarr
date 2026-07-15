# Distributed Design

This document covers what changes when Streamarr moves from a single
process (Tier 1) to multiple cooperating processes (Tiers 2 and 3): the
statelessness requirements that make horizontal scaling safe, the
`ClusterCoordinator` abstraction, and the one deliberate, documented
exception to statelessness — on-demand transcode sessions.

## Statelessness requirements

Every `--role api` process must be interchangeable with every other
`--role api` process from the point of view of an incoming request, with
exactly one documented exception (transcode session affinity, below). This
is the property that makes horizontal scaling, rolling deploys, and pod
eviction in Kubernetes safe rather than something that silently drops
requests or corrupts state. Concretely:

- **No durable state lives in process memory.** Users, sessions (playback
  position, watch history), policies, refresh tokens, library metadata, and
  transcode job state all live in the database (SQLite at Tier 1, Postgres
  at Tiers 2/3). An API node that receives a request has everything it
  needs to answer it by reading the database; it does not need to have
  "seen" the client before.
- **Ephemeral, non-durable state (rate limiting, short-lived caches) is
  either per-node with a short TTL and no cross-node consistency
  requirement, or lives in a shared store when correctness genuinely
  depends on cross-node visibility.** Streamarr does not require Redis or
  another shared cache as a hard dependency at any tier; where a shared
  cache would help (e.g. cross-node rate limiting at Tier 3), it degrades
  gracefully to per-node behaviour if unavailable rather than being load
  bearing.
- **No node-local filesystem state, except explicitly scoped caches.** An
  API node may keep a local disk cache (artwork thumbnails, transcode
  segment output) for its own use, but never as the *only* copy of anything
  that another node might need to serve — anything a differently-routed
  request might need must be reachable from the database or object storage,
  not assumed to be on "the node that handled it last time."
- **Background work is resumable, not owned.** A `--role worker` process
  that dies mid-job (background Tdarr transcode, library scan) leaves
  checkpointed progress in the database; any other worker process can pick
  the job back up. Nothing about a background job assumes it will finish on
  the node that started it.

The one place this is *not* true — on-demand transcode sessions — is called
out explicitly below rather than left as an implicit exception, because
getting this wrong (routing a segment request to the wrong node) is a
concrete, immediate playback failure.

## The `ClusterCoordinator` design

Multi-node deployments need exactly one thing that single-node deployments
don't: agreement about which node is allowed to do work that must not run
twice concurrently (issuing scheduled maintenance jobs, running database
migrations on startup, owning certain singleton background loops). This is
abstracted behind a `ClusterCoordinator` trait in `streamarr-cluster`:

```rust
#[async_trait]
pub trait ClusterCoordinator: Send + Sync {
    /// Register this node in the cluster, returning its assigned node_id.
    async fn register_node(&self, roles: RoleSet, address: SocketAddr) -> Result<NodeId>;

    /// Attempt to acquire leadership for a named responsibility
    /// (e.g. "scheduler", "migration-runner"). Returns true if this node
    /// now holds it.
    async fn try_acquire_leadership(&self, responsibility: &str) -> Result<bool>;

    /// Renew this node's leadership claim / liveness heartbeat. Must be
    /// called more often than the staleness threshold or leadership (and
    /// node membership) will be considered lost.
    async fn renew_heartbeat(&self, node_id: NodeId) -> Result<()>;

    /// Whether this node currently holds leadership for a responsibility.
    fn is_leader(&self, responsibility: &str) -> bool;

    /// Current known cluster membership (for admin/status endpoints and
    /// for peer-aware routing, e.g. transcode session affinity below).
    async fn list_nodes(&self) -> Result<Vec<ClusterNode>>;
}
```

### `SingleNodeCoordinator` (Tier 1)

A no-op implementation used whenever the process's `RoleSet` is
`STANDALONE` and no peers are configured. `try_acquire_leadership` always
returns `true` immediately (there is only ever one node, so it is trivially
the leader of everything), `list_nodes` returns a single entry for itself,
and `renew_heartbeat` is a cheap no-op. This exists so that every code path
that depends on `ClusterCoordinator` — the scheduler, the migration runner —
can be written once against the trait and just work at Tier 1 without an
`if standalone` branch scattered through calling code.

### `PostgresCoordinator` (Tiers 2/3, default)

The default multi-node implementation, requiring only the Postgres database
every Tier 2/3 deployment already has — no separate coordination service.
Two mechanisms:

- **Leader election via advisory locks.** Each named responsibility maps to
  a stable 64-bit lock key (a hash of the responsibility name).
  `try_acquire_leadership` calls `pg_try_advisory_lock(key)`; the first node
  to successfully acquire it holds leadership for that responsibility until
  it releases the lock or its session ends (including on crash — Postgres
  releases session-level advisory locks automatically when the holding
  connection dies, so a crashed leader doesn't require an explicit failover
  timeout for lock-holding purposes).
- **Membership and health via a heartbeat table.** A `cluster_nodes` table
  (`node_id`, `role_set`, `address`, `last_heartbeat`, `registered_at`) is
  upserted by each node on a fixed interval (default 5 seconds). A node is
  considered live if `last_heartbeat` is within a staleness threshold
  (default 15 seconds — three missed heartbeats); `list_nodes` filters on
  this. This table is what other subsystems (notably transcode session
  routing, below) query to know which nodes currently exist and what roles
  they hold, independent of advisory-lock leadership.

### Gossip (opt-in, Tier 3 only)

For large Kubernetes clusters, hammering Postgres with per-second heartbeat
upserts from every node is unnecessary overhead once cluster size grows.
A SWIM-style gossip membership protocol is supported as an **opt-in**
alternative membership layer (`cluster.membership: gossip` in config,
feature-gated behind `streamarr-cluster`'s `gossip` Cargo feature) — nodes
discover and health-check each other peer-to-peer instead of through the
heartbeat table, reducing to a periodic reconciliation write against
Postgres rather than a constant one. Leader election for named
responsibilities still goes through `PostgresCoordinator`'s advisory locks
regardless of which membership layer is active — gossip only replaces
*membership/liveness*, not the small amount of true mutual-exclusion
Streamarr needs. This is off by default; `PostgresCoordinator`'s heartbeat
table is more than sufficient for the node counts most Tier 3 deployments
actually run, and gossip adds an operational surface (a peer-to-peer
protocol with its own failure modes) that isn't worth taking on until
cluster size actually demands it.

## Three-tier deployment table

| Tier | Node count | DB backend | Coordinator | Session affinity needed? |
|---|---|---|---|---|
| 1 — systemd | 1 | SQLite | `SingleNodeCoordinator` | No — one node, trivially affine |
| 2 — docker-compose | 1–3 | Postgres | `PostgresCoordinator` (heartbeat) | Yes, once >1 node |
| 3 — Kubernetes | 3+ (autoscaled) | Postgres | `PostgresCoordinator` (heartbeat, gossip opt-in) | Yes, always |

This is the same table introduced in [`overview.md`](overview.md); it's
repeated here because every row's implication for coordinator and affinity
behaviour is the subject of this document.

## Session-store node-affinity for on-demand transcode

On-demand transcode sessions (see [`overview.md`](overview.md#the-tdarr-background-vs-on-demand-transcode-split))
are the one deliberate exception to full statelessness. When a client
requests playback of a file it can't direct-play, the API node that
receives that request spawns a supervised `ffmpeg` process *on itself*,
writing HLS/DASH segments to a local, node-scoped disk cache. That `ffmpeg`
process and its segment cache are real, physical state tied to one specific
machine — there is no cheap way to make "an in-flight transcode" relocatable
mid-session.

To make this safe in a multi-node deployment, the session store records the
owning node explicitly:

```sql
CREATE TABLE transcode_sessions (
    session_id      UUID PRIMARY KEY,
    node_id         UUID NOT NULL REFERENCES cluster_nodes(node_id),
    library_item_id UUID NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_segment_at TIMESTAMPTZ,
    client_profile  JSONB NOT NULL
);
```

Routing subsequent segment requests back to the owning node is handled one
of two ways depending on deployment tier, both implemented in
`streamarr-transcode`:

- **Signed redirect (default, works behind any load balancer/ingress).**
  The node that starts a session returns its own address in an
  `X-Streamarr-Node` header (and, for HTTP clients that follow redirects
  transparently, a `307` to `https://<owning-node-address>/...`) on the
  initial playback-start response. The client then requests all subsequent
  segments directly against that address for the lifetime of the session.
  This requires each node to be independently addressable (true at Tier
  2/3 by design — every node has its own address in `cluster_nodes`), and
  works with any ingress/load balancer configuration without requiring the
  ingress itself to understand session affinity.
- **Sticky routing at the ingress (Tier 3 optional).** Where the Kubernetes
  ingress supports session-affinity cookies (see
  [`deployment/kubernetes.md`](deployment/kubernetes.md)), a
  `streamarr-session` cookie scoped to the transcode session ID can be used
  instead, letting the ingress itself route consistently without every
  client needing to handle the redirect. This is an optimisation, not a
  requirement — the signed-redirect path always works and is the fallback.

**Node death mid-session is not migrated.** If the owning node dies while a
transcode session is active, the session dies with it: the `ffmpeg` process
and its segment cache are gone, and there is no way to hand a live encoding
process to another node. The client observes this as a stalled/failed
segment fetch, and the correct and only recovery is for the client to
restart playback from its last known position, which negotiates a **new**
transcode session that a (possibly different, currently healthy) node will
own. This is an accepted, documented tradeoff, not an oversight — treating
transcode sessions as relocatable would require either shared, sub-second
replicated encoder state (impractical) or pausing/resuming raw `ffmpeg`
process state across machines (not a thing `ffmpeg` supports). Background
Tdarr jobs, by contrast, genuinely are relocatable, because they checkpoint
progress in the database rather than existing only as in-flight process
state — see the background-vs-on-demand split in
[`overview.md`](overview.md).

Stale `transcode_sessions` rows (owning node's last heartbeat past the
staleness threshold, or `last_segment_at` past a per-session idle timeout)
are reaped by whichever node currently holds the `"transcode-reaper"`
leadership responsibility via `ClusterCoordinator`, so dead sessions don't
accumulate indefinitely in the table.
