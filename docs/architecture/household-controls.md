# Household and child controls

Status: design for TASKS 54-57 (sub-rows 103-114). Extends `Policy`,
`ProfilePinRepo` and the existing extractors; it does not add a second
authorisation system.

## Principles

1. **Enforce on the server, deny by default.** Hiding tiles is cosmetic. Every
   route that returns metadata, artwork or bytes for a restricted profile
   evaluates the profile's `Policy`. A route that is not explicitly exempt
   is blocked.
2. **One resolved `Policy` per request.** `StreamingUser`, `CatalogViewer` and
   `resolve_streaming_access` (used by capability-token media URLs) already
   resolve the policy. Household checks hang off those, so a new route that
   takes the extractor inherits the controls.
3. **Tokens do not carry the decision.** Schedule, budget and rating are
   evaluated per request, not baked into a JWT, so a stolen/reused token or a
   session that crosses a schedule boundary stops working at the next request.
4. **Honest limits.** Where only an OS or a provider can enforce (installing an
   app, a native game launch) the server records
   the approval and exposes it, and the row stays `blocked` until that
   platform integration exists.

## Contract additions

### `Policy.household` (`HouseholdControls`, additive, `serde(default)`)

| Field | Meaning |
|---|---|
| `unrated` | `block` (default) or `allow`. Applies only when `max_rating` is set. |
| `timezone` | IANA zone used to evaluate `access_schedule` and the budget day. Absent = UTC (previous behaviour). |
| `daily_budget_minutes` | Optional watch-time cap per local day. |
| `channel_allow`, `game_allow`, `app_allow` | `None` = unrestricted, `Some(ids)` = allowlist (empty = nothing). Contract only until tasks 22/28/36 land; see blocked rows. |
| `guardian_user_ids` | Users who may approve for this profile and who may switch into it without the profile PIN lockout applying to them. |
| `approval_required` | Subset of the approval kinds (`content`, `time`) that needs a guardian approval. |
| `offline_ttl_hours` | Maximum age of a client's cached authorisation (default 24, capped at 72). |

Stored as one JSON column (`policies.household`), synced between peers with
the rest of the policy.

### Content rating

Works carry no rating column. Arr sync writes the arr `certification` as the
reserved tag `rating:<value>` (arr-owned namespace; other tags are untouched).
An admin override is the tag `rating-override:<value>`, which wins. Ratings use
the existing ordered scale (`G/TV-Y` .. `NC-17`). A work with no rating tag, or a
rating that is not on the scale, is **unrated**: blocked unless
`unrated = allow`. This replaces the old fail-open behaviour for restricted
profiles. Non-restricted profiles (no `max_rating`) are unchanged.

### Time model

`TimeDecision` is computed by a pure function from `(controls, schedule, now,
used_seconds_today, approved_bonus_seconds)`:

* `Allowed { remaining_seconds, next_change_at }`
* `OutsideSchedule { next_start_at }`
* `BudgetExhausted { resets_at }`

Schedule windows and the budget day are evaluated in `timezone`, so DST and
travel behave per the profile's home zone. Windows are half-open
`[start, end)` (the old inclusive end allowed a minute past the limit). The
clock is the **server** clock; a client changing its device time or timezone
changes nothing server-side.

Usage is counted **server-side from media delivery** (stream/segment/range
requests the profile is actually served), not from client heartbeats, so a
client that stops reporting does not stop the clock. Counting is throttled to
one write per profile every ~10 s and capped at the gap since the previous
served request so seeks and buffering are not over-charged.

### Where it is enforced

| Surface | Mechanism |
|---|---|
| All catalog/artwork/credits/playlist/view reads | `CatalogViewer` -> time check; work-level rating/tag filter via `Access` in `playarr-catalog` (`browse`, `search`, `similar`, `get_by_id`, `is_work_visible`). Restricted works 404, indistinguishable from absent. |
| Playback info, direct stream, renditions, subtitles, trickplay, downloads | `StreamingUser` -> time check; per-media-file rating check by resolving the owning work. |
| Capability-token media URLs (`media_session`) | `resolve_streaming_access` re-evaluates time on every request. Crossing a schedule limit or exhausting the budget stops the next segment/range, not just new sessions. Rating is checked when the session is created. |
| Profile switching, status, approvals | `AnytimeStreamingUser`: reachable while locked so a guardian can unlock; never reachable by an unauthenticated caller. |

`GET /api/v1/household/status` returns the state clients render (blocked,
remaining time, next change, offline validity). It is informative only; the
server decisions above do not depend on a client calling it.

### Guardian approvals

`household_approvals(id, profile_user_id, kind, subject, requested_at,
expires_at, status, decided_by, decided_at, max_uses, uses, bonus_seconds)`.

* A profile creates a request (`POST /api/v1/household/approvals`); it can never
  decide one. `decide` requires the caller to be listed in the profile's
  `guardian_user_ids`, to be a different user, and, if the guardian has a PIN,
  to present it (step-up; shares the lockout below).
* Approvals are bounded: `expires_at` (default end of day for time/content), `max_uses` (default 1), consumed atomically
  (`UPDATE ... WHERE uses < max_uses AND expires_at > now`), so reuse and
  replay fail.
* Server-enforceable kinds: `content` (lets one work through the rating gate
  until expiry) and `time` (adds bonus seconds to today's budget/overrides the
  schedule until expiry).

### Protected switching and PIN attempts

`verify-pin` gains: per `(caller, target)` failure counter with exponential
lockout (5 failures -> 1 min, doubling, capped at 1 h; successful verify
resets), stored in the database so it is shared across replicas and survives a
restart; locked responses are `429 pin_locked` with `Retry-After`. A profile
with `guardian_user_ids` and no PIN cannot be switched into from a restricted
profile. A restricted session can never read another profile's data: switching
is client-side token selection, and tokens are per-profile, so the server
authorises each request as the token's own profile.

### Offline and reboot

Downloads (`can_download`) for a restricted profile are only issued while the
status is `Allowed`. The client treats its last status as valid until
`offline_valid_until` (= fetch time + `offline_ttl_hours`), after which locally
cached media stays locked until it reconnects. This is client-enforced and is a
documented residual risk: a rooted device can bypass local checks, which is why
the TTL is short and online playback is always server-evaluated.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `GET /api/v1/household/status` | any streaming profile, even when locked | state, remaining time, next change, `guardian_for`, offline validity |
| `POST /api/v1/household/approvals` | the requesting profile | create a pending request |
| `GET /api/v1/household/approvals` | profile or its guardians | own requests plus those of guarded profiles |
| `POST /api/v1/household/approvals/{id}/decision` | a listed guardian with a PIN | approve (PIN step-up, bounded duration) or deny |
| `POST /api/v1/household/approvals/{id}/consume` | the requesting profile | spend one use |
| `GET/PUT /api/v1/admin/users/{id}/household` | admin | rating, tags, schedule, timezone, budget, guardians |

A blocked request is `403 household_blocked` with
`details.reason` of `outside_schedule`, `budget_exhausted`, `rating_too_high`,
`unrated`, `tag_blocked` or `folder_blocked`, plus `next_start_at`/`resets_at`
where relevant. A PIN lockout is `429 pin_locked` with `retry_after_seconds`.

The approval decision route refuses with `403` and a stable code per cause:
`self_approval_forbidden` (the requester), `not_guardian` (not a guardian of
the profile) and `guardian_pin_not_set` (the guardian has no profile PIN); a
restricted guardian stays `forbidden`. Clients match the code, not the message.

## Known gaps (tracked)

* A stored refresh token for a PIN-locked profile is not itself gated by the
  PIN (row 115); the PIN gate on switching is enforced by clients, with
  lockout, step-up and switch-up refusal enforced by the server.
* Budget counting is per node; a multi-replica deployment counts each
  replica's served media into one shared table but throttles writes in memory,
  so concurrent replicas can over-grant by at most one flush interval.

## Blocked on other work (recorded as explicit rows)

* Rows 22/28/36 (games, live TV, external apps) define no routes yet. The
  allowlist contract exists; enforcement lands with those routes.
* Row 34 (PlayarrOS isolated sessions) provides per-user OS sessions and app
  credential isolation; "escape through another app/account" is only
  verifiable there.
* Playarr has no store and no purchases; purchase approval is out of scope
  (owner decision, 2026-10-09).

## Validation (row 57)

Server tests exercise: token reuse after a policy change, cross-profile escape
(token of A against B's resources/PIN), direct media URL without/with another
user's capability token, expired/exhausted/foreign approvals, self-approval,
PIN brute force, schedule/timezone/DST edges, budget exhaustion mid-stream,
unrated content, search/artwork/credits leakage, and downloads. Real-device
evidence is recorded in the task rows.
