# DNS-only HTTPS names for public Streamarr servers

This authoritative DNS service maps a hostname such as
`v4-203-0-113-10.relay.playarr.app` directly to `203.0.113.10`. It does not
accept HTTP, proxy requests, terminate TLS, inspect API calls, or carry media
traffic. After DNS resolution, Playarr connects straight to that IP on
Streamarr's standard port, `8484`.

## Install the authoritative server

Download and verify an official CoreDNS Linux binary, place it beside this
README as `coredns`, then run:

```bash
sudo ./install.sh ./coredns
sudo systemctl enable --now streamarr-relay-dns.service
dig @127.0.0.1 v4-203-0-113-10.relay.playarr.app A
```

The service binds UDP and TCP port 53. Ensure both protocols are allowed by
the host and provider firewall.

## Delegate DNS without proxying traffic

Create these records in the parent `playarr.app` zone with Cloudflare proxying
disabled:

| Type | Name | Value |
| --- | --- | --- |
| `A` | `relay-ns1` | `<authoritative-server-public-ipv4>` |
| `NS` | `relay` | `relay-ns1.playarr.app` |

The nameserver is outside the delegated child zone, so the parent `A` record
provides its address without in-zone glue. Cloudflare only answers the parent
DNS lookup; Streamarr API and media traffic never passes through Cloudflare.

One authoritative server is sufficient for a functional initial deployment
but is a single point of failure. Add `relay-ns2` on a different host and
network before treating the DNS service as highly available.

## Issue each server certificate

Each public Streamarr host needs an exact-name certificate. ACME HTTP-01 uses
port 80 only for validation; Streamarr itself continues to serve native HTTPS
on port 8484. For example:

```bash
sudo certbot certonly --standalone \
  --domain v4-203-0-113-10.relay.playarr.app
```

Copy the resulting `fullchain.pem` and `privkey.pem` to a root-owned,
`streamarr`-group-readable directory, set both `STREAMARR_TLS_CERT_PATH` and
`STREAMARR_TLS_KEY_PATH`, and restart Streamarr. Install the same copy-and-
restart operation as the certificate's renewal deploy hook.

The child zone permits Let's Encrypt exact-name certificates and explicitly
forbids wildcard certificate issuance.
