# Playarr relay: DNS-only phone-home

`v4-A-B-C-D.relay.playarr.app:8484` is how the hosted web client and the TV
clients reach a Playarr Server on a public IPv4 address with a browser-trusted
certificate. This page describes how those names are published, the trust
model and its limits, and the cut-over from the old in-process DNS server.

Design rules, set by the owner:

- No streaming or API traffic passes through Cloudflare. Cloudflare only holds
  DNS (DNS-only records, never proxied).
- No public DNS server runs on the cluster or in Playarr Server.
- Low cost: no Durable Objects, no KV. DNS itself is the state.
- The clients' `v4-A-B-C-D.relay.playarr.app:8484` mapping is unchanged.

## How it works

1. **Detect.** Playarr Server uses `PLAYARR_PUBLIC_IPV4` if set; otherwise it
   asks the Worker (`GET /api/relay/ip`), which answers with the address it saw
   in `CF-Connecting-IP`.
2. **Register.** On start, when the address changes (checked every five
   minutes) and hourly, the server calls the existing `playarr-web` Worker
   (the one that already serves `/api/link/*`) at `POST /api/relay/register`.
   The first call returns a stateless challenge: an HMAC-SHA256 token (Worker
   secret) binding the IP, the server id and an expiry of two minutes.
3. **Prove control of the address.** The server publishes the token and sends
   the second call carrying it. The Worker verifies the token, then calls
   `http://<ip>:8484/.well-known/playarr-relay/<token>` and requires the token
   back. The callback accepts only a public unicast IPv4 address: private,
   loopback, CGNAT (100.64/10), link-local, multicast, reserved, documentation
   and Cloudflare ranges are rejected, redirects are not followed, the timeout
   is five seconds and the response is capped.
4. **Publish.** On success the Worker upserts one DNS-only (`proxied: false`) A
   record `v4-A-B-C-D.relay.playarr.app` to `A.B.C.D`, TTL 300, with comment
   `playarr-relay server=<id> seen=<unix ts>` and no tags. A record whose
   comment does not start with `playarr-relay` is never modified or deleted.
   The `seen` stamp is only rewritten when it is more than six hours old, so
   the hourly heartbeat normally costs one DNS read and no write.
5. **ACME DNS-01.** For certificates the server uses its own ACME client
   (`instant-acme`; `rustls-acme`, used for HTTP-01, cannot do DNS-01) with
   this Worker as the DNS provider: `POST` and `DELETE`
   `/api/relay/acme-challenge` with `{challenge, name, value}`. The Worker
   allows only `_acme-challenge.v4-A-B-C-D.relay.playarr.app` for the address
   that has just passed the callback, re-running the callback on every request
   (it keeps no state), and creates or deletes a DNS-only TXT record with a
   60 second TTL and the same comment prefix. No port 80 is needed.
6. **Clean up.** A daily cron (`17 4 * * *`) lists records in the zone whose
   comment starts with `playarr-relay` (paginated, with a delay between
   deletions and `Retry-After` handling) and deletes A records unseen for more
   than seven days and TXT records older than one hour, only below
   `relay.playarr.app`.

On the server the callback is served from the 8484 listener: plain HTTP before
the first certificate exists, and plain HTTP answered *only for a published
challenge token* on the HTTPS port afterwards (all other plaintext requests are
still redirected to HTTPS). A Worker cannot skip certificate validation or send
an IP address as SNI, so the callback is plain HTTP by design; the token is a
public, two-minute value bound to one IP and one server key, so exposing it to
an on-path observer gains an attacker nothing.

Until the first certificate is issued with `relay-dns-01` the API listens on
plain HTTP for a short period (typically under two minutes); it then switches
to HTTPS on the same port and renewals reload the certificate without a
restart. A server with a still-valid cached certificate starts on HTTPS
immediately.

## Server configuration

| Variable | Meaning |
| --- | --- |
| `PLAYARR_RELAY_REGISTER=true` | Enable registration. **Off by default**: it sends your public IPv4 address and a key fingerprint to `playarr.app`. |
| `PLAYARR_PUBLIC_IPV4` | Override the address instead of using the one the Worker sees. |
| `PLAYARR_RELAY_URL` | Worker origin, default `https://playarr.app` (an `http://127.0.0.1` URL is accepted for tests). |
| `PLAYARR_ACME_CHALLENGE` | `http-01` (default) or `relay-dns-01`. `relay-dns-01` needs `PLAYARR_RELAY_REGISTER=true` and a `v4-A-B-C-D.relay.playarr.app` `PLAYARR_ACME_DOMAIN`. |

Registration cannot be combined with static `PLAYARR_TLS_*` paths on their own,
because the callback needs the plain-HTTP/ACME listener. The exception is
`PLAYARR_ACME_CHALLENGE=relay-dns-01`: the server then keeps the static
certificate (for example a cert-manager certificate for the regular public
name) as the active transport and serves the relay certificate alongside it. A
TLS SNI resolver presents the relay certificate for the `v4-A-B-C-D` name and
the static certificate for every other name or no SNI. There is no plain-HTTP
phase in this mode, because the static certificate exists from the start; the
Worker's callback is still answered in cleartext on the same port for relay
challenge tokens only. The static files are polled and reloaded, and the relay
certificate is issued and renewed in the background, both without a restart.
`PLAYARR_RELAY_DNS_BIND_ADDR` and `PLAYARR_RELAY_DNS_ACME_CHALLENGE` (the
in-process authoritative DNS server) have been removed; setting them has no
effect.

## Trust model and its limits

What the Worker verifies on every call:

- **Identity binding.** The request is signed with the server's existing
  Ed25519 node identity (the `node_identity` key that also signs peer-group
  requests). The signature covers
  `playarr-relay-v1|METHOD|path|sha256(body)|timestamp` (timestamp within two
  minutes). The server id is `sha256(public key)[0..16]` in hex, so it is
  verifiable without any stored state and stays stable while the node key does.
  The challenge token is bound to that id, so a token issued to one key cannot
  be used by another.
- **IP control.** Proven by the callback, not by the signature. A record can
  only ever point at the address that just answered the callback, and the
  hostname is derived from that address, so a registrant cannot publish a
  record for anyone else's address.
- **Name safety.** TXT writes are limited to the one ACME name of the proven
  address, with a strict value format. Records without the `playarr-relay`
  comment prefix are never touched.

Honest limits:

- This does **not** prove the server belongs to a particular user or account.
  Anyone can generate a key; the Worker keeps no registry of "known" servers
  (that would need KV or a database, which the design avoids). The security
  property is "the publisher controls this IPv4 address", which is exactly what
  the hostname asserts.
- Because the key is only an anonymous identity, the server id is informational
  (it lets you see which key last refreshed a record). Control of an IP that
  changes hands (a reassigned address) legitimately transfers the record.
- Any registrant can make `playarr.app` perform a short HTTP GET to a public IP
  on port 8484 and can create DNS records until the zone quota is reached. The
  Worker cannot rate-limit per key statelessly, so add a Cloudflare rate
  limiting rule on `/api/relay/*` (check your plan's allowance) and watch the
  record count. The zone quota is the hard ceiling (see below).
- A registered IP and its comment are public DNS data. Anyone can enumerate
  `relay.playarr.app` records via certificate transparency logs, as they already
  could for the certificates.
- The callback and the DNS-01 requests assume a Worker can fetch
  `http://<public ip>:8484`. This has not been exercised against Cloudflare from
  this branch (nothing is deployed); verify it with the first staging
  registration before cut-over.

## Worker secrets and bindings

| Name | Kind | Purpose |
| --- | --- | --- |
| `RELAY_HMAC_SECRET` | secret | HMAC key for the challenge tokens. 32 random bytes, base64. |
| `RELAY_CF_API_TOKEN` | secret | Cloudflare API token with **Zone:DNS:Edit on `playarr.app` only**. |
| `RELAY_ZONE_ID` | plain text | Zone id of `playarr.app`; set by `deploy-cloudflare-api.mjs` from the `PLAYARR_RELAY_ZONE_ID` secret. |

Until both secrets exist, `/api/relay/*` answers `503 relay_not_configured` and
the daily cleanup does nothing, so merging and deploying the code is inert.
`deploy-cloudflare-api.mjs` keeps existing secret bindings
(`keep_bindings: ["secret_text"]`) and sets the cron schedule
(`PUT /workers/scripts/playarr-web/schedules`); `wrangler.jsonc` declares the
same cron; Wrangler deployers must provide `RELAY_ZONE_ID` themselves (for example `--var RELAY_ZONE_ID:<zone id>`).

## Cloudflare zone facts (read-only inspection, 2026-10-03)

Found with a short-lived, read-only token (Zone Read, DNS Read, Zone Settings
Read), which was revoked and verified revoked afterwards:

- `playarr.app` is in the account that also hosts the `playarr-web` Worker
  (account id held in the `CLOUDFLARE_ACCOUNT_ID` secret); zone id held in
  the `PLAYARR_RELAY_ZONE_ID` secret, status active.
- Plan: **Free Website**.
- DNS record quota: **200 records**, 8 in use (`/dns_records/usage`), so about
  **190 dynamic records are available**. Each registered server uses one A
  record, plus a TXT record only during a certificate order. At 192 servers the
  zone is full and registrations return `507 dns_quota_exceeded`. Our comments are 69
  characters (Cloudflare documents a 100-character limit on the Free plan) and
  records carry no tags; a paid plan raises
  the quota, and the Worker does not depend on it.
- Existing records: 3 MX and an SPF and a DKIM TXT (Cloudflare email routing),
  a proxied `AAAA playarr.app` placeholder, the `relay` NS delegation and
  `relay-ns1` A (203.0.113.10).

## Cut-over plan (do not execute without owner approval)

The `NS relay.playarr.app -> relay-ns1.playarr.app` delegation hands the whole
`relay` subtree to the in-process DNS server on one regional server. While it exists, Cloudflare
does **not** answer for names below `relay.playarr.app`, so records the Worker
creates there would be invisible to resolvers. The order below avoids downtime.

1. **Merge and deploy the Worker code** (normal CI on `main`). It is inert
   without secrets.
2. **Create the secrets.** Mint a Cloudflare API token scoped to **Zone:DNS:Edit
   on `playarr.app` only** and a random HMAC secret, then set
   `RELAY_CF_API_TOKEN` and `RELAY_HMAC_SECRET` as Worker secrets on
   `playarr-web` (dashboard, or `cf`).
3. **Confirm the cron trigger** `17 4 * * *` is present after the deploy.
4. **Add a rate limiting rule** for `/api/relay/*` on the zone.
5. **Pre-create the two production names by hand while the delegation still
   exists.** In Cloudflare create DNS-only A records
   `v4-203-0-113-10.relay.playarr.app -> 203.0.113.10` and
   `v4-203-0-113-20.relay.playarr.app -> 203.0.113.20`, TTL 300, with the
   comment `playarr-relay server=manual seen=<current unix time>` so the Worker
   adopts them (a record without that comment prefix is never touched). They
   are shadowed by the delegation until step 6, so this changes nothing for
   resolvers yet. The servers cannot register themselves yet because they only
   do so once running the new image (step 7).
6. **Remove the delegation.** In Cloudflare delete the `NS relay.playarr.app`
   record, then the `A relay-ns1.playarr.app` record. The records from step 5
   become authoritative immediately and resolve to the same addresses the old
   DNS server returned, so there is no gap. Resolvers converge within minutes
   (the NS TTL was 120 seconds). If the order were reversed the two names would
   return NXDOMAIN until the servers registered. Note the manual records are
   deleted by the daily cleanup after seven days without a heartbeat, so step 7
   must follow within that window.
7. **Roll out the new server image and chart (PR "fix(infra): publish only
   8484 ...")**, one instance at a time, with the verification in the chart
   README. Existing cached certificates keep working during the roll.
8. **Rollback.** Re-create `NS relay -> relay-ns1.playarr.app` and `A relay-ns1
   -> 203.0.113.10` and roll the chart back; the old in-process DNS server must
   still be present in the image for that, so keep the previous image until the
   new path is verified.

Certificate note: the regional servers' certificates were issued by HTTP-01 for the same
names, so the cache is reused and nothing needs reissuing unless it is due.
