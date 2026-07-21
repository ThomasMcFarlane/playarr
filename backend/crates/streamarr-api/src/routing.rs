//! Pure routing-resolution logic -- Phase 3 of
//! `docs/architecture/peer-groups.md` (see that document's §5.1/§5.2/§5.3
//! for the full design and rationale).
//!
//! [`resolve_route`] is §5.2's five-step resolution order, deliberately
//! free of any repository/I/O/network dependency -- the same "caller
//! gathers, this module only judges" split `streamarr_auth::policy`'s
//! `DefaultPolicyEvaluator` already uses for `Policy` evaluation
//! (`streamarr-auth/src/policy.rs`'s own module doc comment). The caller
//! (a later stage: `playback_info_handler`'s new step,
//! `streamarr-api/src/playback.rs`, **not built by this pass**) is
//! responsible for:
//!
//! - Fetching every `RoutingRule` for the acting user's group
//!   (`RoutingRuleRepo::list_for_group`) and every known `PeerNode`
//!   (`PeerNodeRepo::list_all`) and passing them straight through.
//! - Fetching the relevant `PeerLeafAvailability` rows and, per §5.2 step 2,
//!   resolving the freshness-window/live-probe/cooldown concern *before*
//!   calling in here: a stale row ([`is_stale`]) that still needs a live
//!   probe is the caller's problem, not this function's. A failed probe is
//!   recorded via [`CooldownTracker`], and that peer excluded from (or its
//!   `PeerNode::status` downgraded to `PeerNodeStatus::Unreachable` in) the
//!   `peers` slice passed to the next resolution attempt -- this function
//!   itself never performs network I/O, and stays trivially unit-testable
//!   without a mock server or a real peer. (In practice, forwarding the
//!   negotiation request to the resolved peer -- §5.2's "the entire
//!   negotiation request is forwarded" -- doubles as that live probe: a
//!   forwarding failure is exactly the signal that should feed
//!   `CooldownTracker::record_failure` before that same caller retries
//!   resolution with an adjusted `peers` slice.)
//! - Determining whether *this* node has the leaf locally (`self_available`)
//!   -- a live read of this node's own `MediaFileRepo`, never
//!   `peer_leaf_availability` (never written for `peer_node_id` = self, see
//!   that table's own doc comment in `streamarr-db/src/repo/
//!   peer_leaf_availability.rs`).
//!
//! A single, ungrouped node -- or a grouped node with no matching
//! `RoutingRule`, or a matching rule with an empty `preferred_nodes` -- always
//! resolves to [`RoutingDecision::ServeLocally`]: byte-for-byte today's
//! existing behavior, unchanged. `resolve_route` is not wired into any live
//! request path yet -- that's a later stage in this same phase (see this
//! crate's `playback.rs`/`media.rs`, both untouched by this pass).

use std::cmp::Reverse;

use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use streamarr_model::{
    Availability, DeliveryMode, ExternalProvider, LeafSelector, PeerLeafAvailability, PeerNode,
    PeerNodeStatus, RoutingRule,
};
use uuid::Uuid;

/// Default freshness window for a cached `PeerLeafAvailability` row before
/// it's stale enough to warrant a live probe before trusting it (§5.2 step
/// 2) -- matches the arr-sync poll cadence, ~15 min. Staleness alone never
/// disqualifies a candidate (see [`is_stale`]'s own doc comment); this is
/// only the threshold at which the caller should bother probing at all.
pub const DEFAULT_FRESHNESS_WINDOW: Duration = Duration::minutes(15);

/// Default in-process cooldown after a peer fails a live reachability probe
/// (§5.2 step 2) before it's worth probing that same peer again.
pub const DEFAULT_PROBE_COOLDOWN: Duration = Duration::seconds(30);

/// Everything a routing decision needs to know about the specific leaf
/// being requested, gathered by the caller (`playback_info_handler`/the
/// `by-external-ref` handler, §5.2) rather than re-derived here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutingContext {
    pub group_library_id: Option<Uuid>,
    pub user_id: Uuid,
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
}

/// Where and how a request should be served -- the outcome of
/// [`resolve_route`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoutingDecision {
    /// No matching rule, an empty `preferred_nodes` list, or every
    /// preferred/fallback peer exhausted with this node itself holding the
    /// leaf -- serve it exactly as today, unchanged.
    ServeLocally,
    /// Forward the *entire* playback negotiation to `peer_node_id` (§5.2's
    /// "why the whole negotiation must move, not just the URL") and deliver
    /// its result the way `delivery` says (§5.3). `delivery` is always
    /// already resolved to a concrete choice -- never `DeliveryMode::Auto`
    /// itself -- see [`compute_delivery_mode`].
    Delegate {
        peer_node_id: Uuid,
        delivery: DeliveryMode,
    },
    /// No peer, including this node itself, reports the leaf as available.
    /// The caller maps this to a distinct `ApiError::no_peer_available`
    /// (§5.2), not a generic 404.
    Unavailable,
}

/// §5.2 step 1: the most specific `RoutingRule` in `rules` that matches
/// `(group_library_id, user_id)`, specificity ranked `(library, user) >
/// (user, any library) > (library, any user) > (any library, any user)`,
/// ties within a tier broken by highest `priority` and then, if `priority`
/// also ties, lowest `id` (an arbitrary but deterministic final tiebreak --
/// not itself part of §5.2's spec, which only names `priority`; mirrors
/// `RoutingRuleRepo::list_for_group`'s own `ORDER BY priority DESC, id ASC`
/// convention). Independent of the order `rules` is passed in -- callers do
/// not need to pre-sort.
pub fn select_most_specific_rule(
    rules: &[RoutingRule],
    group_library_id: Option<Uuid>,
    user_id: Uuid,
) -> Option<&RoutingRule> {
    fn best(
        rules: &[RoutingRule],
        predicate: impl Fn(&RoutingRule) -> bool,
    ) -> Option<&RoutingRule> {
        rules
            .iter()
            .filter(|rule| predicate(rule))
            .max_by_key(|rule| (rule.priority, Reverse(rule.id)))
    }

    if let Some(group_library_id) = group_library_id {
        if let Some(rule) = best(rules, |rule| {
            rule.group_library_id == Some(group_library_id) && rule.user_id == Some(user_id)
        }) {
            return Some(rule);
        }
    }

    if let Some(rule) = best(rules, |rule| {
        rule.group_library_id.is_none() && rule.user_id == Some(user_id)
    }) {
        return Some(rule);
    }

    if let Some(group_library_id) = group_library_id {
        if let Some(rule) = best(rules, |rule| {
            rule.group_library_id == Some(group_library_id) && rule.user_id.is_none()
        }) {
            return Some(rule);
        }
    }

    best(rules, |rule| {
        rule.group_library_id.is_none() && rule.user_id.is_none()
    })
}

/// §5.2 step 2's freshness check: `true` when `updated_at` is older than
/// `freshness_window` relative to `now`. Staleness alone never disqualifies
/// a candidate -- "it might just be a slow poll, not a partition" (§5.2) --
/// this only tells a caller a live probe is worth doing before committing
/// to that candidate; [`resolve_route`] itself doesn't call this (see this
/// module's own doc comment for why that check lives in the caller).
pub fn is_stale(updated_at: DateTime<Utc>, now: DateTime<Utc>, freshness_window: Duration) -> bool {
    now.signed_duration_since(updated_at) > freshness_window
}

/// In-process record of peers that recently failed a live reachability
/// probe -- mirrors `SourceInstanceRegistry`'s own in-memory, per-instance
/// bookkeeping (`trigger_senders`/`sync_status`, `streamarr-api/src/
/// source_registry.rs`): no new persistence, resets on restart, exactly the
/// same "this doesn't need to survive a restart" reasoning. A later-stage
/// async wrapper around [`resolve_route`] records a failure here
/// (`record_failure`) and, on the next resolution attempt, excludes (or
/// downgrades to `PeerNodeStatus::Unreachable`) any peer this still reports
/// [`CooldownTracker::is_cooling_down`] for.
#[derive(Default)]
pub struct CooldownTracker {
    failed_until: DashMap<Uuid, DateTime<Utc>>,
}

impl CooldownTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records that `peer_id` just failed a live probe; it's treated as
    /// cooling down until `now + cooldown`.
    pub fn record_failure(&self, peer_id: Uuid, now: DateTime<Utc>, cooldown: Duration) {
        self.failed_until.insert(peer_id, now + cooldown);
    }

    /// `true` if `peer_id` failed a probe recently enough that it's still
    /// within its cooldown window as of `now`.
    pub fn is_cooling_down(&self, peer_id: Uuid, now: DateTime<Utc>) -> bool {
        self.failed_until
            .get(&peer_id)
            .is_some_and(|until| now < *until)
    }

    /// Clears a peer's cooldown early -- e.g. once a caller has confirmed
    /// (via any other means) that it's reachable again.
    pub fn clear(&self, peer_id: Uuid) {
        self.failed_until.remove(&peer_id);
    }
}

/// §5.3: `DeliveryMode::Auto` resolves per request to `Redirect` if `peer`
/// has at least one `client_reachable` address, else silently downgrades to
/// `Proxy`. `Redirect`/`Proxy` pass through unchanged -- an operator's
/// explicit rule-authoring choice always wins over the per-request
/// heuristic.
pub fn compute_delivery_mode(mode: DeliveryMode, peer: &PeerNode) -> DeliveryMode {
    match mode {
        DeliveryMode::Redirect => DeliveryMode::Redirect,
        DeliveryMode::Proxy => DeliveryMode::Proxy,
        DeliveryMode::Auto => {
            if peer.addresses.iter().any(|address| address.client_reachable) {
                DeliveryMode::Redirect
            } else {
                DeliveryMode::Proxy
            }
        }
    }
}

/// `true` if `availability` has an `Available`/`PartiallyAvailable` row for
/// `peer_id` matching `ctx`'s specific leaf -- the exact primary key
/// `peer_leaf_availability` itself is keyed on
/// (`peer_node_id, provider, external_id, leaf_selector`).
fn peer_reports_available(peer_id: Uuid, ctx: &RoutingContext, availability: &[PeerLeafAvailability]) -> bool {
    availability.iter().any(|row| {
        row.peer_node_id == peer_id
            && row.provider == ctx.provider
            && row.external_id == ctx.external_id
            && row.leaf_selector == ctx.leaf_selector
            && matches!(
                row.availability,
                Availability::Available | Availability::PartiallyAvailable
            )
    })
}

/// Attempts to route to one specific candidate peer: `None` if it's
/// unknown, not `Active`, or doesn't report the leaf available; `Some` with
/// the fully-resolved [`RoutingDecision::Delegate`] otherwise.
fn try_peer(
    peer_id: Uuid,
    delivery_mode: DeliveryMode,
    ctx: &RoutingContext,
    peers: &[PeerNode],
    availability: &[PeerLeafAvailability],
) -> Option<RoutingDecision> {
    let peer = peers.iter().find(|candidate| candidate.id == peer_id)?;
    if peer.status != PeerNodeStatus::Active {
        return None;
    }
    if !peer_reports_available(peer_id, ctx, availability) {
        return None;
    }
    Some(RoutingDecision::Delegate {
        peer_node_id: peer_id,
        delivery: compute_delivery_mode(delivery_mode, peer),
    })
}

/// §5.2's full five-step resolution order. Pure and I/O-free -- see this
/// module's own doc comment for what the caller is responsible for
/// gathering first.
///
/// 1. Select the most specific matching [`RoutingRule`] in `rules`
///    ([`select_most_specific_rule`]). No match, or a match with an empty
///    `preferred_nodes`, resolves to [`RoutingDecision::ServeLocally`]
///    (today's exact existing behavior).
/// 2. Walk `preferred_nodes` in order, skipping any peer that isn't in
///    `peers` as `PeerNodeStatus::Active` or doesn't report the leaf
///    `Available`/`PartiallyAvailable` in `availability`. First match wins.
/// 3. If every preferred peer was skipped, fall back to the entry node
///    itself if `self_available`.
/// 4. Otherwise, fall back to any other known, `Active` peer reporting
///    availability, in `peers`' own order (`self_peer_id` excluded -- step
///    3 already covers it).
/// 5. If nothing -- including self -- has it: [`RoutingDecision::Unavailable`].
pub fn resolve_route(
    ctx: &RoutingContext,
    rules: &[RoutingRule],
    self_peer_id: Uuid,
    self_available: bool,
    peers: &[PeerNode],
    availability: &[PeerLeafAvailability],
) -> RoutingDecision {
    let Some(rule) = select_most_specific_rule(rules, ctx.group_library_id, ctx.user_id) else {
        return RoutingDecision::ServeLocally;
    };
    if rule.preferred_nodes.is_empty() {
        return RoutingDecision::ServeLocally;
    }

    // Step 2.
    for &peer_id in &rule.preferred_nodes {
        if let Some(decision) = try_peer(peer_id, rule.delivery_mode, ctx, peers, availability) {
            return decision;
        }
    }

    // Step 3: never make a client wait on routing preference when the
    // entry node that already received the request could just serve it.
    if self_available {
        return RoutingDecision::ServeLocally;
    }

    // Step 4: any other known, active peer, in `peers`' own declaration
    // order (self already ruled out by `self_available` above).
    for peer in peers {
        if peer.id == self_peer_id {
            continue;
        }
        if let Some(decision) = try_peer(peer.id, rule.delivery_mode, ctx, peers, availability) {
            return decision;
        }
    }

    // Step 5.
    RoutingDecision::Unavailable
}

#[cfg(test)]
mod tests {
    use chrono::SubsecRound;
    use streamarr_model::PeerAddress;

    use super::*;

    fn ctx() -> RoutingContext {
        RoutingContext {
            group_library_id: Some(Uuid::new_v4()),
            user_id: Uuid::new_v4(),
            provider: ExternalProvider::Tmdb,
            external_id: "603".to_string(),
            leaf_selector: LeafSelector::Movie,
        }
    }

    fn rule(
        group_library_id: Option<Uuid>,
        user_id: Option<Uuid>,
        priority: i32,
        preferred_nodes: Vec<Uuid>,
    ) -> RoutingRule {
        let now = Utc::now().trunc_subsecs(3);
        RoutingRule {
            id: Uuid::new_v4(),
            group_id: Uuid::new_v4(),
            group_library_id,
            user_id,
            priority,
            preferred_nodes,
            delivery_mode: DeliveryMode::Auto,
            created_at: now,
            updated_at: now,
        }
    }

    fn peer(id: Uuid, status: PeerNodeStatus, is_self: bool, client_reachable: bool) -> PeerNode {
        let now = Utc::now().trunc_subsecs(3);
        PeerNode {
            id,
            group_id: Uuid::new_v4(),
            name: format!("peer-{id}"),
            addresses: vec![PeerAddress {
                url: "http://peer.invalid".to_string(),
                priority: 0,
                label: "lan".to_string(),
                client_reachable,
            }],
            public_key: "test-key".to_string(),
            is_self,
            status,
            last_seen_at: Some(now),
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        }
    }

    fn available_row(peer_id: Uuid, ctx: &RoutingContext, availability: Availability) -> PeerLeafAvailability {
        let now = Utc::now().trunc_subsecs(3);
        PeerLeafAvailability {
            peer_node_id: peer_id,
            provider: ctx.provider.clone(),
            external_id: ctx.external_id.clone(),
            leaf_selector: ctx.leaf_selector.clone(),
            group_library_id: ctx.group_library_id,
            availability,
            container: Some("mkv".to_string()),
            codec: Some("h264".to_string()),
            bitrate: Some(8_000_000),
            size_bytes: Some(4_000_000_000),
            duration_ms: Some(7_200_000),
            local_work_id: None,
            title: "Sample".to_string(),
            kind: streamarr_model::WorkKind::Movie,
            release_date: None,
            updated_at: now,
        }
    }

    // ---- select_most_specific_rule ----

    #[test]
    fn select_most_specific_rule_prefers_library_and_user_over_either_alone() {
        let ctx = ctx();
        let library_and_user = rule(ctx.group_library_id, Some(ctx.user_id), 0, vec![]);
        let user_only = rule(None, Some(ctx.user_id), 0, vec![]);
        let library_only = rule(ctx.group_library_id, None, 0, vec![]);
        let global = rule(None, None, 0, vec![]);
        let rules = vec![global.clone(), library_only.clone(), user_only.clone(), library_and_user.clone()];

        let selected = select_most_specific_rule(&rules, ctx.group_library_id, ctx.user_id).unwrap();
        assert_eq!(selected.id, library_and_user.id);
    }

    #[test]
    fn select_most_specific_rule_prefers_user_only_over_library_only() {
        let ctx = ctx();
        let user_only = rule(None, Some(ctx.user_id), 0, vec![]);
        let library_only = rule(ctx.group_library_id, None, 0, vec![]);
        let rules = vec![library_only, user_only.clone()];

        let selected = select_most_specific_rule(&rules, ctx.group_library_id, ctx.user_id).unwrap();
        assert_eq!(selected.id, user_only.id);
    }

    #[test]
    fn select_most_specific_rule_falls_back_to_global_rule() {
        let ctx = ctx();
        let other_user_rule = rule(None, Some(Uuid::new_v4()), 0, vec![]);
        let global = rule(None, None, 0, vec![]);
        let rules = vec![other_user_rule, global.clone()];

        let selected = select_most_specific_rule(&rules, ctx.group_library_id, ctx.user_id).unwrap();
        assert_eq!(selected.id, global.id);
    }

    #[test]
    fn select_most_specific_rule_returns_none_when_nothing_matches() {
        let ctx = ctx();
        let other_user_rule = rule(None, Some(Uuid::new_v4()), 0, vec![]);
        let other_library_rule = rule(Some(Uuid::new_v4()), None, 0, vec![]);
        let rules = vec![other_user_rule, other_library_rule];

        assert!(select_most_specific_rule(&rules, ctx.group_library_id, ctx.user_id).is_none());
    }

    #[test]
    fn select_most_specific_rule_breaks_ties_within_a_tier_by_priority() {
        let ctx = ctx();
        let low = rule(None, None, 0, vec![]);
        let high = rule(None, None, 10, vec![]);
        let rules = vec![low, high.clone()];

        let selected = select_most_specific_rule(&rules, ctx.group_library_id, ctx.user_id).unwrap();
        assert_eq!(selected.id, high.id);
    }

    #[test]
    fn select_most_specific_rule_is_independent_of_input_order() {
        let ctx = ctx();
        let library_and_user = rule(ctx.group_library_id, Some(ctx.user_id), 0, vec![]);
        let global = rule(None, None, 100, vec![]);
        // Even though `global` has a far higher priority, it's a less
        // specific tier -- specificity always wins over priority, priority
        // is only the tiebreak *within* a tier.
        let rules = vec![global, library_and_user.clone()];

        let selected = select_most_specific_rule(&rules, ctx.group_library_id, ctx.user_id).unwrap();
        assert_eq!(selected.id, library_and_user.id);
    }

    // ---- inertness: no rule / empty preferred_nodes ----

    #[test]
    fn no_matching_rule_resolves_to_serve_locally() {
        let ctx = ctx();
        let decision = resolve_route(&ctx, &[], Uuid::new_v4(), true, &[], &[]);
        assert_eq!(decision, RoutingDecision::ServeLocally);
    }

    #[test]
    fn no_matching_rule_resolves_to_serve_locally_even_when_self_does_not_have_it() {
        // A single, ungrouped node (or a grouped node with zero routing
        // rules) must be byte-for-byte inert: this never becomes
        // `Unavailable` just because `self_available` happens to be false --
        // an absent rule short-circuits before that's ever consulted.
        let ctx = ctx();
        let decision = resolve_route(&ctx, &[], Uuid::new_v4(), false, &[], &[]);
        assert_eq!(decision, RoutingDecision::ServeLocally);
    }

    #[test]
    fn matching_rule_with_empty_preferred_nodes_resolves_to_serve_locally() {
        let ctx = ctx();
        let global = rule(None, None, 0, vec![]);
        let decision = resolve_route(&ctx, &[global], Uuid::new_v4(), true, &[], &[]);
        assert_eq!(decision, RoutingDecision::ServeLocally);
    }

    // ---- the fallback chain ----

    #[test]
    fn routes_to_the_first_preferred_peer_that_is_active_and_available() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let preferred = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(preferred, PeerNodeStatus::Active, false, true),
        ];
        let availability = vec![available_row(preferred, &ctx, Availability::Available)];

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &availability);
        assert_eq!(
            decision,
            RoutingDecision::Delegate {
                peer_node_id: preferred,
                delivery: DeliveryMode::Redirect,
            }
        );
    }

    #[test]
    fn skips_a_preferred_peer_that_is_not_active() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let unreachable_preferred = Uuid::new_v4();
        let second_preferred = Uuid::new_v4();
        let rule = rule(
            ctx.group_library_id,
            None,
            0,
            vec![unreachable_preferred, second_preferred],
        );
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(unreachable_preferred, PeerNodeStatus::Unreachable, false, true),
            peer(second_preferred, PeerNodeStatus::Active, false, true),
        ];
        let availability = vec![
            available_row(unreachable_preferred, &ctx, Availability::Available),
            available_row(second_preferred, &ctx, Availability::Available),
        ];

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &availability);
        assert_eq!(
            decision,
            RoutingDecision::Delegate {
                peer_node_id: second_preferred,
                delivery: DeliveryMode::Redirect,
            }
        );
    }

    #[test]
    fn skips_a_preferred_peer_that_does_not_report_the_leaf_available() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let no_file_preferred = Uuid::new_v4();
        let has_file_preferred = Uuid::new_v4();
        let rule = rule(
            ctx.group_library_id,
            None,
            0,
            vec![no_file_preferred, has_file_preferred],
        );
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(no_file_preferred, PeerNodeStatus::Active, false, true),
            peer(has_file_preferred, PeerNodeStatus::Active, false, true),
        ];
        // `no_file_preferred` has no row at all -- never reported having it.
        let availability = vec![available_row(has_file_preferred, &ctx, Availability::PartiallyAvailable)];

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &availability);
        assert_eq!(
            decision,
            RoutingDecision::Delegate {
                peer_node_id: has_file_preferred,
                delivery: DeliveryMode::Redirect,
            }
        );
    }

    #[test]
    fn falls_back_to_self_when_every_preferred_peer_is_unreachable_or_lacks_the_file() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let dead_preferred = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![dead_preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(dead_preferred, PeerNodeStatus::Unreachable, false, true),
        ];

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &[]);
        assert_eq!(decision, RoutingDecision::ServeLocally);
    }

    #[test]
    fn falls_back_to_any_other_active_peer_when_preferred_peers_fail_and_self_lacks_it() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let dead_preferred = Uuid::new_v4();
        let other_active_peer = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![dead_preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(dead_preferred, PeerNodeStatus::Unreachable, false, true),
            peer(other_active_peer, PeerNodeStatus::Active, false, false),
        ];
        let availability = vec![available_row(other_active_peer, &ctx, Availability::Available)];

        // self_available = false: the entry node doesn't have it either.
        let decision = resolve_route(&ctx, &[rule], self_id, false, &peers, &availability);
        assert_eq!(
            decision,
            RoutingDecision::Delegate {
                peer_node_id: other_active_peer,
                // `other_active_peer` has no `client_reachable` address --
                // `Auto` must downgrade to `Proxy` (§5.3).
                delivery: DeliveryMode::Proxy,
            }
        );
    }

    #[test]
    fn resolves_to_unavailable_when_no_peer_including_self_has_it() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let dead_preferred = Uuid::new_v4();
        let unrelated_active_peer = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![dead_preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(dead_preferred, PeerNodeStatus::Unreachable, false, true),
            // Active, but never reports this specific leaf as available.
            peer(unrelated_active_peer, PeerNodeStatus::Active, false, true),
        ];

        let decision = resolve_route(&ctx, &[rule], self_id, false, &peers, &[]);
        assert_eq!(decision, RoutingDecision::Unavailable);
    }

    #[test]
    fn any_other_active_peer_fallback_skips_left_and_unreachable_peers() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let dead_preferred = Uuid::new_v4();
        let left_peer = Uuid::new_v4();
        let unreachable_peer = Uuid::new_v4();
        let eligible_peer = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![dead_preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(dead_preferred, PeerNodeStatus::Unreachable, false, true),
            peer(left_peer, PeerNodeStatus::Left, false, true),
            peer(unreachable_peer, PeerNodeStatus::Unreachable, false, true),
            peer(eligible_peer, PeerNodeStatus::Active, false, true),
        ];
        let availability = vec![
            available_row(left_peer, &ctx, Availability::Available),
            available_row(unreachable_peer, &ctx, Availability::Available),
            available_row(eligible_peer, &ctx, Availability::Available),
        ];

        let decision = resolve_route(&ctx, &[rule], self_id, false, &peers, &availability);
        assert_eq!(
            decision,
            RoutingDecision::Delegate {
                peer_node_id: eligible_peer,
                delivery: DeliveryMode::Redirect,
            }
        );
    }

    #[test]
    fn a_peer_id_in_preferred_nodes_not_present_in_peers_at_all_is_skipped() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let unknown_peer = Uuid::new_v4();
        let known_peer = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![unknown_peer, known_peer]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(known_peer, PeerNodeStatus::Active, false, true),
        ];
        let availability = vec![available_row(known_peer, &ctx, Availability::Available)];

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &availability);
        assert_eq!(
            decision,
            RoutingDecision::Delegate {
                peer_node_id: known_peer,
                delivery: DeliveryMode::Redirect,
            }
        );
    }

    #[test]
    fn unavailability_row_does_not_count_as_available() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let preferred = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(preferred, PeerNodeStatus::Active, false, true),
        ];
        let availability = vec![available_row(preferred, &ctx, Availability::Deleted)];

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &availability);
        assert_eq!(decision, RoutingDecision::ServeLocally);
    }

    #[test]
    fn availability_for_a_different_leaf_selector_does_not_match() {
        let ctx = ctx();
        let self_id = Uuid::new_v4();
        let preferred = Uuid::new_v4();
        let rule = rule(ctx.group_library_id, None, 0, vec![preferred]);
        let peers = vec![
            peer(self_id, PeerNodeStatus::Active, true, true),
            peer(preferred, PeerNodeStatus::Active, false, true),
        ];
        let mut row = available_row(preferred, &ctx, Availability::Available);
        row.leaf_selector = LeafSelector::Episode { season: 1, episode: 1 };

        let decision = resolve_route(&ctx, &[rule], self_id, true, &peers, &[row]);
        assert_eq!(decision, RoutingDecision::ServeLocally);
    }

    // ---- DeliveryMode::Auto (§5.3) ----

    #[test]
    fn compute_delivery_mode_auto_is_redirect_when_a_client_reachable_address_exists() {
        let peer = peer(Uuid::new_v4(), PeerNodeStatus::Active, false, true);
        assert_eq!(compute_delivery_mode(DeliveryMode::Auto, &peer), DeliveryMode::Redirect);
    }

    #[test]
    fn compute_delivery_mode_auto_is_proxy_when_no_address_is_client_reachable() {
        let peer = peer(Uuid::new_v4(), PeerNodeStatus::Active, false, false);
        assert_eq!(compute_delivery_mode(DeliveryMode::Auto, &peer), DeliveryMode::Proxy);
    }

    #[test]
    fn compute_delivery_mode_auto_is_proxy_with_no_addresses_at_all() {
        let mut peer = peer(Uuid::new_v4(), PeerNodeStatus::Active, false, false);
        peer.addresses.clear();
        assert_eq!(compute_delivery_mode(DeliveryMode::Auto, &peer), DeliveryMode::Proxy);
    }

    #[test]
    fn compute_delivery_mode_explicit_redirect_passes_through_even_without_a_reachable_address() {
        let peer = peer(Uuid::new_v4(), PeerNodeStatus::Active, false, false);
        assert_eq!(compute_delivery_mode(DeliveryMode::Redirect, &peer), DeliveryMode::Redirect);
    }

    #[test]
    fn compute_delivery_mode_explicit_proxy_passes_through_even_with_a_reachable_address() {
        let peer = peer(Uuid::new_v4(), PeerNodeStatus::Active, false, true);
        assert_eq!(compute_delivery_mode(DeliveryMode::Proxy, &peer), DeliveryMode::Proxy);
    }

    // ---- freshness / cooldown helpers ----

    #[test]
    fn is_stale_is_false_within_the_freshness_window() {
        let now = Utc::now();
        let updated_at = now - Duration::minutes(5);
        assert!(!is_stale(updated_at, now, DEFAULT_FRESHNESS_WINDOW));
    }

    #[test]
    fn is_stale_is_true_past_the_freshness_window() {
        let now = Utc::now();
        let updated_at = now - Duration::minutes(20);
        assert!(is_stale(updated_at, now, DEFAULT_FRESHNESS_WINDOW));
    }

    #[test]
    fn cooldown_tracker_reports_cooling_down_until_it_expires() {
        let tracker = CooldownTracker::new();
        let peer_id = Uuid::new_v4();
        let now = Utc::now();

        assert!(!tracker.is_cooling_down(peer_id, now));

        tracker.record_failure(peer_id, now, Duration::seconds(30));
        assert!(tracker.is_cooling_down(peer_id, now));
        assert!(tracker.is_cooling_down(peer_id, now + Duration::seconds(29)));
        assert!(!tracker.is_cooling_down(peer_id, now + Duration::seconds(31)));
    }

    #[test]
    fn cooldown_tracker_clear_ends_the_cooldown_early() {
        let tracker = CooldownTracker::new();
        let peer_id = Uuid::new_v4();
        let now = Utc::now();
        tracker.record_failure(peer_id, now, Duration::minutes(5));
        assert!(tracker.is_cooling_down(peer_id, now));

        tracker.clear(peer_id);
        assert!(!tracker.is_cooling_down(peer_id, now));
    }
}
