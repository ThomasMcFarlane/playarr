# Auth Modes

Streamarr's authentication model spans a deliberate spectrum from "no login
at all, on your own network" to "fully managed multi-user accounts with
remote access." It is not one auth system with optional bits switched off —
it is three named trust tiers, each a coherent, supported configuration in
its own right, selected by the server operator and encoded in a `Policy`
that every request is evaluated against.

## Why a spectrum, not one model

Streamarr runs across all three deployment tiers in
[`overview.md`](overview.md), and the right amount of auth ceremony is
different at each end: a household running a single NAS on their own LAN
should not be forced through account creation and password policies just to
watch something in their own living room, but a server operator sharing
their library with friends over the internet needs real accounts, real
sessions, and real revocation. Forcing everyone into the heavier model is
the single most common complaint about self-hosted media servers that only
offer one auth posture; forcing everyone into the lighter model makes the
software unsafe to expose to the internet at all. Streamarr supports both,
explicitly, as first-class configurations.

## The three trust tiers

| Tier | Name | Login required? | Typical deployment |
|---|---|---|---|
| 0 | **Open Household** | No | Tier 1 systemd install, LAN-only, single family |
| 1 | **Managed Household** | PIN/profile only | Tier 1 or 2, multiple people in one household, parental controls |
| 2 | **Full Multi-User** | Username/password or OAuth | Tier 2/3, remote access, shared with people outside the household |

### Tier 0 — Open Household (`TrustTier::Open`)

No login wall. There is a single implicit identity for the whole household,
comparable to a Plex "Home" with no PINs set. Every client on the LAN that
can reach the server can browse and play. This tier exists because the
majority of Tier 1 installs are a single NAS serving a single household on
its own network, and account creation is pure friction for that case with
no meaningful security benefit — anyone who can reach the server on the LAN
already has physical/network access to the box.

Remote access is disabled by default under this tier (`allow_remote_access`
defaults to `false`) precisely because there is no identity boundary to
protect once the server is reachable from the open internet.

### Tier 1 — Managed Household (`TrustTier::Managed`)

Multiple local profiles under one household (comparable to Netflix
profiles), each with an optional PIN rather than a full password. No
external-facing account system, no email verification, no password reset
flow — the household is still one trust boundary, but individual family
members get separate watch history, resume state, and per-profile parental
controls (a `parental_control_default: RatingLimit` on the profile, e.g.
capping a kids' profile to `PG` content). This is the tier most home-theatre
setups with children land on.

### Tier 2 — Full Multi-User (`TrustTier::Strict`)

Real accounts: username/password (bcrypt/argon2-hashed) or OAuth against an
external identity provider, per-user API keys, invite-based or open
registration, remote access enabled, full session and audit logging. This
is the tier for a server operator running Streamarr as shared
infrastructure — the "give three friends and your parents a login" case —
where a compromised or shared credential for one person must not expose
anyone else's account, and access needs to be revocable per-user without
affecting the rest of the household.

## The `Policy` struct

Trust tier is the headline setting, but it is one field on a broader
`Policy` that the server evaluates on every authenticated request.
`Policy` is resolved per-deployment by default (server-wide config) and can
be overridden per-user where the field says so:

```rust
pub struct Policy {
    /// The trust tier this deployment (or user) operates under.
    pub trust_tier: TrustTier,

    /// Managed-tier profiles may require a PIN before switching into them.
    pub require_pin: bool,

    /// Whether this server accepts connections from outside the LAN at all.
    /// Defaults to `false` under `Open`, `true` under `Managed`/`Strict`.
    pub allow_remote_access: bool,

    /// Access token (JWT) lifetime, in seconds.
    pub session_ttl_seconds: u32,

    /// Refresh token lifetime, in seconds.
    pub refresh_ttl_seconds: u32,

    /// Cap on concurrent active sessions per identity. `None` = unlimited.
    pub max_concurrent_sessions: Option<u32>,

    /// Whether the RFC 8628 device-authorization flow is available for
    /// pairing TV clients that cannot reasonably accept text input.
    pub allow_device_pairing: bool,

    /// Strict tier only: require a verified email before an account can
    /// authenticate.
    pub require_email_verification: bool,

    /// Strict tier only: who can create a new account.
    pub registration_mode: RegistrationMode, // Closed | InviteOnly | Open

    /// Default content-rating ceiling for new/managed profiles.
    pub parental_control_default: RatingLimit,

    /// Strict tier only: minimum password strength requirements.
    pub password_policy: PasswordPolicy,
}

pub struct PasswordPolicy {
    pub min_length: u8,
    pub require_mixed_case: bool,
    pub require_digit_or_symbol: bool,
}
```

`Policy` is loaded once at startup from server config, cached, and
re-evaluated per request against the authenticated identity (if any) rather
than baked into issued tokens, so an operator can tighten or loosen policy
(e.g. lower `max_concurrent_sessions`, flip `allow_remote_access` off) and
have it take effect immediately without forcing every client to
re-authenticate.

## RFC 8628 device flow for TV pairing

Three of the seven Playarr clients (Android TV, webOS, Tizen — and the
VIDAA fallback path, see [`clients/vidaa.md`](clients/vidaa.md)) run on
devices where typing a password with a remote control is a genuinely bad
experience. For these, Streamarr implements the OAuth 2.0 Device
Authorization Grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)),
gated by `Policy.allow_device_pairing` (on by default under Managed and
Strict tiers; irrelevant under Open, since there's nothing to pair against).

Flow:

1. **TV requests a device code.**

   ```http
   POST /api/auth/device/authorize
   Content-Type: application/x-www-form-urlencoded

   client_id=streamarr-tv
   ```

   Response:

   ```json
   {
     "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
     "user_code": "WDJB-MJHT",
     "verification_uri": "https://streamarr.example.com/link",
     "verification_uri_complete": "https://streamarr.example.com/link?code=WDJB-MJHT",
     "expires_in": 600,
     "interval": 5
   }
   ```

2. **TV displays `user_code`** (and, where the platform supports rendering
   one, a QR code encoding `verification_uri_complete`) and begins polling.

3. **User completes pairing on a phone or laptop** — either by scanning the
   QR code or by navigating to `verification_uri` and typing `user_code` —
   authenticates normally for their trust tier (PIN under Managed,
   password/OAuth under Strict), and approves the pairing request.

4. **TV polls for a token:**

   ```http
   POST /api/auth/device/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=urn:ietf:params:oauth:grant-type:device_code
   device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS
   client_id=streamarr-tv
   ```

   While pending:

   ```json
   { "error": "authorization_pending" }
   ```

   If the TV polls faster than `interval` seconds, the server responds with
   `{"error": "slow_down"}`, which the client must treat as "increase the
   polling interval by 5 seconds," per the RFC. If `expires_in` elapses
   unapproved, subsequent polls return `{"error": "expired_token"}` and the
   client must restart the flow. On approval, the poll succeeds:

   ```json
   {
     "access_token": "eyJhbGciOiJFZERTQSJ9...",
     "refresh_token": "8xLOxBtZp8...",
     "token_type": "Bearer",
     "expires_in": 900
   }
   ```

## JWT + refresh token design

Access tokens are short-lived JWTs; long-lived state lives in an opaque
refresh token, never in the JWT itself, so revocation doesn't depend on
waiting out a long-lived token's expiry.

**Access token** — JWT, signed EdDSA (Ed25519) in preference to HS256 where
key distribution allows it (multi-node deployments verify tokens
independently without sharing a symmetric secret over an insecure channel),
default lifetime 15 minutes (`Policy.session_ttl_seconds`), claims:

```json
{
  "sub": "usr_01hz8k9q3f",
  "household_id": "hh_01hz8k9q3f",
  "trust_tier": "strict",
  "role": "member",
  "apiv": 17,
  "iat": 1752537600,
  "exp": 1752538500
}
```

The `apiv` claim records the `apiVersion` the client authenticated with, so
the versioning-enforcement middleware (see
[`docs/versioning-policy.md`](../versioning-policy.md)) can reason about a
client's capability without re-parsing headers on every request.

**Refresh token** — an opaque, cryptographically random 256-bit value,
never a JWT. Only its SHA-256 hash is stored server-side (in the
`refresh_tokens` table: `token_hash`, `user_id`, `device_id`, `issued_at`,
`expires_at`, `rotated_from`, `revoked_at`). Default lifetime 30 days
(`Policy.refresh_ttl_seconds`, tunable — TV pairing sessions are typically
issued a longer-lived refresh token than a browser session, since re-pairing
a TV is a much worse experience than re-logging-in on the web).

Refresh is **rotate-on-use with reuse detection**: every call to
`/api/auth/token/refresh` consumes the presented refresh token, issues a
brand-new access token *and* a brand-new refresh token, and records the new
token's `rotated_from` pointing at the old one's hash. If a refresh token
that has already been rotated away is ever presented again, the server
treats this as a signal of token theft (a copy of an old token being
replayed), immediately revokes the entire token *chain* for that device
(walking `rotated_from` back to the root), and forces the device to
re-authenticate from scratch. This bounds the blast radius of a leaked
refresh token to the window before its next legitimate use, rather than
its full 30-day lifetime.

Revocation (logout, "sign out this device," account suspension, or the
reuse-detection path above) is a `revoked_at` write on the refresh token
row; access tokens are not individually revocable by design (they're
short-lived enough — 15 minutes — that revocation-on-refresh plus a short
TTL is the accepted tradeoff against the operational cost of a
revocation-checking cache on every request). `max_concurrent_sessions`, when
set, is enforced at refresh-token issuance: issuing a new one past the cap
revokes the oldest active session for that identity.
