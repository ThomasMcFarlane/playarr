# Playarr VIDAA gateway reference

Playarr does not operate this DNS gateway as a public service. It remains an optional,
self-hosted reference for operators who choose to run their own resolver and intercepted
portal. The fixed Playarr-only store assets are published separately at
`https://playarr.app/vidaa-store/`.

This fixed-purpose gateway temporarily allows one household public IP to use its DNS resolver. An
active client receives the gateway IPv4 address for the exact hostname `vidaahub.com`; every other
query is forwarded to the configured upstream resolver. Inactive, malformed, and rate-limited UDP
requests are dropped silently; inactive TCP requests receive DNS `REFUSED`, so the service is never
an open recursive UDP reflector. Global and per-source DNS rates, one shared 64-worker UDP/TCP
budget, and a 1,232-byte UDP response ceiling limit spoofing and amplification impact. Inactive
clients are rejected before DNS rate accounting, so they cannot consume an activated household's
allowance.

The HTTPS portal installs only this fixed application:

- ID: `playarr-tv`
- URL: `https://playarr.app/?platform=tv-vidaa`
- icon: `https://playarr.app/playarr-icon-512.png`

It prefers `Hisense_installApp`. The `HiUtils_createRequest` fallback is used only when required,
reads and validates the existing `websdk/Appinfo.json`, and changes only the fixed Playarr entry.
The firmware interoperability sequence is adapted from VidaaEdge under the MIT licence; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Public interface

- `POST https://dns.playarr.app/v1/activations/self` activates the request's observed source IP.
- `DELETE https://dns.playarr.app/v1/activations/self` deactivates it using the returned bearer token.
- `GET http://127.0.0.1:8080/healthz` is the local container health check.
- UDP and TCP port 53 provide DNS only to active source IPs.

The activation response contains `dns_server`, `expires_at`, `portal_url`, `ttl_seconds`, and a
`deactivation_token`. A compatibility endpoint at `POST /api/v1/activations` returns the same data
with the resolver field named `resolver_ipv4`.

Activation state is also memory-bounded: `VIDAA_MAX_ACTIVE_ACTIVATIONS` caps the registry, while
`VIDAA_ACTIVATION_GLOBAL_RATE_LIMIT_PER_HOUR` limits accepted activation requests across all source
addresses. The per-source activation rate remains independently enforced.

## Deploy

1. Point the DNS-only `A` record for `dns.playarr.app` at the VPS. Do not proxy it through a CDN.
2. Obtain a publicly trusted certificate for `dns.playarr.app` and place it in an API certificate
   directory as `fullchain.pem` and `privkey.pem`.
3. Create a separate runtime certificate for `vidaahub.com`, accepted manually on compatible TVs,
   and place it in a portal certificate directory with the same filenames. Never commit either key.
4. Copy `.env.example` to `.env`, replace the documentation IPv4 address, export
   `VIDAA_API_CERT_DIR` and `VIDAA_PORTAL_CERT_DIR`, then run `docker compose up -d --build`.
5. Restrict the health port to localhost and allow inbound TCP/UDP 53 plus TCP 443 in the VPS firewall.

For a directly exposed container, leave `VIDAA_TRUSTED_PROXY_CIDRS` empty. If a local reverse proxy
is required, list only its exact network and configure it to replace, not append to, untrusted
`X-Forwarded-For` input. The gateway walks the trusted chain from right to left. Activations are
memory-only and disappear on restart. Certificate files must be readable by container UID `10001`.
The portal certificate is the TLS default for legacy VIDAA clients without SNI; explicit
`dns.playarr.app` SNI selects the publicly trusted API certificate.
The default 64 shared DNS workers, 32 web workers, eight health workers, and five service threads
remain below the container's 128-process limit.

Run the dependency-free test suite with:

```sh
python -m unittest discover -s tests -v
```
