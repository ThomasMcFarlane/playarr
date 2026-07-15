# Client Architecture: VIDAA (Hisense/Toshiba Smart TVs)

VIDAA is Hisense's (and, under license, Toshiba's) Smart TV operating
system. It is the seventh entry in the 7-client strategy, and it is the one
client in that strategy that is **not** shipped through a native
app-store submission. This document exists specifically to record that
decision and the fallback approach taken instead, so it is not silently
forgotten or periodically re-litigated without the context of why it was
made.

## Feasibility verdict

**There is no viable public SDK or app-store-submission path for an indie
developer on VIDAA.** Unlike LG's webOS (`webostv.developer.lge.com`,
open self-service developer registration) or Samsung's Tizen (Samsung
Seller Office, open self-service registration gated only by identity
verification and a certificate profile — see [`tizen.md`](tizen.md)),
Hisense does not offer an equivalent open, self-service developer portal
and app store submission process for VIDAA. Getting an app listed in the
VIDAA App Store in practice requires a direct business relationship /
partnership with Hisense rather than a documented, publicly accessible SDK
and submission workflow a small or independent developer can simply sign
up for. This verdict still holds and has not been re-verified against any
change in Hisense's stance since it was made.

**Decision: no VIDAA App Store submission is built or planned under the
current strategy.** Rather than a fully native app, VIDAA is served by a
real **installable Progressive Web App (PWA)** built from the same shared
TV packages as webOS and Tizen — see "What actually exists" below. This is
not the same thing as a native, store-listed app: it runs against VIDAA's
Chromium-based browser rather than a packaged native bundle, and there is
still no VIDAA App Store listing. This is revisited (as an actual native
submission) only if Hisense opens a public, self-service SDK/submission
path for indie developers.

## What actually exists: a real PWA shell, not just a plan

`clients/tv-web/apps/tv-vidaa-fallback/` is a real, building app in the
shared `clients/tv-web/` pnpm workspace — the "if the distribution blocker
were ever lifted" framing in earlier drafts of this document undersold
what's actually been built. It bootstraps the same
`@streamarr-tv/ui-tv` (`TvApp`: Browse/Detail/Player/Pairing) that webOS
and Tizen use, paired with `@streamarr-tv/player-shaka` (the same adapter
pairing as webOS, since VIDAA's browser also supports MSE + EME — see
[`webos.md`](webos.md#tech-stack)). It resolves its API server the same
way the other TV shells do (`?apiBaseUrl=` launch param →
`streamarr-config.json` → local-dev default), uses the same real RFC 8628
device-pairing flow, and has a real `manifest.json` (PWA installability
metadata: name, icons, `display: "fullscreen"`, landscape orientation) —
though the icon assets it references (`icons/icon-192.png`/`icon-512.png`)
aren't included yet, and there is no real VIDAA device or simulator
available in this environment, so the install/OTA flow is genuinely
untested, not merely "best-effort" by design.

**The over-the-air self-update path is a real, currently-disabled feature
flag, not vaporware.** `src/featureFlags.ts` exports
`vidaaOtaEnabled = false`, gating service-worker registration
(`src/index.tsx`) for the OTA delivery path called out as VIDAA's
long-term distribution story — real code exists, real code checks the
flag, and it stays `false` until that path has actually been validated
against a real VIDAA device or simulator. **No DRM is implemented** on
this shell either, for the same reason as every other platform (see
[`web.md`](web.md#playback--drm-approach)): `player-shaka`'s DRM-config
plumbing is real but nothing ever supplies a `DrmConfig`, since the real
`PlaybackInfoResponse` carries no DRM fields.

## What VIDAA users get, layered

1. **Cast/AirPlay fallback (primary, supported).** Many VIDAA TVs ship with
   Chromecast built-in and/or AirPlay 2 support at the OS level. A VIDAA
   owner casts playback from the Web client ([`web.md`](web.md)), the
   Android Mobile client ([`android-mobile.md`](android-mobile.md)), or the
   iOS client ([`ios.md`](ios.md)) directly to their TV, exactly as they
   would cast from any other app that doesn't have a native VIDAA
   presence. This requires no VIDAA-specific code in the monorepo at all
   (no cast/AirPlay sender integration has been built into any Playarr
   client either — this fallback rides entirely on the TV's own OS-level
   casting support), and is treated as the recommended answer to "how do I
   watch Streamarr on my VIDAA TV" precisely because it needs nothing
   VIDAA-specific to work.
2. **PWA install/sideload (secondary, best-effort).** Some VIDAA models
   expose a developer/sideload mode in their built-in browser that allows
   loading an arbitrary web app outside the VIDAA App Store; where that
   mode is available (or where VIDAA's own PWA-install affordance is
   supported on a given firmware), a VIDAA owner can point it at the
   `tv-vidaa-fallback` PWA build described above. This path is explicitly
   **unsupported**: it is not tested against VIDAA's browser as part of any
   release process (no real VIDAA hardware/simulator is available in this
   environment), it is not listed as an official Playarr client, and — with
   `vidaaOtaEnabled` still `false` — it does not yet self-update, so it is
   currently a one-shot install rather than a maintained channel.

## Re-verification requirement if the sideload fallback is ever relied on

If the PWA sideload path in option 2 above is ever promoted beyond
"mentioned in passing to advanced users" — for example, if it starts being
documented as a recommended path, linked from onboarding, or otherwise
treated as something users are actively encouraged to depend on for
receiving updates over time (i.e. used as a de facto OTA update channel for
VIDAA owners) — **VIDAA's Terms of Service and developer/sideload-mode
availability must be re-verified before every release that relies on it,
not just once.** Hisense's ToS around unofficial app loading, developer
mode, and browser sideloading is not a Streamarr-controlled surface: it can
change, be restricted, or be removed in a firmware update without notice,
and continuing to rely on or promote a sideload path that has since become
a ToS violation would be a real risk, not just a support inconvenience.
Flipping `vidaaOtaEnabled` to `true` in
`clients/tv-web/apps/tv-vidaa-fallback/src/featureFlags.ts` is exactly the
kind of "used as a de facto OTA update channel" step this obligation is
about — it should not happen without the re-verification below having just
been done, and validation against a real VIDAA device/simulator, neither
of which has occurred yet.

Concretely: before shipping any release messaging that treats VIDAA PWA
sideload as an OTA fallback channel, re-check current VIDAA ToS language
and current sideload-mode availability on representative hardware. This is
a standing process requirement attached to this fallback, not a one-time
check performed when the decision was made.

## Store submission process and constraints

Not applicable — there is no VIDAA App Store submission in the current
strategy, per the feasibility verdict above. The Cast/AirPlay fallback
requires no VIDAA-specific submission at all (it rides on the sender
client's own store presence — Web, Android, or iOS). The optional PWA
sideload path requires no submission either, by definition, since it
bypasses the VIDAA App Store entirely; it is precisely because that path
requires no formal submission that it carries the ToS re-verification
obligation above instead.
