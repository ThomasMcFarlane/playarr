# Playarr Cast Receiver

A thin CAF (Cast Application Framework) SDK host: a custom Google Cast web
receiver that plays Playarr Server media casted from a Playarr sender (Web,
Android, or iOS). It is not a packaged distribution of `clients/tv-web/web`:
it has no React, no routes, and no UI beyond what the CAF SDK itself draws.
See [`docs/architecture/clients/cast.md`](../../../../docs/architecture/clients/cast.md)
for the full architecture, protocol, and auth model.

In production this app is hosted at `playarr.app/cast/` (see
`clients/tv-web/web/scripts/copy-cast-receiver.mjs` and `worker.js`'s `/cast`
routes): a real Chromecast always loads it from there, never from a local
dev server.

## Build

```sh
cd clients/tv-web
pnpm install --frozen-lockfile
pnpm --filter @playarr-tv/app-cast-receiver run typecheck
pnpm --filter @playarr-tv/app-cast-receiver run test
pnpm --filter @playarr-tv/app-cast-receiver run build
```

`build` writes `dist/index.html` and `dist/assets/*` with `base: "/cast/"`
baked in, matching where the hosted Worker serves it from.

## Testing LOAD requests by hand with the Cast Command & Control (CaC) tool

Before touching any sender at all, you can drive the receiver directly with
Google's [Cast Command & Control tool](https://casttool.appspot.com/cac/):
it lets you register a device, launch a receiver application by App ID, and
send raw `LOAD`/media-status requests from a form, with no sender code
involved.

1. Serve a local build somewhere the Cast device can reach over HTTP(S),
   e.g. `pnpm --filter @playarr-tv/app-cast-receiver run build && pnpm dlx serve dist -l 4173`,
   or point a tunnel (`ngrok`, `cloudflared`) at it if the Cast device isn't
   on the same LAN as your dev machine. CaC needs an app registered in the
   [Google Cast Developer Console](https://cast.google.com/publish/) pointing
   at that served URL. The placeholder App IDs baked into each sender
   (`0000PLAYARR` etc., see the architecture doc) are not real registrations
   and won't work here; register a real (even unpublished/test) receiver
   application for this.
2. Open CaC, sign in with the Google account associated with that Console
   registration, and add your Chromecast device.
3. Launch your receiver's App ID from CaC: this loads your locally-served
   `dist/index.html` on the physical Cast device.
4. Use CaC's "Load Media" form to send a raw `LOAD` request. Set the
   `customData` field to a `PlayarrCastLoadRequest` JSON payload matching
   `@playarr-tv/cast-protocol`'s shape (protocol version, item, playback
   intent, server, and credentials); see
   [`packages/cast-protocol/src/index.ts`](../../packages/cast-protocol/src/index.ts)
   for the exact fields. This exercises `main.ts`'s LOAD interceptor,
   negotiation, and playback exactly as a real sender would, without writing
   or running any sender code.
5. CaC also shows live media status and lets you send `SEEK`/`PAUSE`/`STOP`,
   useful for testing the receiver's SEEK-renegotiation path on its own.

## Attaching the Chrome remote debugger

Chromecast devices expose a remote-debugging endpoint on **device port 9222**
once the receiver app is running, reachable the same way as any other remote
Chrome target:

1. Find the Cast device's IP (router admin page, or the Google Home app's
   device details).
2. On a desktop Chrome, open `chrome://inspect/#devices`.
3. Under **Discover network targets**, add `<device-ip>:9222` and it should
   show up in the target list once the receiver is running; open its
   `inspect` link for a normal DevTools window (console, network, sources):
   the receiver logs and any thrown errors show up here exactly like a
   regular web page.

**Detach the debugger when you're done.** A remote-debugging connection left
attached keeps the receiver's renderer in an instrumented state and holds
resources on the Cast device (a low-power embedded box, not a desktop) even
once you've closed the DevTools window locally if the underlying socket isn't
actually closed. Leaving it attached across sessions has been observed to
degrade playback and eventually force a reboot of the device. Close the
`chrome://inspect` DevTools window (not just the browser tab you were testing
from) before walking away, and remove the stale target entry if you won't be
debugging that device again soon.

## Known limitations

See the "Known limitations" section of
[`docs/architecture/clients/cast.md`](../../../../docs/architecture/clients/cast.md):
no Cast Developer Console registration exists yet for the shipping app, so
every App ID referenced by a real sender today is a placeholder; use your own
test registration for the CaC workflow above.
