# Auth Modes

Streamarr's authentication model spans a deliberate spectrum from "no
credentials at all, on your own network" to "real per-user accounts." It is
encoded as a single operator-wide setting, `streamarr_auth::AuthMode`, with
three variants — each a coherent, supported login tier, not one system with
optional bits switched off. `AuthMode` governs *authentication* (who, if
anyone, a request gets to become), resolved by
`streamarr_auth::login::evaluate_login`. A separate module,
`streamarr_auth::policy`, governs *authorization* (what an already-identified
user is allowed to do) via a `Policy`. See ["What's actually wired up
today"](#whats-actually-wired-up-today) below for how much of each is live
in `streamarr-api` right now — there's a real, important gap between "this
logic exists and is tested" and "this is enforced on a live request path."

## Why a spectrum, not one model

Streamarr runs across all three deployment tiers in
[`overview.md`](overview.md), and the right amount of auth ceremony is
different at each end: a household running a single NAS on their own LAN
should not be forced through account creation and password policies just to
watch something in their own living room, but a server operator sharing
their library with friends over the internet needs real accounts and real
sessions. Forcing everyone into the heavier model is the single most common
complaint about self-hosted media servers that only offer one auth posture;
forcing everyone into the lighter model makes the software unsafe to expose
to the internet at all. Streamarr supports both, explicitly, as first-class
configurations.

## The three trust tiers (`AuthMode`)

| Variant | Login required? | Typical deployment |
|---|---|---|
| `AuthMode::TrustedNetwork { allowlist }` — **the default** | No credentials; auto-login by source IP | Tier 1 systemd install, LAN-only, single household |
| `AuthMode::ManagedProfiles` | PIN only | Multiple people in one household, "who's watching" style |
| `AuthMode::FullAccount` | Username + password | Remote access, shared with people outside the household |

Set server-wide via `STREAMARR_AUTH_MODE` — `trusted-network` (the default;
also the fallback when the variable is unset or holds an unrecognized
value) or `full-account`. There is currently no `STREAMARR_AUTH_MODE` value
that selects `ManagedProfiles` from `backend/src/main.rs`'s composition
root, even though the mode itself is fully implemented and tested in
`streamarr-auth` — wiring a config value (or a way to select it per
profile) to it is a small follow-up, not a design gap. All three tiers
funnel a successful login through the same `RefreshTokenService`, so every
tier ultimately hands the client the same access + refresh token pair via
`POST /api/v1/auth/login`.

### `AuthMode::TrustedNetwork` — the default

Every request whose source IP falls inside a configured CIDR range
auto-logs-in as that range's single bound user id, with zero credentials
required; a source IP outside every range is denied outright (`401
untrusted_network`) — this mode never falls back to a password prompt.
Unless `STREAMARR_TRUSTED_NETWORK_CIDR` is set (which replaces the whole
list with that one custom range), the default allowlist is the RFC 1918
private-address ranges plus loopback:

```
10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.1/32, ::1/128
```

— **not** `0.0.0.0/0`. This is a deliberate choice: anyone who can reach the
server from inside the household/office network becomes an authenticated
admin with zero credentials, which is the correct, zero-setup default for
the box-under-your-TV single-node deployment this project is primarily
built for — but it deliberately does *not* extend that trust to the public
internet the way a `0.0.0.0/0` default would (a stray port-forward or UPnP
mapping should not silently hand out admin to the entire internet). It is
still not a substitute for real per-user auth on a shared or untrusted LAN
(guest wifi, a dorm/apartment building network): anyone else on that same
private range is just as trusted as the operator. For those cases, narrow
`STREAMARR_TRUSTED_NETWORK_CIDR` to the actual trusted subnet, switch to
`AuthMode::FullAccount` (see its documented gap below), or put a real
authenticating reverse proxy in front of the server. See
`trusted_network_auth_mode`'s doc comment in `backend/src/main.rs` for the
full writeup this section summarizes.

The user every trusted-network login resolves to is whichever id
`STREAMARR_DEFAULT_ADMIN_USER_ID` names (or a boot-lifetime-random id if
unset — every session issued before a restart is then orphaned, which
today is a non-issue only because sessions don't survive a restart
either; see below).

### `AuthMode::ManagedProfiles`

A fixed set of profiles switched between with a short PIN — "who's
watching" style. There is no separate PIN field on `User`: a managed
profile's PIN *is* its `password_hash`, verified through the exact same
Argon2id check as a full-account password (`Argon2PasswordVerifier`), just
a deliberately short secret by convention. Provisioning a profile with a
known PIN is a user-provisioning concern outside `streamarr-auth`'s current
scope — see the persistence gap below.

**Security note:** `GET /api/v1/users/profiles`
(`streamarr-api::users::list_available_profiles_handler`) and
`POST /api/v1/users/profiles/{id}/verify-pin`
(`verify_profile_pin_handler`) implement this "who's watching" picker, and
are only safe to show every enabled account for because
`TrustedNetwork`/`ManagedProfiles` both mean "one trusted household" — no
one reaches either endpoint who isn't already inside that trust boundary.
Since there is no `household_id`/account-grouping concept anywhere in
`streamarr-model`/`streamarr-db` (see below), both handlers gate on
`AuthMode` directly: under `AuthMode::FullAccount` ("shared with people
outside the household" — two accounts may be complete strangers), the list
endpoint returns only the caller's own profile and the PIN-verify endpoint
rejects any target id but the caller's own. Previously neither handler
checked `AuthMode` at all, so every `FullAccount` login disclosed every
other account's username/display name/PIN-lock status server-wide — fixed
in the same pass that added this note.

### `AuthMode::FullAccount`

Ordinary username + password, Argon2id-hashed
(`streamarr_auth::login::hash_password` / `Argon2PasswordVerifier`) —
correct and fully unit-tested at the `evaluate_login` level, not a stub.
**Known gap, documented directly in `backend/src/main.rs`'s
`auth_mode_from_env`:** flipping `STREAMARR_AUTH_MODE=full-account` today
leaves a fresh deployment with **no way to log in at all**. There is no
user-provisioning tool and no persisted `UserRepo`; the only seeded `User`
(the trusted-network default admin) gets a random, never-recorded password
hash — specifically so it *can't* be logged into by password. Real `User`
persistence and a provisioning path (an admin CLI command, a first-run
setup flow, etc.) are required before this mode is usable in practice, and
the server logs a loud `tracing::warn!` to this effect at boot if it's
selected.

## What's actually wired up today

The three tiers above are all real, tested login-resolution logic. What
sits behind each trust boundary, and what happens after a successful
login, has some real gaps worth being explicit about rather than implying
a fully-built system:

- **No persisted `User`/`Policy` store.** `streamarr_auth::InMemoryUserDirectory`
  (real, not a mock — see its own doc comment) is the only `UserDirectory`
  implementation anywhere in the workspace; there is no `UserRepo` in
  `streamarr-db`, no `users` table in either migration set, and no
  `PolicyRepo`/`policies` table at all. Accounts do not survive a process
  restart and are not shared across nodes in a multi-node deployment.
- **`Policy`-based authorization is implemented but not evaluated on any
  request path yet.** `streamarr_auth::policy::DefaultPolicyEvaluator` is a
  real, fully unit-tested implementation of every rule in the "The `Policy`
  struct" section below — but no handler in `streamarr-api` currently
  constructs an `AccessContext` and calls it. The only authorization check
  actually enforced today is the binary admin/non-admin check described
  next.
- **"Admin" is a flat id set, not `Policy.is_admin`.** The source-instance
  management endpoints (`POST`/`GET`/`DELETE`/`.../{id}/sync` under
  `/api/v1/admin/source-instances`, `backend/crates/streamarr-api/src/admin.rs`)
  are the concrete example of what requires more than "logged in" today:
  they're gated by an `AdminUser` Axum extractor
  (`streamarr-api::auth_extractor`), which checks
  `streamarr_auth::admin::InMemoryAdminRegistry::is_admin(user_id)` — a
  real, thread-safe, in-process set of admin user ids, seeded at boot with
  the trusted-network default admin's id — rather than loading and
  evaluating an actual `Policy`. There is nowhere to load one *from* yet.
  See that registry's own module doc comment for the intended follow-up
  once `PolicyRepo` exists.
- **Refresh tokens and RFC 8628 device-authorization state are in-memory,
  not database rows.** `RefreshTokenService` stores each device's current
  token family in `InMemoryRefreshTokenStore` (a `DashMap`), and
  `DashMapDeviceFlowHandler` stores pending device/user code pairs in
  `InMemoryDeviceAuthorizationStore`. Both are real, working
  implementations, not test doubles — login, refresh, and device pairing
  all genuinely function — but neither survives a restart or is visible to
  a second node in a multi-node deployment.
None of this is silently papered over in code — every in-memory store above
documents its own "real, not a mock, but pending real persistence" status
directly in its module doc comment, with a `TODO(persistence)` pointing at
what should replace it.

## The `Policy` struct

`Policy` governs *authorization*, not login trust tier — it's evaluated
once a request already carries an identified `User` (`User::policy_id`
names which `Policy` applies to them), judging what that user is allowed to
do. Real shape, from `streamarr-model`:

```rust
pub struct Policy {
    pub id: Uuid,
    pub name: String,

    /// Work/library root ids this policy grants browse/playback access to.
    /// An empty list means "no explicit library grants" (all-deny by
    /// default, not all-allow) — pair with `is_admin` for the superuser
    /// bypass.
    pub library_allow: Vec<Uuid>,
    /// Absolute or root-relative folder paths hidden regardless of
    /// `library_allow` (e.g. a folder with pre-release content).
    pub blocked_folders: Vec<String>,
    /// Content-rating ceiling, e.g. `"PG-13"`.
    pub max_rating: Option<String>,
    pub blocked_tags: Vec<String>,
    pub allowed_tags: Vec<String>,

    pub can_transcode: bool,
    pub can_download: bool,
    pub can_delete: bool,
    pub can_share_public: bool,

    pub device_allow: Vec<ClientPlatform>,
    pub max_concurrent_sessions: Option<u32>,
    /// `None` = no schedule restriction (always allowed). `Some(vec)` with
    /// an empty vec means "never allowed" — an explicit lockout.
    pub access_schedule: Option<Vec<AccessWindow>>,

    /// Bypasses every other field on this struct.
    pub is_admin: bool,
}
```

`streamarr_auth::policy::DefaultPolicyEvaluator::evaluate` checks these in
cheapest/most-decisive-first order (admin bypass, library allow-list,
blocked folder prefix match, rating ceiling, blocked/allowed tags, device
allow-list, concurrent-session cap, then the access-schedule window scan,
which is the most expensive check) and returns `PolicyDecision::Allow` or
`Deny(DenyReason)` — real, tested logic. There is no `trust_tier`,
`allow_remote_access`, `session_ttl_seconds`/`refresh_ttl_seconds`,
`allow_device_pairing`, `require_email_verification`, `registration_mode`,
`parental_control_default`, or `password_policy` field on `Policy` — those
would-be fields either don't exist in the real model, or the concern they'd
express is handled elsewhere (JWT/refresh TTLs are constructor parameters
to `JwtIssuer`/passed to `RefreshTokenService::issue`, not per-`Policy`
config; there's no registration flow, password-strength policy, or email
verification anywhere in the workspace yet).

## RFC 8628 device flow for TV pairing

For platforms where typing a password with a remote control is a genuinely
bad experience, Streamarr implements the OAuth 2.0 Device Authorization
Grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) — real, working,
JSON-over-HTTP endpoints (not form-urlencoded, and not the `/api/auth/...`
paths an earlier draft of this doc used):

1. **The device requests a code:**

   ```http
   POST /api/v1/oauth/device/code
   Content-Type: application/json

   {"client_platform": "tv-webos"}
   ```

   Response (`DeviceCodeResponse`):

   ```json
   {
     "device_code": "3fa85f64...c9563b2a2",
     "user_code": "WXYZ-2349",
     "verification_uri": "https://streamarr.example/link",
     "verification_uri_complete": "https://streamarr.example/link?user_code=WXYZ-2349",
     "expires_in": 600,
     "interval": 5
   }
   ```

   `expires_in`/`interval` are configuration (`DeviceFlowConfig::code_ttl`/
   `polling_interval`), not hardcoded — `backend/src/main.rs` wires them to
   10 minutes and 5 seconds respectively today. Unless
   `STREAMARR_DEVICE_VERIFICATION_URI` supplies a public URL, the API builds
   the `/link` origin from the request's `Host` and standard forwarded host/
   protocol headers so a LAN TV does not display the server's unusable
   `0.0.0.0` bind address.

2. **The device displays `user_code`** (and, where the platform can render
   one, a QR code encoding `verification_uri_complete`) and begins polling.

3. **A logged-in human, on a separate device, approves it.** The QR code
   opens Playarr Web's `/link` page with the code pre-filled; the same page
   also accepts the displayed code manually. After normal sign-in and an
   explicit confirmation, it calls the bearer-authenticated
   `POST /api/v1/oauth/device/authorize` endpoint. That endpoint requires
   `can_stream` and binds the pending code to the authenticated user's id.

4. **The device polls for a token:**

   ```http
   POST /api/v1/oauth/token
   Content-Type: application/json

   {"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "3fa85f64...c9563b2a2"}
   ```

   While pending, `400` with `{"error": "authorization_pending"}`. Polling
   faster than `interval` seconds gets `{"error": "slow_down"}`, which per
   RFC 8628 §3.5 the client must treat as "increase the polling interval by
   5 seconds" — enforced server-side (`DashMapDeviceFlowHandler::poll_token`
   actually widens `interval_seconds` and rejects premature polls), not
   just advisory. Once `expires_in` elapses unapproved, `{"error":
   "expired_token"}`. On approval, the poll succeeds:

   ```json
   {
     "access_token": "eyJhbGciOiJIUzI1NiJ9...",
     "token_type": "Bearer",
     "expires_in": 900,
     "refresh_token": "3fa85f64...c9563b2a2..."
   }
   ```

## JWT + refresh token design

Access tokens are short-lived JWTs; long-lived state lives in an opaque
refresh token, never in the JWT itself, so revocation doesn't depend on
waiting out a long-lived token's expiry.

**Access token** — JWT, **HS256** (HMAC-SHA256, via the `jsonwebtoken`
crate's `JwtIssuer`), not EdDSA — a single shared secret
(`STREAMARR_JWT_SECRET`, at least 32 bytes; falls back to a
boot-lifetime-generated secret with a loud warning if unset) signs and
verifies every token, which is sufficient today because there is exactly
one process type (the combined `streamarr` binary) doing both; splitting
issuance and verification across services that shouldn't share a symmetric
secret would be the reason to move to an asymmetric algorithm, and hasn't
come up yet. Default lifetime 15 minutes. Real claims
(`AccessTokenClaims`):

```json
{
  "sub": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "device_id": "9d3b1f4a-...",
  "session_id": "6c1e2a90-...",
  "iss": "streamarr",
  "iat": 1752537600,
  "exp": 1752538500
}
```

`sub` is the user id; `device_id`/`session_id` ride along so a handler can
reason about `Policy::device_allow`/`max_concurrent_sessions` or per-device
revocation without a second lookup. There is no `household_id`,
`trust_tier`, `role`, or `apiv` claim — client-version enforcement is a
separate concern, handled by `streamarr-api`'s version-gate middleware
against request headers, not carried in the token.

**Refresh token** — an opaque, cryptographically random 256-bit value (two
concatenated UUIDv4s, hex-encoded — `streamarr_auth::secret::opaque_token`),
never a JWT. Only its SHA-256 hash is stored server-side
(`streamarr_auth::secret::hash_token` — a fast, unsalted hash, deliberately:
the input is already high-entropy random data, not a human-chosen secret,
so there's nothing for an attacker holding the hash to dictionary-guess).
**As of this pass that storage is `InMemoryRefreshTokenStore`, not a
`refresh_tokens` database table** — see the gap noted above. Default
lifetime 30 days, fixed at issuance (not extended by rotation): the device
must complete a full login again after 30 days regardless of activity.

Refresh is **rotate-on-use with reuse detection**, but the mechanism is a
per-device *token family* with a hash set, not a linked `rotated_from`
chain: each `RefreshTokenRecord` tracks `current_hash` (the one valid
token) plus `used_hashes` (every hash the family has ever had, including
the current one). Presenting the current hash rotates it — the old hash
stays in `used_hashes`, a fresh token is minted, and `current_hash` moves
to its hash. Presenting a hash that's in `used_hashes` but isn't
`current_hash` is reuse — evidence the token was copied and is being
replayed out-of-band — and the *entire* family is immediately marked
`revoked`, rejecting every future presentation (including of the
legitimately-current token) until the device completes a fresh login via
a brand-new `RefreshTokenService::issue` call. Presenting a hash that has
never belonged to this family at all is just `RefreshError::UnknownToken`
— not proof of compromise, and doesn't revoke anything.

There is currently no dedicated HTTP endpoint wrapping
`RefreshTokenService::rotate` in `streamarr-api` — `POST
/api/v1/auth/login` and the device flow's `POST /api/v1/oauth/token` are
the two live paths that call into refresh-token issuance
(`RefreshTokenService::issue`); a rotation/refresh-grant HTTP route is a
documented follow-up, not something this pass wired up. `max_concurrent_sessions`,
when a real `Policy` is loaded and evaluated (see the gap above), is
enforced by `streamarr_auth::policy::DefaultPolicyEvaluator` at the point
of the *authorization* check, not by refresh-token issuance evicting the
oldest session — there's no session-eviction-on-issuance logic anywhere in
`streamarr-auth` today.
