# Client principles: native, parity, performance

Status: canonical product policy for every Playarr client. Binding on new work
and on reviews. When another document, marketing line, or implementation
disagrees with this file, **this file wins** until it is deliberately revised.

Related:

- Architecture entry point: [`overview.md`](overview.md)
- Per-platform architecture: [`clients/`](clients/)
- Product surface parity audit (Android reference): [`clients/android-web-parity.md`](clients/android-web-parity.md)
- Roadmap status (what is built vs missing): [`../roadmap.md`](../roadmap.md)

## The rule in one paragraph

**Every Playarr app is a fully native client of its platform.** Every app
targets **full product parity** with the richest complete client, and
**native-class performance** on that hardware. The only allowed reason to omit
or simplify a feature is a **real platform capability gap** (for example,
offline downloads where the OS or store rules make them impossible). Temporary
shells, WebViews of Playarr Web, browser fallbacks, and reduced feature sets
for convenience or shipping speed are **not** the product bar, even when they
exist in the tree today.

## What "fully native" means

For each target, the primary UI and interaction path uses that platform's
first-class application model and toolkit, not a generic web page wrapped for
distribution.

| Surface | Native means |
| --- | --- |
| Android phone / tablet / TV / Google TV | Jetpack Compose UI, Media3 playback, system IME, Leanback/D-pad focus. **No WebView presentation layer** for the signed-in product experience. |
| iOS / iPadOS / tvOS | SwiftUI (or UIKit only where required), AVFoundation / AVKit. **No WebView** for catalogue, settings, or player chrome. |
| Roku | SceneGraph + native `Video` node. Not a browser channel. |
| Xbox | UWP / WinUI XAML + Media Foundation / `MediaPlayerElement`. Browser Edge is a **zero-install fallback**, not the product client. |
| HarmonyOS | ArkTS / ArkUI + platform `AVPlayer`. Not a packaged copy of Playarr Web. |
| LG webOS / Samsung Tizen | Vendor TV package with platform lifecycle, remote keys, and **native decode surfaces where the vendor exposes them** (e.g. Tizen AVPlay). Sharing React UI with Web is allowed only as a deliberate platform-stack choice, never as a permanent excuse for missing features, weak focus, or non-native playback when a native plane exists. |
| Hisense VIDAA | Prefer a real installed app when the platform permits one. Hosted Web in the TV browser is a **capability-limited delivery path**, not a licence to ship a thinner product. |
| Web (browser / PWA) | The browser *is* the platform: React + MSE/Shaka (or equivalent), real scroll containers, keyboard/pointer/D-pad where relevant. "Native" here means first-class web app behaviour, not a thin marketing site. |
| Cast receiver | CAF / platform receiver APIs with the shared cast protocol. Not a full library shell. |

### Forbidden as the long-term product shape

1. **WebView shells** of Playarr Web (or any hosted SPA) as the signed-in
   Android, iOS, HarmonyOS, Roku, or Xbox experience.
2. **Feature thinning** on one client because another client already has the
   UI ("users can just open the web app").
3. **Performance that depends on a browser engine** on a platform that has a
   real native UI and media stack, when the native path is available.
4. **Treating a temporary fallback as done.** Fallbacks must be labelled as
   fallbacks in docs, roadmap, and UI copy until the native path matches
   parity.

### Allowed temporary fallbacks

These may exist while the native path is unfinished. They are **not**
success criteria:

| Fallback | Allowed while… | Must not… |
| --- | --- | --- |
| Xbox Edge browser profile | Native UWP package is not installable for the audience | Replace the native head as the long-term Xbox product |
| VIDAA TV Browser / hosted Web | No durable official package channel | Drop features that the browser stack can still implement |
| webOS / Tizen shared Web UI | The package still uses vendor lifecycle + native player where available, and feature parity is maintained | Ship a permanent second-class catalogue or player |
| Hosted Web on any device | User chooses the browser client, or no native package exists yet | Block native work or redefine "available" as "use the website" |

## Full parity

**Parity** means a signed-in viewer can complete the same tasks on every
complete client, with the same information hierarchy and the same server
contract, using that platform's native controls.

### Required product surfaces (complete clients)

Unless a row in [Capability-based degradation](#capability-based-degradation)
applies, every complete client implements:

1. **Auth and profiles** — server/account sign-in or device linking, profile
   picker, PIN where the server requires it, sign-out.
2. **Home** — feature stage, continue/start watching, kind rails gated by
   catalogue access.
3. **Search** — query, kind filters, work and playlist results.
4. **Libraries** — series, movies, sites, music (and other kinds the server
   exposes), with sort/view controls appropriate to the form factor.
5. **Title / work detail** — hierarchy, playable children, watched state,
   playlists actions the API supports.
6. **Playlists** — list, create, reorder, remove, play.
7. **Player** — negotiate direct/HLS, resume, progress heartbeat, audio and
   text tracks, quality where offered, fullscreen / ten-foot chrome.
8. **Settings** — appearance, language, player defaults, server/profile
   management, invitations where the account may use them.
9. **Errors and offline shell** — recoverable errors, retry, and an honest
   offline or unreachable-server state (not a blank screen).

The Android ↔ Web surface table in
[`clients/android-web-parity.md`](clients/android-web-parity.md) is the
reference checklist for mobile/TV layout variants. New complete clients should
extend that style of audit, not invent a thinner product.

### Parity is behavioural, not pixel-identical

- Match **tasks, data, and hierarchy**, not CSS class names.
- Use each platform's focus, scroll, typography, and safe-area conventions.
- Shared design tokens (surfaces, brand accent, ten-foot stage geometry) stay
  aligned so the product still feels like Playarr.

## Full performance

Every client is expected to feel like a first-party media app on that device:

1. **Prefer direct play** whenever the negotiated capability profile allows
   it; fall back to server HLS/transcode only when needed.
2. **Use the platform media pipeline** (Media3, AVPlayer, AVPlay, Media
   Foundation, Roku `Video`, MSE in the browser). Do not re-implement demux in
   JS on platforms that already decode the container natively.
3. **Native scrolling and focus** — content must be reachable with the
   platform's normal scroll and focus systems. Focus-only fake scrolling is
   not enough on surfaces that have a wheel, trackpad, or touch.
4. **No unnecessary WebView or browser engine tax** on native toolkits.
5. **Artwork and list virtualisation** appropriate to the platform so large
   libraries remain responsive.
6. **Session and token handling** that does not hitch playback (refresh off the
   hot path; fail over across peer servers where the client participates in
   peer groups).

Performance regressions that exist only because a client reuses a web shell on
a native-capable OS are treated as **bugs against this policy**, not as
accepted platform limits.

## Capability-based degradation

Omit or simplify a feature **only** when the platform, store policy, or
hardware cannot support it. Document the gap next to the client. Do not omit
the feature on a platform that can implement it.

| Capability | Typical full support | Legitimate degrade / omit |
| --- | --- | --- |
| Offline downloads | Android, iOS, desktop Web (where storage APIs allow), HarmonyOS when APIs allow | Roku, many TV store packages, Cast receivers, Xbox if storage/policy blocks background download; hide download UI rather than showing a dead control |
| Background download / retention policies | Mobile OS background work | TV platforms without reliable background agents |
| Local cast of on-device files | Not required anywhere | Cast only server-backed streams (see [`clients/cast.md`](clients/cast.md)) |
| In-app update to a new binary | Sideload Android, Web service worker, some TV packages | iOS/tvOS App Store rules; Xbox Store / MSIX channel constraints |
| Push invitations | FCM / APNs / Harmony push when configured | Platforms without a push channel: poll or omit push, keep in-app invitation UI if API allows |
| DRM | Only if server ever issues DRM config | Omit until server contract exists; do not fake DRM UI |
| Codecs / containers | Claim only what the device pipeline actually decodes | Narrower playback profile + server transcode (honest capability string) |
| Picture-in-picture / AirPlay / platform cast | Where OS APIs exist | Omit where APIs do not exist |
| Multi-server join / peer failover | Clients with full networking stacks | Extremely constrained runtimes may do single-server only until parity work lands; must be listed as a gap |

**Rule of thumb:** if the server API exposes it and the OS can do it, the
client ships it. If the OS cannot, the client degrades **gracefully** (hide or
disable with a clear reason, never crash or pretend success).

## Code sharing vs native presentation

Sharing is encouraged **below** the native chrome:

- One OpenAPI contract and generated or lock-step clients.
- Shared domain rules (auth retry, version compatibility, cast protocol,
  playback negotiation shapes).
- Shared design tokens and parity checklists.

Sharing must not force a single UI runtime onto every OS. Prefer:

- one Compose graph for all Android form factors;
- one SwiftUI family for Apple platforms;
- one ArkUI HAP with runtime phone/TV identity;
- Web + vendor bootstrap only where the vendor app model is itself web-plus-native-player;
- a true native head wherever that is the platform standard (Roku, Xbox, etc.).

## Current deviations (must close)

These are **known violations or temporary fallbacks**, not target architecture.
Do not extend them. Prefer removing them over building new features on top.

| Deviation | Location | Target |
| --- | --- | --- |
| Android TV signed-in experience hosts Playarr Web in a full-screen WebView (`PlayarrTvWebShell`) | `clients/android/` | Restore full native Compose television UI + Media3 for the entire signed-in product; WebView is not an accepted end state |
| Docs/READMEs that still claim "no WebView" while `PlayarrTvWebShell` is mounted on television | Android README, `clients/android-tv.md`, `android-web-parity.md` | Match reality until the WebView is removed, then restore the no-WebView claim |
| overview.md historically described Android as React/TypeScript shared with TV web | `docs/architecture/overview.md` | Android is native Compose; Web sharing is for webOS/Tizen/VIDAA/Web only |
| Packaged webOS/Tizen UI is the shared React app | `clients/tv-web/apps/*` | Keep native player + lifecycle; maintain full product parity; revisit thicker native UI only if the web stack cannot meet performance |
| Xbox Edge browser route | Playarr Web UA / profile | Zero-install fallback beside native UWP |
| VIDAA primarily via TV Browser | Hosted Web | Capability-limited delivery until a durable package path exists |
| Incomplete clients (subset of surfaces) | e.g. early Roku, unfinished store heads | Grow to the required surface list; do not redefine parity downward |

When you touch a row above, either close the gap or leave an explicit
follow-up in `CHANGELOG.md` / roadmap. Silent acceptance is not allowed.

## Agent and review checklist

Before merging client work, confirm:

1. **Native path** — UI and player use the platform toolkit in the table above
   (or this is an explicitly labelled temporary fallback).
2. **Parity** — no complete-client feature was dropped without a capability
   row and user-visible degrade behaviour.
3. **Performance** — direct play and native media/scroll/focus preferred;
   no new WebView shell on native-capable OS targets.
4. **Honesty** — docs, site copy, and changelog do not call a fallback
   "native" or "done" when it is not.
5. **Tests** — parity or contract tests updated when surfaces move.

## Document history

- 2026-07-29 — Initial canonical policy: fully native clients, full parity and
  performance, capability-only degradation; catalogue of known deviations
  including Android TV WebView shell.
