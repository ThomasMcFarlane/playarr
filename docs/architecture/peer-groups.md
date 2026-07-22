# Multi-Node / Peer Groups

This document specifies how independent, self-owned Streamarr installations
("home", "east", "west") join into a **group** that shares accounts, policy,
and catalog metadata, and can route playback between members, without
Streamarr ever moving media bytes itself except to actually serve a stream.

It synthesizes three independently-written proposals into one design. Where
the proposals disagreed, this document picks one answer and states why,
inline, next to the decision, rather than in a separate changelog: so a
reader encountering a design choice also sees the alternative that was
rejected and the reason.

Everything in this design is **additive and inert for a single, ungrouped
node**: no schema change breaks an existing row, no new background task
spawns, and no request path changes behavior when `group_id` is `NULL`.
This invariant is restated at the end of each section that could plausibly
violate it, and is the final checklist item before any phase ships.

---

## 1. Overview & terminology

### 1.1 The naming collision this design has to avoid

`docs/architecture/distributed-design.md` already uses "node" for something
else: an interchangeable, **stateless** process sharing one Postgres
database with other processes of the same deployment (`STREAMARR_ROLE=api`/
`worker`/`all`, `DeploymentTier::MultiNodePostgres{,Redis}`). Concretely,
that's `AppState.node_id`, which `backend/src/main.rs:1076` mints fresh
with `Uuid::new_v4()` on every process boot, and
`streamarr_coordination::PostgresCoordinator`'s own `node_id` concept, used
as the leaseholder identity in `cluster_leader` (`docs/architecture/
distributed-design.md`'s coordinator section). This document introduces a
genuinely different thing: an independently-addressed, independently
databased Streamarr **installation**, which may itself internally be a
Tier-1 single process or a Tier-2/3 multi-process deployment.

This document uses:

| Term | Meaning | Existing code |
|---|---|---|
| **replica** | The *existing* concept above: one stateless process within one installation's own deployment | `AppState.node_id`, `PostgresCoordinator`, `DeploymentTier` |
| **peer node** (or **peer**, or just **node** in prose once the term is established) | *New*: one independently-run, independently-databased Streamarr installation, with its own name, address(es), and its own copy (full or partial) of the media | This document |
| **group** | *New*: the set of peer nodes that have agreed to sync with each other | This document |

**No existing code is renamed.** `AppState.node_id` keeps meaning exactly
what it means today; nothing in this design reads or writes it. The two
axes compose freely: a single peer node can itself be a Tier-2/3 multi-replica
deployment sharing one Postgres database, and every "guard against two
processes doing the same work" mechanism this design needs (the
peer-sync poller, background availability rollups) reuses
`streamarr_coordination::ClusterCoordinator` exactly the way
`streamarr-arr-sync` already does, for exactly that reason: it is already
the right tool for "only one replica of *this* peer should do X."

**Correction folded into this design, not deferred:** `distributed-design.md`
currently states "there is no `UserRepo`/`PolicyRepo` in `streamarr-db`, and
no `users`/`sessions`/`refresh_tokens`/`policies` table in either migration
set," and describes `InMemoryUserDirectory`/`InMemoryRefreshTokenStore` as
the live implementation. That is stale: `streamarr-db/src/repo/{user,policy,
refresh_token}.rs` are real, `users`/`policies` have existed since
`backend/migrations/postgres/0010_users_policies.sql`, and
`backend/src/main.rs:919-920` wires `SqlxRefreshTokenRepo` (durable), not
the in-memory store. The **one** part of that paragraph still accurate today
is `InMemoryDeviceAuthorizationStore`/`DashMapDeviceFlowHandler`
(`streamarr-auth/src/device_flow.rs`): genuinely still in-process-only, no
`Sqlx*` implementation exists. Phase 1 (§8) includes fixing that paragraph
as a same-day, low-risk documentation correction, independent of and not
blocking the rest of this feature.

### 1.2 Key decisions at a glance

These are the places the three source proposals disagreed most, and the
call this document makes. Full rationale is in the referenced section.

| Question | Decision | Rejected alternative(s) |
|---|---|---|
| Peer-to-peer request auth | Per-peer Ed25519 signed requests (§3.3) | A single group-wide shared secret (unrevocable per-peer, whole-group blast radius on any one leak); mTLS (real operational cost for a self-hoster, no matching threat model) |
| Cross-node access-token trust | Per-peer EdDSA JWTs once grouped, reusing the same Ed25519 identity key as peer auth; HS256 unchanged for standalone nodes (§3.6) | A shared HMAC secret (same blast-radius problem as above, one leak forges tokens for any user against any peer) |
| Cross-node library identity | New `GroupLibrary` entity, `SourceInstance.group_library_id` maps a node's own local library into it (§5.1) | Routing/grants keyed directly on a local `SourceInstance.id` (does not work: that id is minted independently per node and is not the same value across peers, so a routing rule referencing it would only ever match on the node that created it) |
| Does `Work`/`MediaFile` itself sync across peers? | No. Stays strictly node-local, single writer (`ReconciliationPoller`, unchanged). A new `peer_leaf_availability` table is a read-only annotation (§4) | Replicating `Work` rows peer-to-peer keyed by external ref: creates a second writer of the same local `works` table `ReconciliationPoller`'s own poll-as-truth diff already owns exclusively, and its `SyncOp::Delete` path (a title has left the local *arr instance) has no way to distinguish "genuinely gone" from "a peer just re-upserted it" without new scoping work this design does not want to make foundational |
| Refresh tokens across peers | Not synced. Client retries the *same* refresh call against the next remembered address before falling back to full (credentials-only, never address-only) re-login (§3.7) | Syncing `refresh_token_families` with a max-generation-wins merge rule: technically arguable, but leaves an unresolved race if the same token is redeemed against two peers inside one sync interval, and two of the three source proposals independently declined to build it for exactly that reason |
| RFC 8628 device-pairing state across peers | Not synced. Android first contact uses a ten-minute `playarr.app` broker record; the selected browser profile creates and approves the real per-peer device credential, which Android redeems directly (§6.3) | Syncing `DeviceAuthorization` on the normal ~60s poll cadence: correctness risk against a ~10 minute, security-sensitive, human-paced flow that a lagging sync pass could visibly break |
| TV pairing artifact address awareness | The issuing peer embeds a `PeerAddressBundle` (§6.1, reused) directly into `verification_uri_complete` via the same `servers=` param the invite flow uses, so the QR/code itself is self-contained (§6.3) | Relying only on the approving device's own remembered `KnownServerGroup` for fan-out, with no address data in the artifact itself: fails for an approver who has never talked to this group before (a guest's phone, a different household member's browser with a stale cache) and does not literally satisfy the user's explicit requirement that "the QR code encodes the multiple server addresses" |
| Redirect vs. proxy delivery | Per-rule `DeliveryMode::Auto` (default) computes Redirect-if-target-address-is-client-reachable-else-Proxy per request from an operator-set flag; `Redirect`/`Proxy` remain available as explicit overrides (§5.3) | A single static field with no computed default: correct only if the admin never misconfigures reachability, and doesn't fail safe when they do |
| Where routing is evaluated | The **entire** playback negotiation (direct-play/rendition/transcode decision) is forwarded to the owning peer, not just the final stream URL (§5.2) | Swapping only the response URL while still running local negotiation logic: silently wrong, because `can_direct_play`/rendition selection/on-demand transcode all require probing the actual file, which the entry node does not have |

### 1.3 What this design explicitly does not attempt

- Streamarr never moves media bytes at rest between peers. A `Proxy`
  delivery streams bytes live, on demand, for the duration of one playback
  session; nothing is copied to disk on the entry node.
- `WatchProgress` (resume position) is **not** synced in this design's
  scope. It stays exactly as durable and node-local as it is today. A
  portable wrapper (matching a title across peers by external ref +
  `LeafSelector`, §4.2) is a natural, low-risk follow-up once this lands,
  noted in §8 as future work, not built here.
- No hosted media or peer-sync relay is introduced. Android first-contact
  linking is the narrow exception: `playarr.app` stores a ten-minute pairing
  record containing a single-use Streamarr device code, but never a password,
  browser bearer token, refresh token, or media request. The Android client
  still redeems the credential and reaches Streamarr directly.

---

## 2. Data model

All new tables follow the two conventions already established across every
existing migration pair (confirmed against `backend/migrations/postgres/
0010_users_policies.sql`'s own file-level note): `id`/foreign-key columns
are `TEXT` (stringified UUIDs) on **both** engines, booleans are `INTEGER`
0/1 via `streamarr_db::codec::bool_to_i64`/`bool_from_i64` on **both**
engines (not a native Postgres `boolean`), and list/optional-list fields are
JSON-encoded into a single `TEXT` column rather than a normalized child
table, when nothing needs to filter or sort on them at the SQL level. This
keeps one Rust row-mapping implementation working unmodified against both
`DbPool` backends, exactly as `works.genres`/`policies.library_allow`
already do.

Current tips: `backend/migrations/postgres/0034_can_download_least_privilege.sql`,
`backend/migrations/sqlite/0031_can_download_least_privilege.sql`. New
migrations below take the next free numbers on each side, keeping the
existing offset-by-3 convention between the two independent `Migrator`s
(`SQLITE_MIGRATIONS`/`POSTGRES_MIGRATIONS` in `streamarr-db::pool`).

### 2.1 Node & group identity (Phase 1)

`backend/migrations/postgres/0035_node_identity.sql` /
`backend/migrations/sqlite/0032_node_identity.sql`:

```sql
-- This node's own private state. Singleton row (fixed sentinel id, same
-- pattern as `system_settings`), deliberately its own table rather than
-- extending `system_settings`: that table is read by the public version
-- endpoint, and a private key must never be reachable from that read
-- path by a future refactor accidentally widening its query.
CREATE TABLE IF NOT EXISTS node_identity (
    id TEXT PRIMARY KEY,              -- fixed singleton row id
    peer_id TEXT NOT NULL,             -- generated once, first boot, never regenerated.
    -- Deliberately NOT named node_id: that token already means "this
    -- ephemeral process's replica identity" elsewhere in the codebase
    -- (AppState.node_id, PostgresCoordinator's node_id, see §1.1). peer_id
    -- is a distinct, durable, per-installation identity and needs a
    -- distinct name so a `grep node_id` never returns both concepts.
    -- Ed25519 seed, base64. Plain TEXT: no encryption-at-rest exists
    -- anywhere in this codebase today -- `source_instances.api_key_
    -- encrypted` is TEXT for the identical, already-documented reason
    -- (see streamarr-db/src/repo/source_instance.rs:18). This inherits
    -- that gap; it does not introduce a new one.
    private_key TEXT NOT NULL,
    group_id TEXT,                    -- NULL until this node founds/joins a group
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- One row per known group member, INCLUDING a self row (is_self = 1) so
-- every "list the whole membership picture" query (admin UI, sync fan-
-- out target list) is one query, not "self plus peer_nodes".
CREATE TABLE IF NOT EXISTS peer_nodes (
    id TEXT PRIMARY KEY,              -- this peer's peer_id (see node_identity above)
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- JSON array of {url, priority, label, client_reachable}. Not
    -- normalized into a child table: never filtered/sorted at the SQL
    -- level, same reasoning as policies.library_allow.
    addresses TEXT NOT NULL DEFAULT '[]',
    public_key TEXT NOT NULL,         -- this peer's Ed25519 public key, base64
    is_self INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'unreachable' | 'left'
    last_seen_at TEXT,
    last_sync_error TEXT,
    joined_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_nodes_group_name ON peer_nodes (group_id, name);

-- Single-use, short-TTL, admin-issued -- mirrors UserInvite's token_hash
-- shape exactly (see backend/crates/streamarr-model/src/user.rs).
CREATE TABLE IF NOT EXISTS peer_join_tokens (
    token_hash TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_by_peer_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_peer_join_tokens_expires_at ON peer_join_tokens (expires_at);
```

`backend/crates/streamarr-model/src/peer.rs` (new file):

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct NodeIdentity {
    pub peer_id: Uuid,
    /// Ed25519 seed. Never `Serialize`d into any API response --
    /// `Sensitive<T>` only redacts `Debug`/`Display` (see
    /// streamarr-model/src/sensitive.rs's own doc comment), it does NOT
    /// suppress `Serialize`, so callers must never place this on any DTO
    /// that reaches an HTTP response body, the same discipline already
    /// required of `SourceInstance.api_key_encrypted`.
    pub private_key: Sensitive<String>,
    pub group_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PeerGroup {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerNodeStatus { Active, Unreachable, Left }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PeerAddress {
    pub url: String,
    /// Lower sorts first -- same convention as SourceInstance::priority.
    pub priority: i32,
    pub label: String,          // "lan" | "wan" | "relay", informational
    /// Operator-asserted, never auto-detected (NAT/firewall topology
    /// cannot be reliably guessed -- same philosophy already used for
    /// STREAMARR_ACME_DOMAIN). Drives DeliveryMode::Auto, see §5.3.
    pub client_reachable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PeerNode {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub addresses: Vec<PeerAddress>,
    pub public_key: String,       // Ed25519, base64
    pub is_self: bool,
    pub status: PeerNodeStatus,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub last_sync_error: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

New `streamarr-db` repo traits (each a `Sqlx*Repo`, same shape as
`SqlxSourceInstanceRepo`/`SqlxUserInviteRepo`):
`streamarr-db/src/repo/node_identity.rs` (`NodeIdentityRepo`, singleton
get/put), `peer_group.rs` (`PeerGroupRepo`), `peer_node.rs`
(`PeerNodeRepo`, including `list_others()` returning every non-`is_self`
active row: the fan-out target list every later section reads),
`peer_join_token.rs` (`PeerJoinTokenRepo`, mirrors `UserInviteRepo`).

### 2.2 Sync bookkeeping (Phase 2)

`backend/migrations/postgres/0036_peer_sync_state.sql` /
`backend/migrations/sqlite/0033_peer_sync_state.sql`:

```sql
-- Durable per-(peer, entity) cursor, so a poller restart resumes an
-- incremental pull instead of re-scanning everything.
CREATE TABLE IF NOT EXISTS peer_sync_state (
    peer_node_id TEXT NOT NULL,
    entity TEXT NOT NULL,          -- 'accounts' | 'invites' | 'libraries' | 'availability' | 'routing_rules'
    cursor TEXT,
    last_synced_at TEXT,
    PRIMARY KEY (peer_node_id, entity)
);

-- Generic conflict record for every LWW-resolved entity. The losing write
-- is never silently discarded -- see §3.5.
CREATE TABLE IF NOT EXISTS sync_conflict_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,     -- 'user' | 'policy' | 'source_instance' | 'group_library' | 'routing_rule'
    entity_id TEXT NOT NULL,
    winning_peer_id TEXT NOT NULL,
    losing_peer_id TEXT NOT NULL,
    losing_value_json TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    requires_admin_review INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sync_conflict_log_review ON sync_conflict_log (requires_admin_review);

-- users/policies/source_instances have no updated_at/deleted_at today
-- (confirmed against postgres/0010_users_policies.sql -- neither column
-- exists). Both are required for LWW conflict resolution (§3.5) and for
-- soft-delete to propagate as a tombstone instead of a peer merely
-- lagging on sync looking like a delete.
ALTER TABLE users ADD COLUMN updated_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
-- Which peer's admin actually created/owns this row -- see §3.5's
-- privilege-escalation defense. Defaults to this node's own id for
-- every locally-created row; set from the origin node's claim on sync.
ALTER TABLE users ADD COLUMN origin_peer_id TEXT;
ALTER TABLE policies ADD COLUMN updated_at TEXT;
ALTER TABLE policies ADD COLUMN deleted_at TEXT;
ALTER TABLE policies ADD COLUMN origin_peer_id TEXT;
ALTER TABLE source_instances ADD COLUMN updated_at TEXT;
ALTER TABLE source_instances ADD COLUMN deleted_at TEXT;
ALTER TABLE source_instances ADD COLUMN origin_peer_id TEXT;
-- Backfill: every existing row's updated_at becomes its created_at (or
-- now() where no created_at exists), so no existing row appears
-- "just written" the moment sync turns on.
```

**Scope note, stated explicitly rather than left implicit:** adding these
columns is necessary but not sufficient. Every existing write path in
`streamarr-db::repo::{user,policy,source_instance}::Sqlx*Repo`'s
`create`/`update` methods must be audited, in the same migration's
accompanying code change, to set `updated_at` server-side on every write
(never client-supplied): otherwise pre-existing rows sync with a stale or
default timestamp and silently lose an LWW race against genuinely newer
peer data the first time sync runs. This is call-site work inside Phase 2,
not something the migration alone provides.

### 2.3 Group libraries & availability (Phase 2)

`backend/migrations/postgres/0037_group_libraries.sql` /
`backend/migrations/sqlite/0034_group_libraries.sql`:

```sql
-- Why this table exists at all: SourceInstance is the only thing an
-- operator can currently call a "library," and its id is minted
-- independently per node -- there is no value that means "the Movies
-- library" the same way on every peer. GroupLibrary is that value.
CREATE TABLE IF NOT EXISTS group_libraries (
    id TEXT PRIMARY KEY,           -- stable across the whole group
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,            -- "Movies", "TV", "Music" -- operator-defined, syncs
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Nullable: None for a SourceInstance not part of any cross-node
-- grouping, fully backward compatible.
ALTER TABLE source_instances ADD COLUMN group_library_id TEXT;

-- Additive, portable sibling to the existing policies.library_allow
-- (which stays exactly as-is -- still "this specific local
-- SourceInstance id, on whichever node evaluates this policy"). This one
-- is meaningful regardless of which group node evaluates the policy.
ALTER TABLE policies ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
```

`backend/migrations/postgres/0038_peer_leaf_availability.sql` /
`backend/migrations/sqlite/0035_peer_leaf_availability.sql`:

```sql
-- Read-only annotation of what each OTHER peer reports having, at leaf
-- (movie / episode / track / book) granularity -- not per-work, so a TV
-- series with some episodes on node A and others on node B is
-- representable. Never written for peer_node_id = self (self's own
-- availability is a live read of this node's own MediaFileRepo, not
-- cached here). Never a second writer of `works`/`media_files` -- see
-- §4.1 for why.
CREATE TABLE IF NOT EXISTS peer_leaf_availability (
    peer_node_id TEXT NOT NULL,
    provider TEXT NOT NULL,            -- ExternalProvider discriminant, reuses existing codec
    external_id TEXT NOT NULL,
    leaf_selector TEXT NOT NULL,       -- serialized LeafSelector, see §4.2
    group_library_id TEXT,
    availability TEXT NOT NULL,        -- reuses codec::availability_to_str/from_str
    container TEXT,
    codec TEXT,
    bitrate INTEGER,
    size_bytes INTEGER,
    duration_ms INTEGER,
    -- Cache of the local Work this row matches, recomputed at ingest by
    -- the same external-ref-match algorithm described in §4.2. NULL means
    -- this peer has zero local record of the title at all (the partial-
    -- cache-node case, §4.3).
    local_work_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (peer_node_id, provider, external_id, leaf_selector)
);
CREATE INDEX IF NOT EXISTS idx_peer_leaf_availability_local_work ON peer_leaf_availability (local_work_id);
```

### 2.4 Routing rules (Phase 3)

`backend/migrations/postgres/0039_routing_rules.sql` /
`backend/migrations/sqlite/0036_routing_rules.sql`:

```sql
CREATE TABLE IF NOT EXISTS routing_rules (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    group_library_id TEXT,      -- NULL = matches any library
    user_id TEXT,                -- NULL = matches any user
    priority INTEGER NOT NULL DEFAULT 0,   -- tiebreak among equally-specific matches
    -- JSON array of peer_id (peer_nodes.id), ordered most-preferred first.
    preferred_nodes TEXT NOT NULL DEFAULT '[]',
    delivery_mode TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'redirect' | 'proxy'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_group_library_id ON routing_rules (group_library_id);
CREATE INDEX IF NOT EXISTS idx_routing_rules_user_id ON routing_rules (user_id);
```

`backend/crates/streamarr-model/src/group_library.rs` (new, Phase 2):

```rust
pub struct GroupLibrary { pub id: Uuid, pub group_id: Uuid, pub name: String,
    pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc> }

/// Portable leaf identity -- never a peer-local LeafRef/Uuid, which is
/// meaningless off the node that minted it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LeafSelector {
    Movie,
    Episode { season: u32, episode: u32 },
    Track { disc: Option<u32>, track: u32 },
    Book { index: u32 },
}

pub struct PeerLeafAvailability {
    pub peer_node_id: Uuid,
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
    pub group_library_id: Option<Uuid>,
    pub availability: Availability,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub bitrate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    pub local_work_id: Option<Uuid>,
    pub updated_at: DateTime<Utc>,
}
```

`backend/crates/streamarr-model/src/routing.rs` (new, Phase 3):

```rust
pub struct RoutingRule {
    pub id: Uuid,
    pub group_id: Uuid,
    pub group_library_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub priority: i32,
    pub preferred_nodes: Vec<Uuid>,
    pub delivery_mode: DeliveryMode,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMode {
    /// Compute Redirect if the resolved peer has at least one
    /// client_reachable address, else Proxy -- per request, not a fixed
    /// choice at rule-authoring time. Default.
    Auto,
    Redirect,
    Proxy,
}
```

New `streamarr-db` repos: `group_library.rs` (`GroupLibraryRepo`),
`peer_leaf_availability.rs` (`PeerLeafAvailabilityRepo`), `routing_rule.rs`
(`RoutingRuleRepo`), `peer_sync_state.rs` (`PeerSyncStateRepo`),
`sync_conflict_log.rs` (`SyncConflictLogRepo`).

### 2.5 Invite portability (Phase 4)

`backend/migrations/postgres/0040_invite_group_fields.sql` /
`backend/migrations/sqlite/0037_invite_group_fields.sql`:

```sql
ALTER TABLE user_invites ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_invites ADD COLUMN updated_at TEXT;
-- Resolves the "invite redeemed against two peers during a partition"
-- race explicitly (§6.1) instead of leaving it to luck.
ALTER TABLE user_invites ADD COLUMN consumed_at TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_by_user_id TEXT;
ALTER TABLE user_invites ADD COLUMN consumed_by_peer_id TEXT;
ALTER TABLE user_invite_requests ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
```

`streamarr_model::UserInvite`/`UserInviteRequest` (`streamarr-model/src/
user.rs`) each gain `pub group_library_allow: Vec<Uuid>` alongside the
existing `pub library_allow: Vec<Uuid>` (unchanged), plus `UserInvite` gains
`pub consumed_at: Option<DateTime<Utc>>`, `pub consumed_by_user_id:
Option<Uuid>`, `pub consumed_by_peer_id: Option<Uuid>`.

**Deliberate simplification versus all three source proposals:** none of
this stores a snapshot of the group's address list *on the invite row
itself*. The address bundle used to build an invite link (§6.1) is computed
fresh, at issuance time, straight from `PeerNodeRepo`, and interpolated
directly into the generated URL: the row doesn't need its own copy for
correctness (the link is generated once and that's what gets shared), and
skipping it avoids one more migration column and one more thing that could
drift from the live membership table.

### 2.6 New crate: `streamarr-peer-sync`

Mirrors `streamarr-arr-sync`'s shape (one new crate, not a module bolted
onto an existing one: justified in §3.2):

```
backend/crates/streamarr-peer-sync/src/
  lib.rs
  signing.rs           // Ed25519 sign/verify, pure, no I/O
  peer_client.rs        // signed HTTP client against another peer's /api/v1/peer/*
  enroll.rs             // client-side join flow (§3.4)
  membership_sync.rs     // syncs peer_groups/peer_nodes (gossip)
  account_sync.rs        // syncs users/policies/user_invites/user_invite_requests/group_libraries
  availability_sync.rs   // syncs peer_leaf_availability
  routing_sync.rs         // syncs routing_rules
  poller.rs              // PeerSyncPoller -- one instance per known OTHER peer
```

Added to the workspace `Cargo.toml` members list alongside the other
`streamarr-*` crates.

---

## 3. Node-to-node sync protocol

### 3.1 What syncs vs. what stays local

| Syncs across the group | Stays node-local |
|---|---|
| `peer_groups` / `peer_nodes` (membership, gossip) | Local runtime state and peer-sync cursors |
| `users` (incl. `password_hash`: already a hash, replicating it is exactly what makes a password valid on every node), `policies` | `Device`, `Session` rows (bound to wherever the login happened) |
| `user_invites`, `user_invite_requests` | `RefreshTokenRecord` / refresh-token families: explicitly not synced, §3.7 |
| the managed-profile PIN table backing `ProfilePinRepo` (so PIN login works from any node) | RFC 8628 `DeviceAuthorization` pending state: explicitly not synced, §3.8/§6.3 |
| `group_libraries`, `routing_rules` | `Work`, `MediaFile`, `Rendition` rows themselves: explicitly not synced, §4.1 |
| complete `source_instances` rows, including connection configuration and tombstones | `MediaFile.path` (filesystem path, meaningless/sensitive off-node) |
| `peer_leaf_availability` (derived, read-only per peer) | `WatchProgress`, playback analytics, `TranscodeSession`/`cluster_leader` (Tier-2/3-local coordination, unrelated axis) |

### 3.2 Why a new crate, not a module in `streamarr-arr-sync`

`ReconciliationPoller`/`SyncOp` are keyed to a single source's `Work` diff
against one *arr app and have zero dependency on `streamarr-auth`/user or
policy tables today. Peer sync diffs several distinct entity classes,
including auth-sensitive ones (`users`, `policies`), against a *different
node's own database*, under a genuinely different trust and conflict model
per entity (plain LWW for most, an `origin_peer_id`-gated rule for
privilege-bearing `Policy`/`User` fields: §3.5): folding that into a
crate whose only job today is "poll *arr apps" would give it an
auth-sensitive dependency graph it doesn't need for anything else. The new
crate's **shape** is copied 1:1 from `ReconciliationPoller`, including reuse
of the existing `streamarr_arr_sync::poller::{SyncRunStatus,
SyncStatusReporter}` types (implemented a second time by `PeerSyncPoller`,
not modified) so the admin "sync status" concept extends rather than
forking.

### 3.3 Node-to-node authentication

**Chosen: per-peer Ed25519 request signing.**

- *Rejected: a single group-wide shared secret.* A leak on any one member
  grants write-access to every other member's sync-ingest endpoints, and
  cannot be revoked for just the compromised node without rotating the
  whole group's secret (and every honest node re-distributing it).
- *Rejected: mutual TLS.* Requires every self-hosting operator to run a
  private CA and distribute client certs to a reverse proxy they may not
  fully control (Caddy/Nginx/Cloudflare Tunnel are all common in front of
  a Streamarr install): real operational cost this project's own stated
  config philosophy ("zero surprise precedence rules," `streamarr-config`'s
  module doc) does not want to impose for a threat model that's a handful
  of personally-run boxes, not a fleet.
- **Chosen:** each request to `/api/v1/peer/*` is signed by the caller's
  own `node_identity.private_key` over `method|path|sha256(body)|
  timestamp|nonce`, with `X-Streamarr-Peer-Id: <caller peer_id>` naming the
  claimed signer. The receiver looks up that id's `public_key` in its own
  `peer_nodes` table and verifies. A compromised peer can only forge
  requests *as itself*; revocation is `peer_nodes.status = 'left'` on every
  honest node (checked in addition to a valid signature), needing no
  secret rotation anywhere else in the group.

New extractor `streamarr-api/src/peer_extractor.rs::PeerSignedRequest`,
structurally parallel to `auth_extractor.rs`'s bearer-JWT extractors: rejects with 401 before the handler body runs.

### 3.4 Join / leave: concrete, synchronous, admin-driven

No background auto-discovery, no gossip-only bootstrapping. Every step is
one HTTP call an admin makes and watches succeed or fail.

**Founding a group** (node A, first node):
1. `PUT /api/v1/admin/peer-nodes/self` (`AdminUser`-gated): sets `name` +
   `addresses` (each with its own `client_reachable` flag). `addresses` may
   be empty for an outbound-only node; it initiates pull and push exchanges
   through another member rather than accepting inbound sync.
2. `POST /api/v1/admin/peer-groups` `{name}`: generates the Ed25519
   keypair (if this node has none yet) + `peer_id`, writes `node_identity`
   + `peer_groups` + a self row (`is_self = 1`) into `peer_nodes`.

**Joining** (node B, into A's group):
1. Admin on **A**: `POST /api/v1/admin/peer-groups/join-tokens` → raw
   token returned once, 15-minute default TTL, single-use.
2. Admin on **B**: `PUT /api/v1/admin/peer-nodes/self` (name + optional addresses),
   then `POST /api/v1/admin/peer-groups/join {seed_address, join_token}`.
3. B calls **A**: `POST /api/v1/peer/enroll {join_token, peer_id, name,
   addresses, public_key}`: trying each address in `bootstrap_addresses`
   (today, just `seed_address`; multiple only matters once B already knows
   more than one way to reach A) in order until one connects. This is the
   first appearance of the multi-address-fallback pattern §7 later builds
   for clients.
4. A validates the token (unexpired, unused, hash match) and name
   uniqueness within the group, marks it redeemed, inserts B's row into
   `peer_nodes`, and replies `{group: PeerGroup, members: Vec<PeerNode>}`:    the **full current membership**, so B does not have to wait for its
   first sync pass to learn about a third peer that already joined.
5. B persists `group_id` into its own `node_identity`, and upserts A plus
   every member A told it about into its own `peer_nodes`.
6. From here, `PeerSyncPoller`'s membership sync (§3.6) converges any
   further membership changes symmetrically. Every node pulls normally and
   also publishes its locally changed pages through the signed push exchange,
   so a node with outbound-only connectivity can still synchronise both ways.

**Leaving this node**: `DELETE /api/v1/admin/peer-groups/self` notifies
each reachable member through signed `DELETE /api/v1/peer/nodes/{id}`
requests, then clears the local `node_identity.group_id`, removes local
group-scoped metadata, and returns JWT issuance to standalone HS256. The
durable peer id/keypair is retained, and the node's name/addresses are
staged so it can create or join another group immediately. Unreachable
peers do not block local detachment; the response reports how many peers
could not be notified.

**Removing another member** remains a separate administrator operation.
On the receiving peers, a leave notification sets `status = 'left'`.
Membership gossip honours each row's `updated_at`, so an older `active`
copy cannot resurrect a newer leave tombstone.
`RoutingRule.preferred_nodes` entries pointing at a left node are skipped
at evaluation time (§5.2), never auto-rewritten: an admin edits the rule
explicitly. Local users, source instances, and media are never deleted by
leaving. Re-running a failed join is safe: it's idempotent by peer identity
(`peer_nodes.id`).

### 3.5 Consistency model and conflict resolution

Eventually-consistent, **push-and-pull**, poll-as-truth: the same spirit as
`ReconciliationPoller`, generalized because (unlike arr-sync, where one
*arr app is the single source of truth per row) **any** peer can be the
origin of a write to `users`/`policies`/`user_invites`/`group_libraries`/
`routing_rules`. Every sync pass is `GET .../since=<cursor>` (cursor
persisted in `peer_sync_state`), diffed into upserts applied via the
target repo: always an upsert keyed by stable id, never a delete inferred
from absence (a peer merely lagging on sync must never look like a
delete). Re-applying the same page twice is a no-op, so a page whose
response was lost and retried is safe.

- **Plain last-writer-wins by `updated_at`** (server-set, never
  client-supplied: see §2.2's scope note) for `users`, `policies`,
  `source_instances`, `group_libraries`, `routing_rules`, `user_invites`.
  This assumes loosely-synced clocks (NTP) across peers, stated explicitly
  rather than silently relied on.
- **The losing write is never silently discarded.** Every LWW resolution
  writes a `sync_conflict_log` row (§2.2), surfaced on a new admin "Sync
  Conflicts" page. The system picks a deterministic winner and hands the
  loser to a human: it never attempts to *merge* two concurrent edits.
- **Privilege-bearing fields get a stricter rule than plain LWW.** `User`/
  `Policy` rows carry `origin_peer_id`: the peer whose admin actually
  created the row. Non-privileged fields (`display_name`, playback
  preferences, …) apply via ordinary LWW from any peer. Privilege-bearing
  fields (`is_admin`, `can_stream`, `can_download`, `can_delete`,
  `can_share_public`, `library_allow`, `group_library_allow`,
  `device_allow`, `access_schedule`) **only auto-apply when the incoming
  write's `origin_peer_id` matches the row's already-known origin**; a
  privilege change claiming to come from a non-origin peer is written to
  `sync_conflict_log` (`requires_admin_review = 1`) and **not applied**.
  Concretely, this is the defense against "a compromised peer must not be
  able to escalate privilege": escalating a different peer's user would
  require forging that peer's signature (§3.3, already infeasible without
  its private key), and even a legitimately-owned row's privilege fields
  cannot propagate through a third, uninvolved peer without review.
- **`UserInvite` double-redemption.** Two people redeem the same token
  against two different peers during a partition. Each peer enforces
  single-use locally at redemption time (no double account creation on one
  peer); if two `consumed_at` values for the same `token_hash` later
  disagree during sync, the earliest wins. The losing peer's already-
  created account is **never auto-deleted**: it is `disabled = true` with
  a reason and logged to `sync_conflict_log` for manual reconciliation.

### 3.6 `PeerSyncPoller` and endpoints

One `PeerSyncPoller` instance per non-self row in `peer_nodes`, default
interval `STREAMARR_PEER_SYNC_INTERVAL_SECS=60` (new, optional config var,
`streamarr-config`), spawned from `backend/src/main.rs`. Each poller wraps
its pass in `coordinator.try_lock(&format!("peer-sync:{peer_id}"), ttl)`: exact reuse of the pattern `streamarr-arr-sync` already uses for
`"arr-sync:<source_instance_id>"`: so a peer node that is itself internally
Tier-2/3-scaled never double-polls the same remote peer. On failure, the
poller tries the next address in that peer's `addresses` list before giving
up the cycle; after `STREAMARR_PEER_UNREACHABLE_THRESHOLD` (default 3)
consecutive full-cycle failures, that peer's `status` flips to
`unreachable`. Already-synced data is left as-is (stale, not discarded): the same best-effort philosophy `arr-sync`'s `best_effort` flag already
encodes.

The API role also runs one outbound push pass on the same interval. It sends
all entity pages changed since that target peer's durable `push` cursor, plus
full membership and availability snapshots, to the first reachable address.
The receiver applies those pages through the same merge functions and normal
per-entity cursors used by pull. Consequently, if node B can dial node A but A
cannot dial B, B pulls A's changes and pushes B's changes over B-initiated
connections; no reverse tunnel or hosted broker is required.

Signed peer request bodies have a 64 MiB ceiling. This is deliberately above
Axum's general 2 MiB default because the first aggregate push can contain
thousands of availability rows, while retaining a finite allocation bound for
requests from known peers.

Inbound endpoints, `streamarr-api/src/peer.rs` (new file), all
`PeerSignedRequest`-gated except `enroll` (bearer is the one-shot join
token instead):

| Method + path | Returns |
|---|---|
| `POST /api/v1/peer/enroll` | join handshake (§3.4) |
| `GET /api/v1/peer/nodes` | full `peer_nodes` (small; always full-refresh gossip) |
| `GET /api/v1/peer/accounts?since=` | `{users, policies}` upserts/tombstones |
| `GET /api/v1/peer/invites?since=` | `user_invites`/`user_invite_requests` rows |
| `GET /api/v1/peer/libraries?since=` | complete `source_instances` rows + `group_libraries`; connection secrets are confined to this authenticated, signed peer endpoint |
| `GET /api/v1/peer/availability?since=` | this peer's own `peer_leaf_availability`-shaped rows, derived live from its own `MediaFileRepo` |
| `GET /api/v1/peer/routing-rules?since=` | `routing_rules` rows |
| `POST /api/v1/peer/sync-push` | applies the caller's incremental entity pages through the normal pull merge rules |

Each response is `{rows: [...], server_time: <next cursor>}`: a standard
cursor-polling shape, `server_time` persisted into `peer_sync_state.cursor`
on success only.

Admin/observability surface: `GET /api/v1/admin/peer-nodes` (list, incl.
self), `GET /api/v1/admin/peer-nodes/{id}/sync-status`
(`SyncRunStatus`, §3.2), a "Peers" admin page (name/status dot/addresses/
`last_seen_at`/`last_sync_error`/rotate-key/remove) and a "Sync Conflicts"
page reading `sync_conflict_log`.

### 3.7 Refresh tokens are explicitly not synced

`POST /api/v1/auth/refresh` (`streamarr-api/src/refresh.rs`) already
rotates a durable, DB-backed opaque token (`SqlxRefreshTokenRepo`,
confirmed wired at `backend/src/main.rs:919-920`: **not**
`InMemoryRefreshTokenStore`; that in-memory store exists only for tests,
per its own doc comment). This design deliberately does not attempt to
replicate `refresh_token_families` across peers: syncing rotate-on-use
tokens with reuse-detection across independently-written, eventually-
consistent databases is the single hardest true-multi-writer problem in
this design, and building it is not required to ship anything else here.
Instead (mirrored client-side in §7.2): a refresh failure against the peer
that issued the session retries the **same** refresh token against the
next remembered address; only once every remembered address has failed
does the client fall back to a full login: which still only ever
re-prompts for **credentials**, never a server address, once a group is
known. This is a stated, honest limitation, not a silent gap: a session
started on a since-partitioned peer degrades to re-login rather than
transparently failing over, until (and unless) a future pass takes on
synced refresh-token families as its own scoped problem.

### 3.8 Device-authorization state is explicitly not synced

Same reasoning, narrower stakes: `InMemoryDeviceAuthorizationStore`/
`DashMapDeviceFlowHandler` (confirmed genuinely in-process-only, no
persistence: §1.1) stays exactly as it is; this design does not add a
`Sqlx*` implementation or wire it into `PeerSyncPoller`. RFC 8628 device
codes are short-lived (10-minute TTL) and security-sensitive; a ~60s poll
cadence is a bad fit for "the approving human is standing there waiting."
§6.3 covers the narrow alternative that replaces syncing this state
outright: one small server-side addition (embedding the group's address
bundle on the pairing artifact) plus client-side fan-out, not state sync.

### 3.9 JWT trust across a group

Deferred to §5.4, since it only matters once `Redirect` delivery (§5.3)
needs a token minted by one peer to verify on another: until Phase 3, no
change to `streamarr-auth/src/jwt.rs` is required.

---

## 4. Content aggregation & availability model

### 4.1 Why `Work`/`MediaFile` stay strictly node-local

Each peer already independently reconciles its own catalog from its own
*arr instances via `ReconciliationPoller` (poll-as-truth, single writer per
row). Two peers cataloguing "Sample Movie Kilo (1999)" each mint their **own**
local `Uuid` via `new_work` in `poller.rs`, but both carry the same
`ExternalRef{Tmdb, "603"}`: that ref, not `Work.id`, is the only thing
portable across peers.

This design deliberately does **not** replicate `Work` rows peer-to-peer
(rejecting the approach one of the source proposals took): doing so would
make `PeerSyncPoller` a second writer of the same local `works` table that
`ReconciliationPoller`'s own diff already owns exclusively. Concretely,
`ReconciliationPoller`'s `SyncOp::Delete` path fires when a title has left
*this node's own* *arr instance listing: if a peer-synced copy of that
same title sits in the local table with no matching origin, that diff
would try to delete it the next time it runs a full pass, racing directly
against whatever just wrote it in from a peer. Making that safe needs a
"which rows does arr-sync's delete pass actually own" scoping change that
this design does not want to make foundational to shipping routing. Keeping
`Work`/`MediaFile` single-writer, node-local, and **read-only** to peer
sync avoids the problem outright.

### 4.2 The portability layer: external refs + `LeafSelector`

`ExternalRef`/`ExternalProvider` (`streamarr-model/src/work.rs`) are
already a stable, dedup-able cross-source key. The existing client-side
precedent, `clients/tv-web/web/src/lib/joinedServers.ts`'s
`workIdentityKeys`/`fallbackIdentity` (matching by external ref, falling
back to normalized-title + release-year when a title genuinely has none),
already implements exactly this matching in the browser to merge two
manually-joined servers' catalogs today. `availability_sync.rs` ports that
same algorithm server-side: for each row a peer reports via `GET /api/v1/
peer/availability`, the ingesting node resolves `(provider, external_id)`
against its own `WorkRepo`, writing the match (or `NULL`) into
`peer_leaf_availability.local_work_id`. Client and server now agree on
what "the same title" means, using one algorithm, not two independently
maintained ones.

Leaf identity (`LeafRef::Episode(Uuid)` etc.) is peer-local the same way
`Work.id` is: the wire format never carries one. `LeafSelector` (§2.4) is
the portable substitute: `Movie`, `Episode{season, episode}`,
`Track{disc, track}`, `Book{index}`. A receiving peer resolves
`(provider, external_id, LeafSelector)` against its own child rows to get
its own `LeafRef`/`media_file_id`: it never adopts a sender's id.

### 4.3 Catalog API changes

`streamarr-catalog::CatalogService` (`browse`/`get_by_id`,
`streamarr-catalog/src/lib.rs`) gains a hydration step: for each returned
`Work`, join `peer_leaf_availability` on `local_work_id` and attach:

```rust
// streamarr-api/src/catalog.rs, new DTO
pub struct AvailabilityBadge {
    pub peer_node_id: Uuid,
    pub peer_name: String,
    pub availability: Availability,
    pub updated_at: DateTime<Utc>,
}
// WorkDetail / CatalogPage items gain:
pub available_on: Vec<AvailabilityBadge>,
```

computed by an index-backed join, not a live fan-out to peers per browse
request: the whole point of pre-syncing availability rather than
querying peers synchronously on every catalog read, which would not
survive a slow or partitioned peer gracefully.

**The partial-cache-node case** (a node with *zero* local record of a title
that a full peer holds): `browse_catalog_handler`/`search_catalog_handler`
additionally union in `peer_leaf_availability` rows where
`local_work_id IS NULL`, presented as a distinct, clearly-tagged shape: not a fabricated local `Work.id`:

```rust
pub struct RemoteOnlyWork {
    pub provider: ExternalProvider,
    pub external_id: String,
    pub title: String,
    pub kind: WorkKind,
    pub release_date: Option<String>,
    pub available_on: Vec<AvailabilityBadge>,
}
```

Because such an item has no local `media_file_id` to key a playback request
off, initiating playback from one goes through a dedicated entry point
rather than overloading the existing one: see §5.2's `POST
/api/v1/playback/by-external-ref`. This is the concrete answer to a gap
none of the three source proposals fully closed: two of them (favoring the
node-local-`Work`-only design this document also adopts) never specify how
a client requests playback of a title it can browse but has no local
identifier for; this design gives that path its own explicit endpoint
rather than leaving it implicit.

---

## 5. Per-library / per-user routing

### 5.1 Why `GroupLibrary`, not a raw `SourceInstance.id`

`Policy.library_allow: Vec<Uuid>` and a naive `RoutingRule` referencing a
`SourceInstance` id directly both break the moment they cross a node
boundary: `SourceInstance.id` is minted independently per node (each of
"2 remote instances with full copies" runs its own Sonarr with its own
UUID for what an operator calls the same library). A `RoutingRule` created
on node A that names node A's own `SourceInstance` id would silently match
nothing when evaluated on node B. `GroupLibrary` (§2.3) fixes this: a
stable, group-wide id an operator maps each node's own `SourceInstance`
onto via `SourceInstance.group_library_id`. `RoutingRule.group_library_id`
and `Policy.group_library_allow` are expressed once, portably, at that
level; the existing `Policy.library_allow`/per-`SourceInstance` grant stays
available unchanged for the narrower case of granting only one of two
`SourceInstance`s backing the same `GroupLibrary` (e.g. a 4K vs. 1080p
pair). `ensure_library_allowed` (`streamarr-api/src/auth_extractor.rs`)
gains one extra step: resolve `group_library_allow` to local
`SourceInstance` ids (via a new `SourceInstanceRegistry` lookup by
`group_library_id`) before comparing, unioned with the existing
`library_allow` check: everything else in that function is unchanged.

### 5.2 Evaluation point, and why the whole negotiation must move, not just the URL

`playback_info_handler` (`streamarr-api/src/playback.rs:750`) gets a new
step immediately after its existing `ensure_library_allowed` check and
**before** its existing direct-play/rendition/transcode-negotiation logic
(`can_direct_play` and everything downstream). This ordering is load-
bearing, not stylistic: `resolve_media_path`'s own design assumption is
"Streamarr co-located with its media," and transcoding, HLS rendition
selection, and on-demand `ffmpeg` spawning are all inherently tied to
whichever process can see the file on disk. **A routing decision that only
swapped the final stream URL while continuing to run the entry node's own
negotiation logic locally would be silently wrong**: the entry node has no
file to probe and no encoder output to serve for content it doesn't hold.
So when routing resolves to a different peer, the **entire** negotiation
request is forwarded: via the signed `streamarr-peer-sync::peer_client`: to that peer's own `playback_info_handler`, and its response (already
correct, because that peer *does* have the file) is what gets returned or
redirected to.

```rust
// streamarr-api/src/routing.rs, new file
pub struct RoutingContext {
    pub group_library_id: Option<Uuid>,
    pub user_id: Uuid,
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
}

pub enum RoutingDecision {
    ServeLocally,
    Delegate { peer_node_id: Uuid, delivery: DeliveryMode },
    Unavailable,
}

pub fn resolve_route(
    rule: Option<&RoutingRule>,   // most specific match: (library, user) > user > library > none
    self_peer_id: Uuid,
    peers: &[PeerNode],
    availability: &[PeerLeafAvailability],
) -> RoutingDecision { /* five-step resolution below */ }
```

No matching rule, or an empty `preferred_nodes` list, resolves to
`ServeLocally`: byte-for-byte today's existing behavior, zero change for
a single, ungrouped node.

**Resolution order** (adopted for being the most complete of the three
source proposals' treatments: it is the only one of the three that fully
answers "gracefully fall back when a preferred peer is temporarily
unreachable," which every proposal was asked to address):

1. Select the most specific matching `RoutingRule`: `(group_library_id,
   user_id)` > `(user_id, None)` > `(group_library_id, None)` > no rule:    tie-broken by `priority`.
2. Walk `preferred_nodes` in order, skipping any peer with `status != Active`.
   For each remaining candidate, check `peer_leaf_availability` for
   `Available`/`PartiallyAvailable` for this specific leaf; if that row is
   older than a freshness window (default matches the arr-sync poll
   cadence, ~15 min: staleness alone doesn't disqualify, it might just be
   a slow poll, not a partition), do a short-timeout live probe before
   committing. A failed probe records the peer in a short in-process
   cooldown (mirrors the existing `SourceInstanceRegistry`'s in-memory,
   per-instance bookkeeping: no new persistence needed) and moves to the
   next candidate.
3. If every explicitly preferred peer is unreachable or lacks the file,
   fall back to **the entry node itself**, if it has the file locally:    never make a client wait on routing preference when the node that
   already received the request could just serve it.
4. If the entry node doesn't have it either, fall back to **any other
   known, active peer** reporting availability, same probe-and-skip logic,
   in `peer_nodes` declaration order.
5. If literally no peer (including self) reports availability:
   `RoutingDecision::Unavailable` → a distinct `ApiError::no_peer_available`
   (not a generic 404), so clients can render "not currently available on
   any server" rather than a confusing not-found.

**The `by-external-ref` entry point** (§4.3): `POST
/api/v1/playback/by-external-ref {provider, external_id, leaf_selector,
group_library_id}`, new handler in `playback.rs` alongside
`playback_info_handler`, runs the identical routing evaluation above from a
`RoutingContext` built directly from the request body instead of from a
resolved local `media_file_id`: used only when the client's starting point
was a `RemoteOnlyWork` badge with no local id to call the normal endpoint
with. It always resolves to `RoutingDecision::Delegate` or `Unavailable`,
never `ServeLocally` (a node with zero local record of the title can't
serve it), and forwards exactly the same way step 2 above does.

### 5.3 Redirect vs. proxy

Decided per-request by `DeliveryMode` (§2.4), using `PeerAddress.
client_reachable` (§2.1) as the deciding signal: operator-asserted, never
auto-detected, matching the same explicit-operator-input philosophy already
used for `STREAMARR_ACME_DOMAIN`.

- **`ServeLocally`**: unchanged: `stream_media_handler`
  (`streamarr-api/src/media.rs`) serves the local path via `ServeFile`,
  exactly as today.
- **`Redirect`**: the resolved `PlaybackInfoResponse.url` becomes an
  absolute URL at the target peer's own client-reachable address. Best
  bandwidth (no double hop); requires the client to reach that peer
  directly. Depends on §5.4's cross-node JWT trust so the client's
  existing bearer token verifies at the new peer with no second login.
- **`Proxy`**: the entry node's `stream_media_handler` gains a passthrough
  path: an authenticated (`PeerSignedRequest`), `Range`-header-preserving
  `GET` to the target peer's own stream endpoint, piping the response body
  straight through (`axum::body::Body::from_stream`) and passing its
  `206`/`Content-Range` back unchanged so seeking is preserved end-to-end.
  Works even when the client cannot reach the target peer directly; costs
  double-hop bandwidth on the entry node. Uses a `reqwest::Client` held on
  `AppState` (new field, `AppState.peer_http`), reused across requests for
  connection pooling.
- **`Auto`** (default) computes `Redirect` if the resolved peer has at
  least one `client_reachable = true` address, else silently downgrades to
  `Proxy` for that request: the admin only has to get each address's
  reachability flag right once; delivery mode falls out automatically
  per request rather than needing a correctly-matched static choice per
  rule that a misconfiguration could quietly break.

**Defense in depth on the `Proxy` path**: the entry node's forwarded
request to the owning peer carries the acting user's id and library grant,
but the **owning peer independently re-checks that user's policy against
its own synced copy of `Policy`/`group_library_allow` before serving a
single byte**, rather than trusting the entry node's forwarded assertion.
Combined with §3.5's `origin_peer_id` rule, this is the second concrete
defense against "a compromised peer must not be able to exfiltrate data
from the rest of the group": a compromised entry node can request proxied
playback on a user's behalf, but only for content that user is
independently entitled to per the owning peer's own state, never more.

**Flagged as the highest-risk new runtime behavior in this whole design**:
the `Proxy` path's `Range`-request passthrough correctness, connection
reuse for `AppState.peer_http`, and timeout/backpressure behavior need the
most test coverage of anything specified here: called out explicitly so
Phase 3's test plan budgets for it rather than treating it as "just a
reqwest call."

### 5.4 Cross-node JWT trust

`AccessTokenClaims` (`streamarr-auth/src/jwt.rs`) already carries an `iss`
field; `JwtIssuer` today issues and verifies HS256 (confirmed: "Issues and
verifies HMAC-signed (HS256) access tokens... for a symmetric algorithm,
[encoding and decoding key are] the same secret"). A shared secret across a
group would mean any compromised peer could forge tokens for any user
against any peer: unacceptable under this design's own threat model (same
reasoning as §3.3). Once grouped, `JwtIssuer` gains an EdDSA mode, reusing
each peer's **existing** Ed25519 `node_identity` keypair: the same key
already used for peer-to-peer request signing (§3.3), not a second key to
manage. `iss` becomes the issuing peer's `peer_id`; a verifying peer looks
up that id's `public_key` from its own (synced) `peer_nodes` table instead
of consulting a shared secret. Payoff: a client's existing access token,
once minted by any peer, is already verifiable by every other member: `Redirect` needs no token exchange at all. HS256 stays the unconditional
default for a standalone, ungrouped node (`node_identity.group_id.is_none
()`): zero behavior change there.

---

## 6. Invite + device-pairing multi-address changes

### 6.1 Invites

Today, `clients/tv-web/web/src/pages/settings/Invite.tsx`/`admin/src/pages/
Users.tsx` client-side string-interpolate `https://playarr.app/signup?
server=<apiBaseUrl>&invite=<token>`, parsed by
`clients/tv-web/web/src/lib/signupInvite.ts::parseSignupInvite` into a
single `{serverUrl, inviteToken}` (confirmed against the current file).
That single-address shape is exactly what a multi-peer group breaks.

New backend endpoint, `streamarr-api/src/admin_peer.rs`: `GET
/api/v1/admin/peer-groups/self/address-bundle` (`AdminUser`-gated),
returning:

```rust
pub struct PeerAddressBundle {
    pub group_id: Option<Uuid>,     // None for a standalone deployment
    pub group_name: Option<String>,
    pub urls: Vec<String>,          // every active member's client_reachable addresses, priority-ordered
}
```

For a non-grouped deployment this returns a single-URL bundle (this node's
own address): **one code path**, not a grouped/ungrouped branch, in every
caller. Invite-link/QR builders call this at link-build time instead of
reading `apiBaseUrl` directly.

`signupInvite.ts` changes:

```ts
export interface SignupInvite { serverUrls: string[]; inviteToken: string; }
export function parseSignupInvite(search: string): SignupInvite | null {
  const params = new URLSearchParams(search);
  const inviteToken = params.get("invite")?.trim();
  const bundled = params.get("servers"); // base64url(JSON string[])
  const serverUrls = bundled
    ? safeDecodeServerList(bundled)
    : [params.get("server")?.trim()].filter((s): s is string => !!s); // legacy single-address links, kept working
  if (!serverUrls.length || !inviteToken) return null;
  return { serverUrls: serverUrls.filter(isValidHttpUrl), inviteToken };
}
```

The new query param is `servers=` (plural, base64url-encoded JSON array);
the legacy singular `server=` continues to be read as a one-element list,
so links already generated by, or cached in, an out-of-date TV client
bundle keep working: a deliberate backward-compatibility choice this
design makes explicitly, since TV app bundles are the hardest client
surface to force an update on.
`clients/tv-web/web/src/pages/Signup.tsx` tries `serverUrls` in order (short
per-attempt timeout) and, on first success, remembers the **whole list**
into the same known-servers store §7 introduces (not just the one that
answered), reordered so the winner tries first next time.

### 6.2 `UserInvite`/`UserInviteRequest` model changes

Covered in §2.5. Invite-creation call sites in `streamarr-api` (wherever
`admin.rs`/`users.rs` build a `UserInvite` today) additionally populate
`group_library_allow` from the same admin-selected grants that populate
`library_allow`, mapped through `SourceInstance.group_library_id` where
one exists.

### 6.3 Device pairing

RFC 8628 issuance stays a per-peer concern (`POST /api/v1/oauth/device/
code`, `streamarr-api/src/oauth.rs`): some one peer has to generate and
hold the `device_code`/`user_code` pair, and §3.8 already established that
pending-authorization state itself is not synced. What changes is what
that one peer tells both ends about the *group*, not the pairing state:

- The **Android TV client** requests its visible QR/manual code from the
  hosted `playarr.app` Durable Object broker, so first contact needs no
  Streamarr address. After the browser claims that code with its selected
  profile, Android receives a single-use per-peer device code and the
  profile's address bundle, then redeems directly against Streamarr. Other
  TV clients continue to try their remembered addresses in order.
- **`request_verification_uri`** (`streamarr-api/src/oauth.rs:122`)
  changes: the device-code response's `verification_uri_complete` now
  embeds a `PeerAddressBundle` (§6.1, reused as-is) via the identical
  `servers=` query param the invite flow already uses, built from the
  issuing peer's own `peer_nodes` table at response time. For a
  standalone node this is a one-element bundle, byte-for-byte the same
  URL shape as today: the "additive and inert for a single, ungrouped
  node" invariant stated at the top of this document holds here too.
  `verification_uri` (the short form, meant for on-screen display or
  manual typing) stays a plain URL, unchanged; only the QR-encoded
  `_complete` form carries the bundle, mirroring §6.1's `server=`-vs-
  `servers=` split exactly.
- The **approving human's device** reads that bundle straight off the
  scanned/opened link (`/link?user_code=...&servers=...`) and tries
  **those** addresses for `POST /api/v1/oauth/device/authorize
  {user_code}` **in parallel**, not sequentially: approval has to beat an
  impatient human, it can't wait out sequential timeouts. This is what
  makes pairing work even from a device that has never talked to this
  group before at all (a guest's phone, a different household member's
  browser with a stale local cache) — literally satisfying "the QR code
  encodes the multiple server addresses, and as long as one of them
  connects, it's fine," rather than depending on the approver already
  having synced group knowledge of its own. If `servers=` is absent (an
  old cached client bundle, or a pre-upgrade peer that hasn't shipped
  this change yet), the approver falls back to fanning out to its own
  remembered group (§7) instead — kept as the compatibility path, not the
  primary mechanism. Exactly one peer recognizes the `user_code` and
  succeeds regardless of which addresses were tried; the rest 404
  harmlessly. Client-only change (`DeviceLink.tsx` and native
  equivalents, §6.4), no new server endpoint beyond the `oauth.rs` change
  above.
- The prior first-contact server-entry requirement is removed for Android
  TV by the narrowly scoped hosted broker. Manual address entry and
  `streamarr-config.json` remain compatibility paths for clients that have
  not adopted hosted pairing; once any client receives a Streamarr device
  response, the full group bundle still travels with the artifact and is
  remembered locally.

### 6.4 Native client mirrors

The same multi-address shape (§7's `knownServers`) needs an equivalent on
every non-web client. Confirmed real files, current single-address
implementations:

- **Android**: `clients/android/core-auth/src/main/kotlin/io/streamarr/
  shared/auth/DeviceAuthClient.kt`.
- **iOS**: `clients/ios/Sources/StreamarrApp/LoginServerURL.swift` (server
  entry) and `clients/ios/Sources/StreamarrKit/Auth/DeviceFlowClient.swift`
  (device pairing).
- **Apple TV** (`clients/apple-tv/`: a distinct target from `clients/ios/`
  in this repo, not the same codebase): `clients/apple-tv/Sources/
  TVAppEnvironment.swift` and `TVSettingsView.swift`.
- **Roku** (`clients/roku/`: a genuinely thinner client: flat BrightScript
  files, `Api.brs`/`Config.brs`/`Storage.brs`/`main.brs`, no equivalent
  yet of the richer retry/fan-out layers the other clients have): the
  single-address value currently persisted in `Storage.brs` and read by
  `Config.brs` becomes a small ordered list with the same "try next on
  failure" behavior. Given the platform's constraints, full parity with
  the JS/Kotlin/Swift retry logic (§7.2) is out of scope for Phase 5 itself
  and is noted as the natural next client to bring up to parity once the
  core protocol is proven on the richer clients.

Each mirrors the same logic as §7, not a platform-specific reinvention:
remember a list, not one URL; fast-path the most-recently-successful
address; retry across the list before ever re-prompting; only ever
re-prompt for credentials, never for an address, once a group is known.
Persistence differs per platform (SharedPreferences / Keychain /
`localStorage` / Roku's registry-backed `Storage.brs`).

---

## 7. Client auth UX

### 7.1 Remembered group of addresses, not one address

New module `clients/tv-web/packages/domain/src/knownServers.ts`, replacing
the single `streamarr:apiBaseUrl` localStorage key:

```ts
export interface KnownServer { url: string; lastSuccessAt?: number }
export interface KnownServerGroup {
  groupId?: string;              // absent for a standalone server
  groupName?: string;
  servers: KnownServer[];        // priority-ordered
  lastGoodUrl?: string;          // fast path: tried first, skips a probe round trip
}

export function readKnownServers(): KnownServerGroup | undefined;
export function rememberGroup(group: KnownServerGroup): void;
export function rememberServerSuccess(url: string): void;   // bumps lastSuccessAt, updates lastGoodUrl
export function forgetGroup(): void;                         // explicit manual reset -- the only recovery
                                                               // path if a group becomes fully defunct
export async function resolveReachableServer(
  group: KnownServerGroup,
  probe: (url: string) => Promise<boolean>   // e.g. GET /api/v1/health, short AbortController timeout
): Promise<string>;   // tries lastGoodUrl first, then servers[] in order; throws only if every address failed
```

**Self-healing**: every login/refresh response (`streamarr-api/src/
{login,refresh}.rs`) gains an optional `peer_addresses:
PeerAddressBundle | null` field (§6.1's type, reused: cheap to attach). The
client writes it straight into `KnownServerGroup` on every successful
call, so the remembered list picks up newly added or removed peers without
a separate "refresh my address book" round trip, while `forgetGroup()`
remains the explicit manual escape hatch if a group is abandoned entirely.

### 7.2 Refresh-before-reprompt

`ensureAccessToken` (`clients/tv-web/packages/device-auth/src/session.ts`)
gains optional parameters, backward compatible with every existing
single-`ApiClient` call site:

```ts
export interface EnsureAccessTokenOptions {
  forceRefresh?: boolean;
  serverGroup?: KnownServerGroup;
  clientForUrl?: (url: string) => ApiClient;   // rebind mid-retry to a different address
}
```

When `serverGroup`/`clientForUrl` are supplied, a refresh failure against
the current server retries the **same** refresh token against the next
`resolveReachableServer` candidate before giving up (§3.7's client-side
half); only once every remembered address has failed does it fall through
to a full login: which, per §7.3, still only ever asks for credentials.

### 7.3 Where a server address is asked for at all

`loginServerUrl.ts::initialLoginServerUrl` currently blanks the field
unconditionally on the hosted `playarr.app` build ("a previously selected
server is never presented as a default"), written before any remembered-
group concept existed. Updated condition: blank only when there is
**neither** a legacy `apiBaseUrl` **nor** a remembered `KnownServerGroup`.
`ApiClientProvider.tsx`'s `resolveInitialApiBaseUrl` becomes group-aware
first (read `knownServers`, call `resolveReachableServer`); only when no
group is remembered at all does it fall back to today's query-param/
single-key logic: so an in-progress upgrade, or a client that has never
been grouped, keeps working unchanged. Once a group is known, the server-
address input UI does not reappear until the user explicitly calls
`forgetGroup()` from a new settings action.

**Rollout invariant, restated**: everything in §6-§7 is additive to a
single-node deployment. `KnownServerGroup.groupId` stays absent, every
new `peer_addresses` response field stays `null`, and the existing
single-`apiBaseUrl` code path is exercised exactly as it is today.

---

## 8. Phased implementation plan

Each phase ships and is testable independently. The rollout invariant
("`group_id IS NULL` ⇒ everything new is inert") holds at the end of every
phase, not just the end of the project: a partially-implemented feature
never puts an ungrouped, single-node install at risk.

### Phase 1: Node identity + registry + group join

**Adds:** `backend/migrations/{postgres/0035,sqlite/0032}_node_identity.sql`;
`streamarr-model/src/peer.rs`; `streamarr-db/src/repo/{node_identity,
peer_group,peer_node,peer_join_token}.rs`; `streamarr-api/src/
{admin_peer.rs (self/group/join-token endpoints), peer.rs (enroll only for
now), peer_extractor.rs}`.
**Touches:** `streamarr-api/src/lib.rs` (`AppState` gains
`node_identity_repo`, `peer_group_repo`, `peer_node_repo`,
`peer_join_token_repo`, plus route wiring); `backend/src/main.rs`
(boot-time `node_identity` load-or-seed; no `PeerSyncPoller` yet: that's
Phase 2); `docs/architecture/distributed-design.md` (the §1.1 staleness
correction, same-day, unrelated to the rest of this phase's risk).
**Ships/testable as:** an admin can found a group on node A, mint a join
token, and join node B; `peer_nodes` on both shows both members via the
enroll response. Convergence for a *third* node beyond what `enroll`
returns needs Phase 2's poller: stated as a known, acceptable Phase-1
limitation, not a bug.
**Unaffected:** every existing route, every existing table.

### Phase 2: Sync protocol + content aggregation

**Adds:** new crate `streamarr-peer-sync` (full); migrations `{postgres/
0036,sqlite/0033}` (`peer_sync_state`, `sync_conflict_log`, `users`/
`policies`/`source_instances` additive columns), `{0037,0034}`
(`group_libraries`, `source_instances.group_library_id`, `policies.
group_library_allow`), `{0038,0035}` (`peer_leaf_availability`);
`streamarr-model/src/group_library.rs`; `streamarr-db/src/repo/
{peer_sync_state,group_library,peer_leaf_availability,sync_conflict_log}.rs`;
follow-up migrations `{postgres/0042,sqlite/0039}` add
`source_instances.origin_peer_id` and reset library/push cursors once so
identity-only rows from older releases are replayed as complete sources.
**Touches:** `streamarr-api/src/peer.rs` (real sync endpoints, now
`PeerSignedRequest`-enforced), `catalog.rs` (`AvailabilityBadge`/
`RemoteOnlyWork` DTOs), `auth_extractor.rs` (`group_library_allow` check);
`streamarr-catalog/src/lib.rs` (`browse`/`get_by_id` hydration);
`streamarr-auth/src/policy.rs`; `streamarr-db/src/repo/{user,policy,
source_instance}.rs` (the §2.2 "always set `updated_at` server-side" audit: required here, not optional); `backend/src/main.rs` (spawn
`PeerSyncPoller` per known peer, `ClusterCoordinator`-guarded: **blocked
on the Phase-2 prerequisite in §9**).
**Ships/testable as:** a 3+ node group converges membership via gossip
without a fresh `enroll` call; a `Policy` edit on node A is visible on node
B within one poll interval; browsing the catalog on a partial-cache node
shows `available_on` badges and `RemoteOnlyWork` entries sourced from full
peers.

### Phase 3: Routing rules + redirect/proxy streaming

**Adds:** migration `{postgres/0039,sqlite/0036}` (`routing_rules`);
`streamarr-model/src/routing.rs`; `streamarr-db/src/repo/routing_rule.rs`;
`streamarr-api/src/routing.rs`.
**Touches:** `streamarr-api/src/playback.rs` (routing step + full-
negotiation forwarding, `POST /api/v1/playback/by-external-ref`);
`streamarr-api/src/media.rs` (`Proxy` passthrough path, `AppState.
peer_http`); `streamarr-auth/src/jwt.rs` (EdDSA mode, §5.4: a **hard**
dependency of this phase, not soft: `Redirect` cannot ship without it);
`backend/src/main.rs` (JWT algorithm selection by `group_id`, `peer_http`
client construction).
**Ships/testable as:** an admin sets a routing rule preferring node B for
a `GroupLibrary`; a playback request against node A redirects or proxies
to node B; killing node B mid-flight demonstrates the §5.2 five-step
fallback rather than a hard failure.

### Phase 4: Invite + pairing multi-address

**Adds:** migration `{postgres/0040,sqlite/0037}` (`user_invites`/
`user_invite_requests` additive columns); `GET /api/v1/admin/peer-groups/
self/address-bundle` in `admin_peer.rs`.
**Touches:** wherever `UserInvite`/`UserInviteRequest` rows are constructed
today in `streamarr-api`'s admin/users handlers; `streamarr-api/src/
{login,refresh}.rs` (attach `peer_addresses` to responses: small, could
also land at the start of Phase 5, listed here since it reuses this
phase's address-bundle logic directly); `streamarr-api/src/oauth.rs`
(`request_verification_uri` embeds the `PeerAddressBundle` into
`verification_uri_complete` via `servers=`, §6.3 — the one place device
pairing's server-side surface *does* change, narrowly, to carry addresses
rather than pairing state).
**Client:** `signupInvite.ts`, `Invite.tsx`, `Users.tsx`, `Signup.tsx`,
`clients/tv-web/packages/device-auth/src/*` (parses `servers=` off
`verification_uri_complete`; approval fan-out to that bundle, falling back
to the approver's own remembered group per §6.3).
**Ships/testable as:** an invite generated on a 3-node group works from a
client that can only reach the third node; TV pairing succeeds when the TV
and the approving phone reach different peers, including from an
approving device that has never connected to this group before.

### Phase 5: Client auth UX

**Adds (client-only):** `clients/tv-web/packages/domain/src/
knownServers.ts`; `RUNTIME_CONFIG_FILE_NAME`'s `apiBaseUrl` → plural
`apiBaseUrls` in `clients/tv-web/packages/domain/src/index.ts`.
**Touches:** `clients/tv-web/web/src/lib/{ApiClientProvider.tsx,
loginServerUrl.ts}`; `clients/tv-web/packages/device-auth/src/session.ts`
(`ensureAccessToken` retry-across-group); native mirrors: `clients/android/core-auth/.../DeviceAuthClient.kt`,
`clients/ios/Sources/{StreamarrApp/LoginServerURL.swift,StreamarrKit/Auth/
DeviceFlowClient.swift}`, `clients/apple-tv/Sources/{TVAppEnvironment.swift,
TVSettingsView.swift}`, `clients/roku/source/{Config.brs,Storage.brs}`
(narrower scope, per §6.4).
**Ships/testable as:** a client remembers a 3-address group, survives node
A being down by trying B then C without user action, never re-prompts for
a server address once a group is known, and self-heals its address list
after an admin adds a fourth node.

### Future work, explicitly out of scope for Phases 1-5

- Synced `WatchProgress` via the same `LeafSelector` portability wrapper
  (§1.3): low risk to add later (plain LWW on an already-existing
  `updated_at`), deliberately not core scope.
- Synced `refresh_token_families` (§3.7): the hardest true-multi-writer
  problem this design identified; deferred as its own project, not
  silently assumed solved.
- LAN mDNS discovery as an alternative to the one-time manual/pre-seeded
  address bootstrap (§6.3).
- Full Roku parity with the richer clients' retry/fan-out logic (§6.4).

---

## 9. Prerequisites

Pre-existing gaps this design depends on, verified against the current
codebase rather than assumed from the source proposals.

### 9.1 `SourceInstanceRegistry` boot hydration: partially already fixed

All three source proposals flagged "`SourceInstanceRegistry` does not
hydrate from the DB on boot" as an open prerequisite. **That is only true
for half the deployment shape today.** `backend/src/main.rs`'s `boot_api`
path (`STREAMARR_ROLE=api` or `all`) already hydrates the registry from
`SourceInstanceRepo::list_all()` before serving (confirmed at
`backend/src/main.rs:922-952`, with an explicit doc comment on
`AppState.source_instance_repo` in `streamarr-api/src/lib.rs` describing
this as "the actual fix for registered `*arr` connections not surviving a
restart"). The **remaining, narrower** gap: `boot_worker`, in a split
`api`/`worker` (Postgres Tier 2/3) deployment, runs in a *different
process* than the one serving admin endpoints, with its own empty
registry, and does **not** hydrate it from the repo at all: confirmed by
the explicit comment at `backend/src/main.rs:1420-1432` ("unlike
`boot_api`... this function does not hydrate its own from the database at
all yet, even though the repo/persistence now exists").

**Why this design depends on it being closed first:** Phase 2's
`PeerSyncPoller` wiring needs the same "spawn one poller per known row"
pattern `arr-sync` already uses, and a worker-role process with an
unhydrated `peer_nodes`/`SourceInstanceRegistry` view would spawn none of
them on boot in a split-role deployment: the exact same silent-gap shape
as the pre-existing bug, just for a new table. **Recommended fix, scoped
small:** extend `boot_worker`'s existing 10-second "newly registered since
snapshot" poll loop (`backend/src/main.rs:1433-1469`) to also read from
`SourceInstanceRepo`/`PeerNodeRepo` at its first tick, not just react to
in-memory registry changes: the same shape that loop already has, just
seeded from the DB instead of assuming the snapshot it started with was
complete. This is Phase 2 scope, not a separate blocking project, but must
land in the *same* change that wires `PeerSyncPoller` spawning, not after.

### 9.2 `users`/`policies` have no `updated_at`/`deleted_at` today

Confirmed against `backend/migrations/postgres/0010_users_policies.sql`:
neither column exists on either table. §2.2/§8 Phase 2 already schedule
adding them; restated here as a hard prerequisite because Phase 3's LWW
conflict resolution (§3.5) is unsound without every existing write path
setting `updated_at` server-side, not just the column existing.

### 9.3 `docs/architecture/distributed-design.md` is stale on user/policy persistence

Confirmed (§1.1): its claim that "there is no `UserRepo`/`PolicyRepo` in
`streamarr-db`" and that refresh tokens live only in
`InMemoryRefreshTokenStore` is false today: both are real and durably
wired. The **one** claim in that same paragraph still accurate is
`InMemoryDeviceAuthorizationStore` remaining in-process-only. Folded into
Phase 1 as a same-day doc fix (§8), not a blocker, but flagged here because
this design's own §3 relies on the *current*, correct state (real
`UserRepo`/`PolicyRepo`/durable refresh tokens), not the stale doc's
description of it.

### 9.4 No encryption-at-rest exists anywhere in this codebase

Confirmed at `backend/crates/streamarr-db/src/repo/source_instance.rs:18`:
`api_key_encrypted` is stored as plain `TEXT`, with an explicit comment
that no encryption-at-rest exists. This is not a gap this design closes: `node_identity.private_key` (§2.1) is stored the same way, inheriting the
same already-accepted, already-documented posture rather than introducing
a new one. Flagged here so it is not mistaken for an oversight specific to
this feature.

### 9.5 `Sensitive<T>` does not protect `Serialize`

Confirmed at `backend/crates/streamarr-model/src/sensitive.rs`:
`Sensitive<T>` redacts `Debug`/`Display` only; `Serialize`/`Deserialize`
round-trip the wrapped value transparently, by design (so legitimate
callers like the outbound HTTP client can still get the secret out). This
means `NodeIdentity.private_key` and any peer-signing material must be
manually kept off every DTO that reaches an HTTP response body: there is
no automatic backstop. Phase 1 implementation must apply the same
discipline already required of `SourceInstance.api_key_encrypted`: a
narrower, purpose-built repo method for anything that touches the key,
never the general-purpose "get settings"-shaped read path.
