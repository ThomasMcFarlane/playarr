# Deploy Playarr Web to Cloudflare

The standalone Playarr Web client is hosted as a Cloudflare Worker with
Static Assets at <https://playarr.app>. Cloudflare serves the Vite build from
`clients/tv-web/web/dist`; unmatched paths return `index.html` so direct
navigation to React Router routes works.

Cloudflare hosts only the client app (the web UI, release downloads and relay DNS registration). It never receives or
stores Playarr server data: backups, media, databases and logs stay on the self-hoster's own infrastructure and are
never sent to or routed through Cloudflare.

The public Clients hub is served at `/clients`; `/download` and `/install`
redirect there, and `/vidaa-store/` publishes the fixed Playarr-only VIDAA custom
store assets. Playarr does not operate a public VIDAA DNS resolver. Viewers choose
and control a compatible DNS, proxy, or self-hosted interception method themselves.

Every client download is served from GitHub Releases only; the Worker has no storage binding for
downloads. The all-platform release `v<version>` (`.github/workflows/release.yml`) carries the signed
Android APK and its manifest, the Playarr Server tarballs, checksums and `latest.json`, the Roku
developer-mode ZIP and the webOS IPK; Android and the server may also come from the per-platform tags
`android-v<version>` and `backend-v<version>`. The Worker keeps the stable same-origin URLs and resolves
them to release assets (looked up through the GitHub Releases API and cached for five minutes):

| Path | Redirects to |
|---|---|
| `/downloads/android/playarr-android.apk` | `playarr-android.apk` of the newest stable `v*` or `android-v*` release that has it |
| `/downloads/android/releases/<version>/{playarr-android.apk,SHA256SUMS}` | that asset of `v<version>`, else `android-v<version>` |
| `/downloads/server/playarr-server-linux-{amd64,arm64}.tar.gz` (and `.sha256`) | `playarr-server-<version>-linux-<arch>.tar.gz` of the newest stable `v*` or `backend-v*` release |
| `/downloads/server/playarr-server-<version>-...` | that asset of `v<version>`, else `backend-v<version>` |
| `/downloads/roku/playarr-roku.zip` | `playarr-roku-<version>.zip` of the newest `v*` release |
| `/downloads/webos/playarr-webos.ipk` | `playarr-webos-<version>.ipk` of the newest `v*` release |
| `/downloads/tizen/playarr-tizen.wgt` | `playarr-tizen-<version>.wgt` of the newest `v*` release (none yet: a `.wgt` needs the owner's Samsung certificate profile, so releases carry the unsigned package root) |

The small JSON manifests (`/downloads/android/playarr-android.json`, `/downloads/server/latest.json`) are
proxied so the native television self-update action and the Clients hub read them same-origin. A path
whose asset is in no release (or when GitHub cannot be reached) returns 404 "not published yet". No
release workflow uploads to object storage. See [Releasing Playarr](releases.md) and
[Playarr Server releases](server-releases.md).

The Worker also owns the short-lived first-contact broker under `/api/link/*`. Each
generated code is isolated in a Durable Object and expires after five minutes. The record contains
only the requesting device secret, the selected Playarr Server addresses, and a single-use
Playarr Server device code; it never receives a password, browser bearer token, or refresh token.

## One-time Cloudflare and GitHub setup

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers**
   template. Restrict it to the account that owns `playarr.app` and to the
   `playarr.app` zone.
2. Copy the Cloudflare account ID from the account overview.
3. In the GitHub repository, add these Actions secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Run the **Deploy Playarr Web** workflow once, or deploy locally. The first
   deployment creates the `playarr-web` Worker, its `LinkSession` Durable Object namespace, and
   the `playarr.app` custom domain. Cloudflare manages its DNS record and TLS certificate.

Do not put either credential in a tracked file. The linking broker needs no
runtime secrets (only Durable Object storage and Web Crypto randomness). The
relay endpoints stay disabled (`503 relay_not_configured`) until the two relay
Worker secrets exist; see [Playarr relay](playarr-relay.md). Deployments keep
those secrets (`keep_bindings: ["secret_text"]`) and set the daily cleanup cron.

## Automatic production deployment

`.github/workflows/web-ci.yml` deploys the exact commit that passed the main
CI workflow. It runs automatically after a successful `push` CI run on
`main`; pull requests and failed CI runs never deploy. The workflow can also
be started manually from GitHub Actions and always targets the current `main`
commit in that case.

GitHub serialises production deployments through the
`deploy-playarr-web-production` concurrency group. Each run installs the
locked pnpm workspace, tests and builds the web client, then runs
`wrangler deploy` with the two repository secrets.

## Manual local deployment

Authenticate once using Cloudflare's browser flow:

```sh
cd clients/tv-web
pnpm dlx wrangler@4 login
```

Then deploy from the repository root:

```sh
just playarr-deploy
```

The equivalent command without `just` is:

```sh
cd clients/tv-web
pnpm install --frozen-lockfile
pnpm --filter @playarr-tv/web run deploy:cloudflare
```

For non-interactive local use, export `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the shell instead of running `wrangler login`.

## Connect the hosted client to Playarr Server

Playarr does not proxy playback or API traffic; each viewer still connects it to
their own Playarr Server. In a browser, enter an IP address such as
`http://192.168.1.50:8484` or `http://203.0.113.10:8484` on the sign-in screen.
On Android TV, scan or enter the generated `playarr.app/link` code and select an existing browser
profile instead; its server URLs are transferred automatically. Cloudflare never proxies the
Playarr Server API, and the client stores server-specific profile sessions locally.

On browsers that implement Local Network Access, approve the browser prompt
the first time `playarr.app` connects to a private or loopback IP. Playarr marks
only those addresses as local-network requests so that permission can relax
mixed-content blocking. Browser support is still evolving; a browser without
Local Network Access cannot connect from the HTTPS hosted app to a private
plain-HTTP server.

For a public IPv4 address typed without a port, Playarr converts the address to the
deterministic `https://v4-A-B-C-D.relay.playarr.app` hostname, tries port 443 and then
falls back to port 8484 (the server's default listener), remembering whichever
worked. A port you type is always used as typed. The records below
`relay.playarr.app` are DNS-only and are published by this Worker after the
server proves control of the address; see [Playarr relay](playarr-relay.md).
Playarr Server terminates HTTPS itself. Enable the matching
`PLAYARR_ACME_DOMAIN` in production mode so Playarr Server acquires and
renews the browser-trusted certificate (ACME DNS-01 through the Worker needs no
port 80); the operator must also explicitly accept the certificate authority's
terms with `PLAYARR_ACME_ACCEPT_TERMS=true`. Playarr never relays requests
through Cloudflare, and Playarr Server never installs or serves a copy of Playarr.

## Domain changes

The production hostname is declared in
`clients/tv-web/web/wrangler.jsonc`. Before changing it, confirm the new
hostname has no existing CNAME record: Cloudflare custom domains cannot be
created over one.
