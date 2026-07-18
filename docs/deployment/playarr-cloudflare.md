# Deploy Playarr Web to Cloudflare

The standalone Playarr Web client is hosted as a Cloudflare Worker with
Static Assets at <https://playarr.app>. Cloudflare serves the Vite build from
`clients/tv-web/web/dist`; unmatched paths return `index.html` so direct
navigation to React Router routes works.

The public Clients hub is served at `/clients`; `/download` and `/install`
redirect there, and `/vidaa-store/` publishes the fixed Playarr-only VIDAA custom
store assets. Playarr does not operate a public VIDAA DNS resolver. Viewers choose
and control a compatible DNS, proxy, or self-hosted interception method themselves.

Signed Android APKs are stored in the private `playarr-client-downloads` R2 bucket.
The Worker streams the stable mobile and TV objects from same-origin `/downloads/android/`
URLs while continuing to serve ordinary application routes from Static Assets.
Android TV releases also publish a short-lived latest-version manifest and an immutable,
versioned TV APK route used by the profile page's native self-update action.

## One-time Cloudflare and GitHub setup

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers**
   template. Restrict it to the account that owns `playarr.app` and to the
   `playarr.app` zone.
2. Copy the Cloudflare account ID from the account overview.
3. In the GitHub repository, add these Actions secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Create the private R2 bucket `playarr-client-downloads`. Add a separate
   `CLOUDFLARE_R2_API_TOKEN` secret with only Account R2 Storage Edit access to
   the `release-android` environment.
5. Run the **Deploy Playarr Web** workflow once, or deploy locally. The first
   deployment creates the `playarr-web` Worker and attaches the `playarr.app`
   custom domain. Cloudflare manages its DNS record and TLS certificate.

Do not put either credential in a tracked file. The deployment needs no
runtime secrets because the Worker only serves static assets.

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
pnpm --filter @streamarr-tv/web run deploy:cloudflare
```

For non-interactive local use, export `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the shell instead of running `wrangler login`.

## Connect the hosted client to Streamarr

Playarr is only the static playback client; each viewer still connects it to
their own Streamarr server. Enter an IP address such as
`http://192.168.1.50:8484` or `http://203.0.113.10:8484` on the sign-in screen.
Cloudflare never proxies the API, and the client stores server-specific profile
sessions in the browser.

On browsers that implement Local Network Access, approve the browser prompt
the first time `playarr.app` connects to a private or loopback IP. Playarr marks
only those addresses as local-network requests so that permission can relax
mixed-content blocking. Browser support is still evolving; a browser without
Local Network Access cannot connect from the HTTPS hosted app to a private
plain-HTTP server.

For a public IPv4 address, Playarr converts the address to the deterministic
`https://v4-A-B-C-D.relay.playarr.app:8484` hostname. The parent Cloudflare
records are DNS-only: Streamarr's built-in authoritative DNS resolves that name
straight back to the entered IP, and Streamarr terminates HTTPS itself. Enable
the matching `STREAMARR_ACME_DOMAIN` in production mode so Streamarr acquires
and renews the browser-trusted certificate; the operator must also explicitly
accept the certificate authority's terms with
`STREAMARR_ACME_ACCEPT_TERMS=true`. Playarr never relays requests
through Cloudflare, and Streamarr never installs or serves a copy of Playarr.

## Domain changes

The production hostname is declared in
`clients/tv-web/web/wrangler.jsonc`. Before changing it, confirm the new
hostname has no existing CNAME record: Cloudflare custom domains cannot be
created over one.
