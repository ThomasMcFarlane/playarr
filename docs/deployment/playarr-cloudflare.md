# Deploy Playarr Web to Cloudflare

The standalone Playarr Web client is hosted as a Cloudflare Worker with
Static Assets at <https://playarr.app>. Cloudflare serves the Vite build from
`clients/tv-web/web/dist`; unmatched paths return `index.html` so direct
navigation to React Router routes works.

## One-time Cloudflare and GitHub setup

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers**
   template. Restrict it to the account that owns `playarr.app` and to the
   `playarr.app` zone.
2. Copy the Cloudflare account ID from the account overview.
3. In the GitHub repository, add these Actions secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Run the **Deploy Playarr Web** workflow once, or deploy locally. The first
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
their own Streamarr server. Enter the externally reachable server URL on the
Playarr sign-in screen. The client stores server-specific profile sessions in
the browser.

The Streamarr server must be reachable from the viewer's browser over HTTPS;
an HTTPS page cannot call a plain-HTTP server because browsers block mixed
content.

## Domain changes

The production hostname is declared in
`clients/tv-web/web/wrangler.jsonc`. Before changing it, confirm the new
hostname has no existing CNAME record: Cloudflare custom domains cannot be
created over one.
