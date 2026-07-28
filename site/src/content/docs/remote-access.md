---
title: Remote access and TLS
summary: Reach your Playarr server from outside your own network, ports, reverse proxies, certificates and the client-side address settings that go with them.
group: Setup
order: 13
---

Playarr speaks plain HTTP on one port by default and assumes it is sitting on a network you
already trust. Making it reachable from elsewhere is a deliberate step you take yourself, and this
page covers the whole of it: which ports matter, the three ways TLS can be terminated, complete
nginx and Caddy configurations that do not break long media responses, what each Playarr client
needs to be told about your server's address, and exactly what the project does and does not do for
your security.

> **This is your decision and your responsibility.** Putting any self-hosted service on the public
> internet exposes it to the public internet. Playarr does not open firewall ports, configure
> UPnP, register a hostname, or tunnel anything on your behalf. Nothing on this page is a
> recommendation to route around restrictions imposed by a network you do not control.

## Ports involved

| Port | Protocol | What listens | Set by | Expose publicly? |
| --- | --- | --- | --- | --- |
| `8484` | TCP | The API, the HLS and byte-range media endpoints, and, when `PLAYARR_WEB_ASSETS_DIR` points at a built Admin bundle, Playarr Admin at `/` | `PLAYARR_HTTP_BIND_ADDR` (default `0.0.0.0:8484`) | This is the only one that should ever be reachable, and only behind TLS |
| `9090` | TCP | Prometheus `/metrics`, served unconditionally by every role | `PLAYARR_METRICS_BIND_ADDR` (default `0.0.0.0:9090`) | **No.** Never proxy it to the edge |
| `80` | TCP | ACME HTTP-01 challenge listener, only when Playarr's own automatic HTTPS is enabled | `PLAYARR_ACME_HTTP01_BIND_ADDR` (default `0.0.0.0:80`) | Only while automatic HTTPS is in use |
| `53` | UDP + TCP | Optional authoritative relay DNS, served from the same process, off unless explicitly enabled | `PLAYARR_RELAY_DNS_BIND_ADDR` (unset by default) | Only for the relay-hostname flow below |

Every one of those bind variables takes a **full socket address**, not a bare port number.
`PLAYARR_HTTP_BIND_ADDR=8484` is a startup error.

If you are terminating TLS in a reverse proxy on the same host, bind Playarr to loopback so the
plain-HTTP port is not reachable from the LAN at all:

```bash
# /etc/playarr/playarr.env
PLAYARR_HTTP_BIND_ADDR=127.0.0.1:8484
PLAYARR_METRICS_BIND_ADDR=127.0.0.1:9090
```

Apply it with `sudo systemctl restart playarr.service`. There is no hot reload, every value
`Config::from_env` resolves is read once at startup.

## Choose how TLS is terminated

There are three mutually exclusive options. Pick one.

| Mode | How it is enabled | Certificate source | Reverse proxy needed |
| --- | --- | --- | --- |
| Plain HTTP | The default, no TLS variables set | None | No, but then nothing is encrypted |
| Static-certificate HTTPS | `PLAYARR_TLS_CERT_PATH` + `PLAYARR_TLS_KEY_PATH` | A PEM chain and key you supply | No |
| Automatic HTTPS | `PLAYARR_ACME_DOMAIN` + `PLAYARR_ACME_ENVIRONMENT` + `PLAYARR_ACME_ACCEPT_TERMS` | Let's Encrypt, via HTTP-01 | No |

Configuring ACME and the static `PLAYARR_TLS_*` paths at the same time is a hard startup failure,
as is setting any other `PLAYARR_ACME_*` variable without `PLAYARR_ACME_DOMAIN`.

If you instead front Playarr with nginx or Caddy, leave **all** of these unset and let the proxy
handle TLS.

### Playarr terminates TLS itself, with your own certificate

```bash
# /etc/playarr/playarr.env
PLAYARR_TLS_CERT_PATH=/etc/playarr/tls/fullchain.pem
PLAYARR_TLS_KEY_PATH=/etc/playarr/tls/privkey.pem
```

Both must be set together or startup fails. Create the directory, put your PEM chain and key in it,
and make the key readable by the `playarr` group the service unit runs as:

```bash
sudo install -d -o root -g playarr -m 0750 /etc/playarr/tls
sudo install -o root -g playarr -m 0644 <YOUR-FULLCHAIN>.pem /etc/playarr/tls/fullchain.pem
sudo install -o root -g playarr -m 0640 <YOUR-PRIVATE-KEY>.pem /etc/playarr/tls/privkey.pem
sudo systemctl restart playarr.service
```

Both files are read once, at startup, renewing the certificate on disk requires a restart.

### Playarr terminates TLS itself, with automatic Let's Encrypt

```bash
# /etc/playarr/playarr.env
PLAYARR_ACME_DOMAIN=<YOUR-SERVER-HOSTNAME>
PLAYARR_ACME_ENVIRONMENT=production        # or `staging` while testing
PLAYARR_ACME_ACCEPT_TERMS=true             # must be exactly `true`
PLAYARR_ACME_CONTACT=<YOU>@example.com     # optional
PLAYARR_ACME_CACHE_DIR=/var/lib/playarr/acme
```

`PLAYARR_ACME_ENVIRONMENT` is deliberately mandatory so a staging certificate can never be
mistaken for a browser-trusted one. `PLAYARR_ACME_ACCEPT_TERMS` must be the literal string `true`;
this is your explicit acceptance of Let's Encrypt's subscriber agreement.

Prerequisites, both on you:

1. `<YOUR-SERVER-HOSTNAME>` already resolves publicly to this machine. Playarr validates the value
   as a bare DNS hostname, no scheme, port, path or trailing dot.
2. Inbound TCP port 80 reaches the machine, for the HTTP-01 challenge.

Playarr then runs its own challenge listener on port 80, persists the account and certificate
under `PLAYARR_ACME_CACHE_DIR`, serves HTTPS on `PLAYARR_HTTP_BIND_ADDR`, and hot-renews without
a restart. Cleartext requests arriving on the challenge listener are redirected to the HTTPS origin.
If no certificate is issued within 120 seconds the process exits with an error, so watch the journal
on first start:

```bash
sudo systemctl restart playarr.service
journalctl -u playarr.service -f
```

The shipped systemd unit grants `CAP_NET_BIND_SERVICE`, which is what allows the unprivileged
`playarr` user to bind ports 80 and 53. No other privilege is granted.

> **Playarr's own ACME client only ever performs HTTP-01.** The challenge type is fixed in code
> (`UseChallenge::Http01`); there is no setting that switches it to DNS-01. If inbound port 80
> cannot reach the machine, automatic HTTPS will fail after 120 seconds and the process will exit.
> Use a reverse proxy or a static certificate instead.
>
> The two relay-DNS variables are a separate, narrower facility, not an alternative challenge type
> for the block above. `PLAYARR_RELAY_DNS_BIND_ADDR` turns on an authoritative listener for the
> `relay.playarr.app` zone inside the same process, and `PLAYARR_RELAY_DNS_ACME_CHALLENGE`
> makes that listener serve one temporary TXT record so *some other* ACME client's DNS-01 validation
> can be answered. The value must be `_acme-challenge.v4-A-B-C-D.relay.playarr.app=<VALIDATION>` , 
> the hostname is validated and rejected unless it starts with `v4-` and ends with
> `.relay.playarr.app`, and it requires `PLAYARR_RELAY_DNS_BIND_ADDR` to be set too. Remove the
> challenge setting immediately after the certificate is issued. The repository does not document an
> end-to-end procedure for obtaining and installing a certificate this way, so treat it as a
> low-level building block rather than a supported route.

## Running behind a reverse proxy

Leave `PLAYARR_TLS_*` and `PLAYARR_ACME_*` unset, bind Playarr to `127.0.0.1:8484`, and proxy
to it. Four things the proxy must get right:

- **`X-Forwarded-Proto` and `X-Forwarded-Host`.** When `PLAYARR_DEVICE_VERIFICATION_URI` is a
  relative path, and its default, `/link`, is, `POST /api/v1/oauth/device/code` builds the
  absolute verification URI it returns from these two headers, falling back to `Host` and then to
  `http://localhost`. Get them wrong and every client using the server's own device-code flow
  displays an unreachable pairing address.
- **No response buffering.** HLS segments and byte-range direct play must stream through, not be
  spooled to a temporary file first.
- **Long timeouts.** A single direct-play response can run for the length of the file.
- **Never proxy port 9090.** `/metrics` is unauthenticated; scrape it over your private network
  only.

### Caddy

Complete `Caddyfile`, TLS included, Caddy obtains and renews the certificate itself as long as the
hostname resolves to this machine and ports 80 and 443 are reachable:

```caddyfile
<YOUR-SERVER-HOSTNAME> {
	encode {
		zstd gzip
		# Never recompress media. Segments and byte-range responses are
		# already compressed and buffering them defeats streaming.
		match {
			header Content-Type text/*
			header Content-Type application/json*
			header Content-Type application/javascript*
			header Content-Type image/svg+xml*
		}
	}

	log {
		output stdout
		format json
	}

	reverse_proxy 127.0.0.1:8484 {
		header_up X-Forwarded-Host {host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Real-IP {remote_host}

		# -1 disables response buffering entirely: bytes are flushed to the
		# client as they arrive, which is what HLS and long range reads need.
		flush_interval -1

		transport http {
			dial_timeout 10s
			response_header_timeout 60s
			# No read_timeout: a direct-play response may legitimately run
			# for hours.
		}

		health_uri /healthz
		health_interval 10s
		health_timeout 3s
		health_status 200
	}
}
```

Reload without dropping connections:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

The reference Docker Compose stack ships a shorter Caddyfile at `infra/docker/prod/Caddyfile`, load
balanced across the `playarr-api` containers and reading its hostname from `{$PLAYARR_DOMAIN}`
(defaulting to `localhost`). It deliberately does not proxy 9090. Two differences matter if you copy
it rather than the configuration above: it sets `X-Forwarded-Host` but **not** `X-Forwarded-Proto`,
so device-code pairing URIs come back as `http://`, and it does not set `flush_interval -1`. Add
both lines if you use it as a starting point for a real public deployment.

### nginx

nginx does not obtain certificates itself. Get one first with certbot:

```bash
sudo certbot certonly --nginx -d <YOUR-SERVER-HOSTNAME>
```

Then `/etc/nginx/sites-available/playarr.conf`:

```nginx
upstream playarr {
    server 127.0.0.1:8484;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name <YOUR-SERVER-HOSTNAME>;

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 308 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name <YOUR-SERVER-HOSTNAME>;

    ssl_certificate     /etc/letsencrypt/live/<YOUR-SERVER-HOSTNAME>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<YOUR-SERVER-HOSTNAME>/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Playarr streams whole files; nothing is uploaded through this path.
    client_max_body_size 16m;

    # Media responses are already compressed.
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
    gzip_proxied any;

    location / {
        proxy_pass http://playarr;
        proxy_http_version 1.1;

        # Required: the device-pairing URI shown on TVs is built from these.
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

        # Pass through Playarr's own client-identification headers and any
        # CORS preflight the packaged TV apps send.
        proxy_pass_request_headers on;

        # Harmless today (Playarr exposes no WebSocket endpoint yet) and
        # correct if one is ever added.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Stream, do not spool. Without these, nginx buffers a multi-gigabyte
        # response to disk before the player sees a single byte.
        proxy_buffering             off;
        proxy_request_buffering     off;
        proxy_max_temp_file_size    0;

        # A direct-play response can run for the length of the file.
        proxy_connect_timeout   10s;
        proxy_send_timeout    3600s;
        proxy_read_timeout    3600s;
        send_timeout          3600s;
    }
}
```

`$connection_upgrade` is not built in. Add it once, in the `http` block of `/etc/nginx/nginx.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/playarr.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> **Warning, `trusted-network` auth and reverse proxies do not mix.** With
> `PLAYARR_AUTH_MODE=trusted-network`, Playarr decides whether to auto-log-in a caller as admin
> from the **socket peer address**, not from `X-Forwarded-For`. Behind a proxy, every request
> appears to come from the proxy itself, which is on a private range, and therefore inside the
> default allowlist. The effect is that anyone who reaches the proxy is admitted as an admin with
> no credentials. Keep the default `PLAYARR_AUTH_MODE=full-account` for anything reachable from
> outside your LAN. `PLAYARR_TRUSTED_NETWORK_CIDR` replaces the default allowlist with a single
> range of your choosing, but narrowing it does not fix this: the address Playarr sees is still
> the proxy's, so either the proxy is inside the range and everyone through it is an admin, or it is
> outside and nobody can sign in at all.

## CORS and allowed hosts

Two honest statements about what the server exposes here.

**CORS is permissive and there is no configuration key for it.** The API attaches
`CorsLayer::permissive`, any origin, any method, any header, no credentials, as the outermost
layer, so preflight `OPTIONS` requests are answered before authentication runs. This is deliberate,
not an oversight: the API is Bearer-token authenticated and never cookie- or session-authenticated,
so there is no CSRF surface an origin allowlist would protect. It is also load-bearing, because the
packaged webOS, Tizen and VIDAA shells run from their own app origin and always call the API
cross-origin.

**There is no allowed-hosts, trusted-origins or trusted-proxy setting.** Playarr does not validate
the `Host` header against a configured list, and does not have a setting that tells it which
upstream proxies to trust. If you need origin restriction or proxy-aware client-IP handling, it has
to be implemented in your proxy.

Three request headers must survive the proxy, all three are already covered by the configurations
above, but strip headers at your own risk:

| Header | Purpose |
| --- | --- |
| `x-playarr-client-platform` | Client platform identity, read by the API version gate |
| `x-playarr-client-version` | Client build version, read by the API version gate |
| `Authorization` | Bearer access token, the only access control the API has |

## Telling the clients where the server is

No Playarr client ships with a server address baked in. Each one learns it, once, from you, but
not all of them learn it the same way.

| Client | Status | How the address is supplied |
| --- | --- | --- |
| Browser (`playarr.app`) | Available | Absolute URL typed on the sign-in screen, e.g. `https://<YOUR-SERVER-HOSTNAME>` or `http://192.168.1.50:8484` |
| Android phones and tablets | Available | Editable server address on the sign-in screen, with a missing scheme read as `http://` |
| Android TV, Google TV | Available | **No address entry at all.** The television is linked from an already-signed-in browser through the hosted link page at `playarr.app/link`, which hands it the server addresses |
| LG webOS, Samsung Tizen | Available · Experimental install | Same hosted link flow as Android TV on a generic first launch |
| Hisense VIDAA | Available · Experimental install | Same hosted link flow |
| Roku | Available · Experimental install | Server base URL on first launch, then RFC 8628 device-code sign-in; current builds also point at the hosted link flow |
| iOS, iPadOS, Apple TV | Coming soon, **not built yet**, source only, no distributable signed build | Editable server address plus phone-friendly device-code pairing, in the source as it stands |

Which of those two paths a device takes decides which of the settings below matters, so it is worth
being clear about it: the hosted link flow at `playarr.app/link` never touches
`PLAYARR_DEVICE_VERIFICATION_URI`, while the server's own RFC 8628 flow depends on it entirely.

Additional settings that affect what clients see:

- **`PLAYARR_DEVICE_VERIFICATION_URI`** (default `/link`) sets the base URI returned by
  `POST /api/v1/oauth/device/code` for on-screen display. Because the default is a relative path it
  is resolved against `X-Forwarded-Proto`/`X-Forwarded-Host`, which is what turns it into the
  address a viewer types on their phone. Note that **Playarr Admin serves no `/link` route** , 
  the default therefore produces a URL on your own host that has no page behind it. Set this to an
  absolute URL that does (for example `https://playarr.app/link`) if you rely on the server's own
  device flow. Setting an absolute value skips the forwarded-header rewrite altogether.
- **`PUT /api/v1/admin/peer-nodes/self`** records the addresses this node advertises to clients.
  Each entry carries a `client_reachable` flag that is *operator-asserted and never auto-detected* , 
  NAT and firewall topology cannot be guessed. Only `client_reachable: true` addresses are handed to
  clients:

  ```http
  PUT /api/v1/admin/peer-nodes/self
  Authorization: Bearer <ADMIN-ACCESS-TOKEN>
  Content-Type: application/json

  {
    "name": "home",
    "addresses": [
      {"url": "https://<YOUR-SERVER-HOSTNAME>", "priority": 0, "label": "wan", "client_reachable": true},
      {"url": "http://192.168.1.10:8484", "priority": 1, "label": "lan", "client_reachable": false}
    ]
  }
  ```

  Lower `priority` sorts first. `label` is informational (`lan`, `wan`, `relay`).

### Browsers, mixed content and private addresses

The hosted browser client is served over HTTPS. A page loaded over HTTPS cannot generally reach a
plain-HTTP server. Playarr marks private and loopback addresses as local-network requests so a
browser that implements Local Network Access can prompt for permission and relax mixed-content
blocking, and you approve that prompt the first time. Browser support is still uneven: **a browser
without Local Network Access cannot connect from the HTTPS hosted app to a private plain-HTTP
server.** Giving your server a real hostname and a real certificate, by either route above, is the
way around that.

For a **public IPv4 address**, Playarr rewrites what you typed into the deterministic hostname
`https://v4-A-B-C-D.relay.playarr.app:8484`. The parent DNS records are DNS-only and no traffic is
relayed through them; Playarr's own authoritative DNS listener resolves that name straight back to
the address you entered, and Playarr terminates TLS itself. That means setting
`PLAYARR_ACME_DOMAIN` to the matching `v4-A-B-C-D.relay.playarr.app` hostname with
`PLAYARR_ACME_ENVIRONMENT=production` and `PLAYARR_ACME_ACCEPT_TERMS=true`.

Two consequences of that, both easy to miss. The clients build the URL with port `8484` hard-coded,
so `PLAYARR_HTTP_BIND_ADDR` must keep listening on `8484`, do not move it. And because Playarr
issues that certificate over HTTP-01, inbound port 80 still has to reach the machine, exactly as in
the automatic-HTTPS section above.

## Security posture, what the project does and does not do

**What Playarr does:**

- Authenticates every non-public route with a Bearer access token. The unauthenticated route
  allowlist is a short, closed list: `/api/system/health`, `/api/system/ready`,
  `/api/system/version`, `/api/v1/auth/login`, `/api/v1/auth/signup` (which itself requires a valid
  `invite_token` in the body, it is not open registration), `/api/v1/auth/refresh`,
  `/api/v1/oauth/device/code`, `/api/v1/oauth/token`, `/webhooks/{instance_id}` and
  `/api/v1/peer/enroll` (authorised by a one-shot join token in the request body rather than a JWT).
  Note that `/webhooks/{instance_id}` takes no token at all, if you expose the server publicly,
  anyone who guesses an instance UUID can post to it.
- Hashes account passwords with Argon2id.
- Generates a random bootstrap admin password when `PLAYARR_BOOTSTRAP_ADMIN_PASSWORD` is unset and
  logs it exactly once, at WARN. There is no shipped default password.
- Defaults `PLAYARR_AUTH_MODE` to `full-account`, and scopes the opt-in `trusted-network` mode to
  RFC 1918 plus loopback rather than `0.0.0.0/0`, so a stray port-forward does not hand out admin.
- Terminates TLS in-process when you configure it to, and hot-renews ACME certificates without a
  restart.
- Runs under a hardened systemd unit: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
  `PrivateTmp`, `UMask=0027`, and `CAP_NET_BIND_SERVICE` as the only capability.

**What Playarr does not do:**

- It does not enable TLS for you. The default is plain HTTP.
- It does not restrict origins or validate the `Host` header, and has no trusted-proxy setting.
- It does not rate-limit or lock out repeated sign-in attempts.
- It does not encrypt integration credentials at rest. Despite the `api_key_encrypted` column name,
  the API keys you give it for your library-management apps are stored as plain text, protect the
  database file and its backups accordingly.
- It does not open ports, manage your firewall, register DNS, or create tunnels.
- It has no built-in fail2ban-style protection, no WAF, and no audit log of failed authentication.

> **Exposing a server to the internet is your decision and your responsibility.** If you are not
> comfortable operating a public HTTPS endpoint, keep Playarr on your LAN and reach it over a VPN
> you control instead, the client address settings above work identically over a VPN, and nothing
> in Playarr needs to change.

## Verifying it works

```bash
# Liveness through the proxy, from another machine.
curl -fsS https://<YOUR-SERVER-HOSTNAME>/healthz

# Readiness, 200 only once migrations have applied and the pool is connected.
curl -fsS -o /dev/null -w '%{http_code}\n' https://<YOUR-SERVER-HOSTNAME>/readyz

# Confirm the forwarded headers reach Playarr: the verification_uri in this
# response must be your public HTTPS address, not http://localhost/link.
# client_platform is required and must be one of the ClientPlatform values , 
# android-mobile, android-tv, ios, web, tv-webos, tv-tizen, tv-vidaa,
# playarr-admin. Omitting it returns 422, not a device code.
curl -fsS -X POST https://<YOUR-SERVER-HOSTNAME>/api/v1/oauth/device/code \
  -H 'Content-Type: application/json' \
  -d '{"client_platform":"web"}'

# Confirm metrics are NOT reachable from outside. This must fail. Port 9090
# is plain HTTP even when 8484 is behind TLS, so test it as http://.
curl -fsS --max-time 5 http://<YOUR-SERVER-HOSTNAME>:9090/metrics
```

If the third command returns a `verification_uri` of `http://localhost/link`, your proxy is not
sending `X-Forwarded-Proto` and `X-Forwarded-Host`.

> The repository ships a reference Caddy configuration for the Docker Compose tier at
> `infra/docker/prod/Caddyfile`, and no reverse-proxy example at all for the systemd tier or the
> Kubernetes tier, the Helm chart and kustomize manifests contain no Ingress or Gateway resource,
> because ingress class, certificate issuer and hostname are all cluster-specific. The nginx
> configuration above is written for this documentation rather than copied from the repository.
