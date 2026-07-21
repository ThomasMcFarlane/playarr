# Distributed Design

This document covers what changes when Streamarr moves from a single
process (Tier 1) to multiple cooperating processes (Tiers 2 and 3): the
statelessness requirements that make horizontal scaling safe, the
`ClusterCoordinator` abstraction, and the one deliberate, documented
exception to statelessness — on-demand transcode sessions.

## Statelessness requirements

Every `STREAMARR_ROLE=api` process must be interchangeable with every other
`STREAMARR_ROLE=api` process from the point of view of an incoming request, with
exactly one documented exception (transcode session affinity, below). This
is the property that makes horizontal scaling, rolling deploys, and pod
eviction in Kubernetes safe rather than something that silently drops
requests or corrupts state. Concretely:

- **No durable state lives in process memory — this is the target, and is
  true today for devices, library/catalog data, users, policies, and
  refresh tokens, but not yet for everything.** `Device` rows,
  `Work`/`MediaFile`/`Rendition` catalog data, playback analytics, `User`
  accounts, `Policy` records, and refresh-token secrets all really do live
  in the database (SQLite at Tier 1, Postgres at Tiers 2/3) via real
  `streamarr-db` repositories — `streamarr-db/src/repo/{user,policy,
  refresh_token}.rs` are real, `users`/`policies` have existed since
  `backend/migrations/postgres/0010_users_policies.sql`, and
  `backend/src/main.rs` wires `SqlxRefreshTokenRepo` (durable), not
  `InMemoryRefreshTokenStore` — so an API node handling a request for any
  of those doesn't need to have "seen" the client before. (Corrected here:
  an earlier pass of this document said the opposite for this paragraph;
  see `docs/architecture/peer-groups.md` §1.1 for how that staleness was
  caught.) **RFC 8628 device-authorization state does not yet** —
  `streamarr-auth`'s `InMemoryDeviceAuthorizationStore`/
  `DashMapDeviceFlowHandler` remain real, working, thread-safe (not mocks),
  making the device-pairing flow fully functional *within one process's
  lifetime* — but that state does not survive a restart and is not visible
  to a second node, which directly violates the interchangeability
  property this section otherwise describes. See
  [`auth-modes.md`](auth-modes.md) for what this means concretely for each
  `AuthMode`. This is the single remaining asterisk on "Streamarr is
  stateless above the database" as of this pass, and a multi-node
  deployment should not expect device-pairing approvals to work across
  nodes until real persistence lands here.
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
- **Background work is resumable, not owned.** A `STREAMARR_ROLE=worker` process
  that dies mid-job (background Tdarr transcode, library scan) leaves
  checkpointed progress in the database; any other worker process can pick
  the job back up. Nothing about a background job assumes it will finish on
  the node that started it.

The one place this is *not* true — on-demand transcode sessions — is called
out explicitly below rather than left as an implicit exception, because
getting this wrong (routing a segment request to the wrong node) is a
concrete, immediate playback failure.

## The `ClusterCoordinator` design

Multi-node deployments need two related but distinct things that
single-node deployments don't: mutual exclusion (don't let two nodes run
the same short-lived unit of work concurrently) and leader election (let
exactly one node own a longer-lived singleton responsibility until it dies
or gives it up). Both are abstracted behind one `ClusterCoordinator` trait
in `streamarr-coordination`, sharing a trait because they share a backend
and both are needed by `backend/src/main.rs`'s worker composition: the
background Tdarr dispatch loop campaigns for leadership of the
`"transcode-dispatcher"` role (via the `run_while_leader` helper — campaign,
then keep renewing the lease every `ttl / 2` for as long as the loop runs)
so only one node in a multi-node deployment ever dispatches to Tdarr, while
each arr-sync reconciliation poller instead takes a short-lived `try_lock`
scoped to its own source instance (`arr-sync:<source_instance_id>`) around
each individual poll pass, so two nodes can't overlap reconciling the same
*arr instance concurrently — every node runs its own poller loop, but a
lock (not an election) keeps any single pass from double-running:

```rust
#[async_trait]
pub trait ClusterCoordinator: Send + Sync {
    /// Non-blocking attempt to acquire a named, TTL-bounded exclusive
    /// lock. `Ok(None)` (not an error) means someone else holds it.
    async fn try_lock(&self, key: &str, ttl: Duration) -> Result<Option<LockGuard>, CoordinationError>;

    /// Attempts to become leader for `role`. Non-blocking: returns whether
    /// *this call* won or renewed leadership.
    async fn campaign_leader(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError>;

    /// Extends this node's existing leadership of `role`. Returns
    /// `Ok(false)` (not an error) if leadership was lost.
    async fn renew_leadership(&self, role: &str, ttl: Duration) -> Result<bool, CoordinationError>;

    /// Cheap, local, non-blocking read of the last-known outcome of
    /// campaign/renew for `role` — does not itself contact the backend.
    fn is_leader(&self, role: &str) -> bool;
}
```

There is no `register_node`, `list_nodes`, `NodeId`, or `ClusterNode` on
this trait — cluster *membership* (as opposed to leadership of one named
role) is not something `ClusterCoordinator` tracks at all; see the "Known
gap" note under `PostgresCoordinator` below.

### `SingleNodeCoordinator` (Tier 1)

The in-process implementation used for `DeploymentTier::SingleNode`.
`try_lock` is a **real** lock — a `tokio::sync::Mutex` per key — so it
genuinely serialises concurrent tasks within this one process; it is not a
no-op. `campaign_leader`/`renew_leadership`/`is_leader` *are* trivially and
permanently `true` for every role, because a single node has no peers to
lose an election to. This exists so that every code path that depends on
`ClusterCoordinator` can be written once against the trait and just work at
Tier 1 without an `if standalone` branch scattered through calling code.

### `PostgresCoordinator` (Tiers 2/3, default)

The multi-node implementation, requiring only the Postgres database every
Tier 2/3 deployment already has — no separate coordination service. Two
separate mechanisms, not one:

- **Mutual exclusion (`try_lock`) via session-level advisory locks.**
  `SELECT pg_try_advisory_lock(hashtext($1))`, keyed by a hash of the lock
  name; the returned `LockGuard` releases it (`pg_advisory_unlock`,
  hashing the same key, on the *same* connection) when dropped, or
  automatically when Postgres notices the holding session/connection has
  died — so a crashed lock-holder doesn't require an explicit failover
  timeout for lock-holding purposes. `ttl` is accepted by the trait for
  both implementations but not enforced by the coordinator itself — Tier
  1's `SingleNodeCoordinator` doesn't enforce it either; a caller that
  needs a hard bound wraps the guarded work in its own
  `tokio::time::timeout`.
- **Leader election (`campaign_leader`/`renew_leadership`) via a
  `cluster_leader` table** — not advisory locks; this is a second,
  independent mechanism, not a variant of the first. The table is
  `(role, node_id, expires_at)`, upserted with:
  ```sql
  INSERT INTO cluster_leader (role, node_id, expires_at)
  VALUES ($1, $2, now() + $3::interval)
  ON CONFLICT (role) DO UPDATE
  SET node_id = excluded.node_id, expires_at = excluded.expires_at
  WHERE cluster_leader.expires_at < now()
     OR cluster_leader.node_id = excluded.node_id
  RETURNING node_id
  ```
  A campaign only succeeds (returns a row) if the existing lease has
  expired or is already owned by the same `node_id`; renewal is a plain
  `UPDATE ... WHERE role = $1 AND node_id = $2 AND expires_at > now()`
  that silently affects zero rows once the lease has lapsed (the caller
  must treat that as leadership lost, not retry). `is_leader` never
  touches Postgres — it's a synchronous read of the local cache of the
  most recent campaign/renew outcome, so it can be stale by up to one
  renewal interval under backend unavailability.

**Known gap: there is no cluster membership table, and `list_nodes` doesn't
exist.** `cluster_leader` only answers "who currently leads role X" — there
is no `cluster_nodes` heartbeat table, no periodic per-node liveness
upsert, and no way to enumerate which nodes currently exist or what roles
they hold. An earlier draft of this document also proposed an opt-in
SWIM-style gossip membership layer for large Tier 3 clusters as an
alternative to a heartbeat table; neither the heartbeat table nor gossip
was ever built. There is no `streamarr-cluster` crate (coordination lives
in `streamarr-coordination`) and no `gossip` Cargo feature anywhere in the
workspace. This is corrected here rather than left in as if it existed;
membership tracking is a real gap for anything that would need it (e.g.
routing a request to a specific *other* node by address), not something
this pass built and forgot to document.

## Three-tier deployment table

| Tier | Node count | DB backend | Coordinator | Session affinity needed? |
|---|---|---|---|---|
| 1 — systemd | 1 | SQLite | `SingleNodeCoordinator` | No — one node, trivially affine |
| 2 — docker-compose | 1–3 | Postgres | `PostgresCoordinator` (advisory locks + `cluster_leader`) | Yes, once >1 node |
| 3 — Kubernetes | 3+ (autoscaled) | Postgres | `PostgresCoordinator` (advisory locks + `cluster_leader`) | Yes, always |

This is the same table introduced in [`overview.md`](overview.md); it's
repeated here because every row's implication for coordinator and affinity
behaviour is the subject of this document.

## Session-store node-affinity for on-demand transcode

On-demand transcode sessions (see [`overview.md`](overview.md#the-tdarr-background-vs-on-demand-transcode-split))
are the one deliberate exception to full statelessness. When a client
requests playback of a file it can't direct-play,
`streamarr_transcode::TranscodeOrchestrator::spawn_on_demand_transcode`
spawns a supervised `ffmpeg` process on whichever node received the
request, writing its segmented output to a local, per-session directory
under that node's own filesystem. That `ffmpeg` process and its output
directory are real, physical state tied to one specific machine — there is
no cheap way to make "an in-flight transcode" relocatable mid-session.

The session record itself — `TranscodeSession { id, media_file_id, profile,
owning_node_id, current_segment, expires_at }` — is **not** a durable SQL
table. It lives in whichever `streamarr_cache::CacheAndPubSub`
implementation the deployment is wired with (moka in-process at Tier 1;
Redis or Postgres `LISTEN`/`NOTIFY` at Tiers 2/3), keyed
`transcode-session:<id>`, with the cache entry's own TTL set from
`expires_at` — an idle session expires passively once its TTL lapses,
there is no separate active reaper process or `"transcode-reaper"`
leadership role sweeping a table. `owning_node_id` is a plain `String`
(whatever the composition root generates as this process's node identity
at boot — see `backend/src/main.rs`), not a foreign key into a membership
table, because (per the section above) no such table exists.

**Known gap: routing a segment request to the owning node is not
implemented.** `GET /api/v1/playback/{media_file_id}` (the endpoint that
runs the direct-play/existing-rendition/on-demand-transcode decision) is
implemented and does construct a `TranscodeSession` tagged with the
spawning node's id, but the well-known-convention URL it returns
(`/api/v1/media/sessions/{session_id}/playlist.m3u8`) is not itself a route
this workspace serves yet — there is no `X-Streamarr-Node` header, no `307`
redirect, and no `streamarr-session` sticky-routing cookie; see the
`TODO(streaming)` on `streamarr_api::playback::PlaybackInfoResponse`. A
single-node deployment doesn't need this (there's only ever one node to
route to); a multi-node deployment does, and it's an open follow-up rather
than something this pass built. `streamarr-transcode`'s own code already
anticipates the gap this creates: `TranscodeOrchestrator::expire_session`
can only actually kill the `ffmpeg` process when called on the node that
owns it (it keeps a `HashMap<Uuid, Child>` of only the sessions *this*
instance spawned); expiring a session from a different node today removes
its cache entry but has no way to reach into the owning node's process
table — a cross-node signal (e.g. a `CacheAndPubSub::publish` on a
per-node control channel) is called out in that module's own code comments
as the needed follow-up once multi-node on-demand transcode is actually
exercised end-to-end.

**Node death mid-session is not migrated.** If the owning node dies while a
transcode session is active, the session dies with it: the `ffmpeg` process
and its output directory are gone, and there is no way to hand a live
encoding process to another node. The correct and only recovery is for the
client to restart playback from its last known position, negotiating a
**new** transcode session that a (possibly different, currently healthy)
node will own. This is an accepted, documented tradeoff, not an oversight —
treating transcode sessions as relocatable would require either shared,
sub-second replicated encoder state (impractical) or pausing/resuming raw
`ffmpeg` process state across machines (not a thing `ffmpeg` supports).
Background Tdarr jobs, by contrast, genuinely are relocatable, because they
checkpoint progress in the database rather than existing only as in-flight
process state — see the background-vs-on-demand split in
[`overview.md`](overview.md).
