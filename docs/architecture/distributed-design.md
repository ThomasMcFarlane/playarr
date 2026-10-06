# Distributed Design

Playarr Server is SQLite-only ([ADR 0002](adr/0002-sqlite-only-storage.md),
superseding [ADR 0001](adr/0001-storage-engine.md)). There is no shared
database tier: every server owns one SQLite database file, and several
servers (for example one per region) cooperate through **peer sync**, with
each node keeping its own database. This document covers what that means for
processes, the `ClusterCoordinator` abstraction, and the one documented
exception to statelessness, on-demand transcode sessions. Peer sync itself is
described in [`peer-groups.md`](peer-groups.md).

The earlier design in which several `api`/`worker` replicas shared one
Postgres database (advisory-lock coordination, a `cluster_leader` table,
`LISTEN`/`NOTIFY` cache invalidation, an optional Redis cache) was removed;
see ADR 0002 for the reasons.

## Process model

- One server process per SQLite database is the supported shape. It runs
  with `PLAYARR_ROLE=all` (the default): the API, the arr-sync pollers, the
  peer-sync pollers and the Tdarr dispatcher are tasks in the same process.
- `PLAYARR_ROLE=api` and `PLAYARR_ROLE=worker` still exist for processes that
  share one database file on one host, but they are not a scaling mechanism:
  SQLite permits one writer at a time (WAL mode with a busy timeout).
- Durable state (devices, catalogue, users, policies, refresh tokens,
  analytics) lives in the node's own database through `playarr-db`
  repositories. RFC 8628 device-authorisation state is in-process
  (`playarr-auth`'s `InMemoryDeviceAuthorizationStore`) and does not survive
  a restart; see [`auth-modes.md`](auth-modes.md).
- Background work is resumable: a job that dies mid-run leaves checkpointed
  progress in the database and is picked up again after a restart.
- A local disk cache (artwork thumbnails, transcode segment output) is scoped
  to the node.

## The `ClusterCoordinator` design

`playarr-coordination` keeps a small `ClusterCoordinator` trait so code that
needs mutual exclusion or a singleton role is written once against the
trait:

```rust
#[async_trait]
pub trait ClusterCoordinator: Send + Sync {
    async fn try_lock(&self, key: &str, ttl: Duration) -> Result<Option<LockGuard>, CoordinationError>;
    async fn campaign_leader(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError>;
    async fn renew_leadership(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError>;
    fn is_leader(&self, role: &str) -> bool;
}
```

The only implementation is `SingleNodeCoordinator`. `try_lock` is a real
lock (a `tokio::sync::Mutex` per key) that serialises concurrent tasks inside
the process; leadership is trivially and permanently `true` for every role,
because a node has no peers to lose an election to. The Tdarr dispatcher
(role `transcode-dispatcher`) and the arr-sync pollers (`arr-sync:<id>`
locks) use it exactly as before. Nodes do not elect each other: each node
dispatches and reconciles for its own library, and peer sync replicates the
shared account and availability data between them.

## Deployment options

| Deployment | Nodes | Storage | Coordinator |
|---|---|---|---|
| systemd | 1 | SQLite file | `SingleNodeCoordinator` |
| Docker Compose | 1 per stack | SQLite file on a data volume | `SingleNodeCoordinator` |
| Kubernetes | 1 per pod/volume, peers joined by peer sync | SQLite file on a persistent volume | `SingleNodeCoordinator` |

## Session affinity for on-demand transcode

On-demand transcode sessions are the one deliberate exception to full
statelessness. `playarr_transcode::TranscodeOrchestrator::spawn_on_demand_transcode`
spawns a supervised `ffmpeg` process on the node that received the request,
writing segmented output to a per-session directory on that node's
filesystem. The session record (`TranscodeSession { id, media_file_id,
profile, owning_node_id, current_segment, expires_at }`) is not a durable SQL
table: it lives in the `playarr_cache::CacheAndPubSub` implementation (the
in-process moka cache), keyed `transcode-session:<id>`, with the entry TTL
taken from `expires_at`, so an idle session expires passively.

Because a node only ever serves its own clients and its own sessions, no
cross-node routing of segment requests is needed. If a node restarts
mid-session the session is gone and the client restarts playback from its
last known position, negotiating a new session. Background Tdarr jobs, by
contrast, are relocatable because they checkpoint progress in the database.
