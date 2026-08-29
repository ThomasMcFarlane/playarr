# Google Play review server

This Cloudflare Worker is a sterile compatibility target for Google Play's
review team. It is not a hosted Playarr product and it provides no registration,
account provisioning, media uploads, library management or access to a private
Playarr Server.

The Worker implements the Android client's real login, refresh, catalogue,
profile, detail and direct-play response shapes. Fixed reviewer credentials are
stored only as Cloudflare Worker secrets. Every API route requires a signed,
expiring bearer token except health/version and the login/refresh endpoints.
The stream route additionally accepts a short-lived, signed playback capability
created by the negotiation endpoint.

Browser access is restricted to `https://playarr.app` through an explicit CORS
allow-list. Its login preflight, bearer-authenticated API requests, artwork and
ranged media responses are supported; arbitrary web origins are rejected.

The catalogue contains exactly one title: **Big Buck Bunny**, copyright 2008
Blender Foundation, published under
[Creative Commons Attribution 3.0](https://peach.blender.org/about/). The fixed
427×240 Internet Archive MP4 rendition URL is compiled into the Worker as the
only permitted upstream media resource. Arbitrary media IDs and URLs are
rejected.

The poster and backdrop are fixed raster files from Wikimedia Commons rather
than generated marketing graphics. Both are Big Buck Bunny artwork published
under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) and are proxied
unchanged through the same authenticated, allow-listed surface so the native
Android image pipeline can display the real catalogue. Attribution: `(c)
copyright Blender Foundation | www.bigbuckbunny.org`.

## Test

```sh
cd clients/tv-web
pnpm --filter @playarr-tv/play-review-server test
```

## Deploy

Deployment uses the Cloudflare REST API directly; Wrangler and browser login are
not used.

Required environment values:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with `Workers Scripts Write` for the Playarr account
- `PLAY_REVIEW_USERNAME` (at least 12 characters)
- `PLAY_REVIEW_PASSWORD` (at least 20 characters)
- `PLAY_REVIEW_TOKEN_SIGNING_SECRET` (at least 32 characters)

The workflow becomes operational only after all five values exist in the
protected `google-play-review` GitHub environment. It can then be dispatched
manually and deploys automatically after a successful `main` CI run.

```sh
cd clients/tv-web
pnpm --filter @playarr-tv/play-review-server deploy:cloudflare
```

The deploy script uploads `playarr-google-play-review`, attaches
`review.playarr.app`, then proves health, authentication, the one-item catalogue,
playback negotiation and a real video byte-range response. It never prints the
credentials or signing secret.

## Play Console instructions

Under **App content → Sign-in details**, declare that functionality is restricted
and provide the server URL plus the operator-issued reviewer credentials. State
that Playarr itself does not offer accounts and that these credentials exist
only for Google's isolated review environment.
