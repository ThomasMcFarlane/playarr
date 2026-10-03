//! `playarr-peer-sync` -- the node-to-node peer group sync protocol:
//! signed requests, the client-side join handshake, membership gossip,
//! account/invite/library/availability sync, and the poller that drives
//! them against every known peer. See `docs/architecture/peer-groups.md`
//! §2.6 (this crate's own file layout), §3 (the whole sync protocol), and
//! §4.2 (the external-ref/`LeafSelector` portability matching algorithm
//! `availability_sync` ports).
//!
//! **Dependency direction, stated explicitly:** this crate depends on
//! `playarr-model`/`playarr-db`/`playarr-auth`/`playarr-coordination`
//! (plus `playarr-arr-sync`, for its `SyncRunStatus`/`SyncStatusReporter`
//! types only -- see `poller`'s own doc comment) and never on
//! `playarr-api`. `playarr-api` depends on *this* crate instead (its
//! `admin_peer::join_peer_group_handler` delegates to [`enroll::join_group`]
//! rather than driving its own inline HTTP call) -- the correct direction,
//! since this is a lower-level protocol crate `playarr-api`'s HTTP layer
//! sits on top of, not the other way around. Concretely, this is why
//! [`enroll::EnrollRequest`]/[`enroll::EnrollResponse`] are this crate's
//! *own* types rather than imports from `playarr-api::peer`: sharing them
//! would require the dependency to point the wrong way.
//!
//! Module layout mirrors `playarr-arr-sync`'s shape (§3.2 explains why
//! this is a new crate rather than a module folded into that one): every
//! `*_sync` module is one entity family's client-side sync logic, callable
//! independently (each is exercised directly in its own tests) and
//! composed together by [`poller::PeerSyncPoller`], the only piece meant to
//! run continuously in production.
//!
//! `routing_sync.rs` (routing_rules, §2.4/§3.6's table) is Phase 3 scope --
//! see that module's own doc comment for why it syncs by plain LWW, the
//! same as `account_sync::sync_libraries`, with no origin-gating.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

pub mod account_sync;
pub mod availability_sync;
pub mod enroll;
pub mod membership_sync;
pub mod peer_client;
pub mod poller;
pub mod push_sync;
pub mod routing_sync;
pub mod signing;

pub use enroll::{join_group, EnrollRequest, EnrollResponse, JoinGroupError};
pub use peer_client::{PeerClient, PeerClientError};
pub use poller::{
    PeerSyncPoller, PollError, DEFAULT_PEER_SYNC_INTERVAL_SECS, DEFAULT_PEER_UNREACHABLE_THRESHOLD,
};
pub use push_sync::{apply_push, PushSyncError, PushSyncRequest, PushSyncResponse};
pub use signing::{PeerIdentity, SignedRequestHeaders, SigningError};
