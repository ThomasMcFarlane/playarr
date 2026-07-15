# Client Architecture: VIDAA (Hisense/Toshiba Smart TVs)

VIDAA is Hisense's (and, under license, Toshiba's) Smart TV operating
system. It is the seventh entry in the 7-client strategy, and it is the one
client in that strategy that is **not** shipped as a native or store-listed
application. This document exists specifically to record that decision and
the fallback approach taken instead, so it is not silently forgotten or
periodically re-litigated without the context of why it was made.

## Feasibility verdict

**There is no viable public SDK or app-submission path for an indie
developer on VIDAA.** Unlike LG's webOS (`webostv.developer.lge.com`,
open self-service developer registration) or Samsung's Tizen (Samsung
Seller Office, open self-service registration gated only by identity
verification and a certificate profile — see [`tizen.md`](tizen.md)),
Hisense does not offer an equivalent open, self-service developer portal
and app store submission process for VIDAA. Getting an app listed in the
VIDAA App Store in practice requires a direct business relationship /
partnership with Hisense rather than a documented, publicly accessible SDK
and submission workflow a small or independent developer can simply sign
up for.

Given this, building and maintaining a native VIDAA client would mean
committing to an opaque, relationship-gated distribution path with no
guarantee of acceptance, no published review timeline, and no self-service
recourse if that relationship lapses — a materially different (and
materially worse) risk profile than every other platform in the 7-client
strategy, all of which have open developer programs.

**Decision: VIDAA is deprioritised as a native client.** No
`clients/vidaa/` native app is built or planned under the current
strategy. This is revisited only if Hisense opens a public, self-service
SDK/submission path for indie developers, at which point VIDAA would slot
into the same "TV shell" approach used for webOS and Tizen (VIDAA's runtime
is also a web-app host, so the technical shape of doing so would closely
resemble [`webos.md`](webos.md) and [`tizen.md`](tizen.md) if the
distribution blocker were ever lifted).

## What VIDAA users get instead

Deprioritising a native client does not mean VIDAA owners are unsupported;
it means they are served by two specific fallback paths, layered:

1. **Cast/AirPlay fallback (primary, supported).** Many VIDAA TVs ship with
   Chromecast built-in and/or AirPlay 2 support at the OS level. A VIDAA
   owner casts playback from the Web client ([`web.md`](web.md)), the
   Android Mobile client ([`android-mobile.md`](android-mobile.md)), or the
   iOS client ([`ios.md`](ios.md)) directly to their TV, exactly as they
   would cast from any other app that doesn't have a native VIDAA
   presence. This is the recommended path, requires no VIDAA-specific code
   in the monorepo at all, and is treated as the actual, supported answer
   to "how do I watch Streamarr on my VIDAA TV."
2. **Optional, unsupported PWA sideload (secondary, best-effort).** Some
   VIDAA models expose a developer/sideload mode in their built-in browser
   that allows loading an arbitrary web app outside the VIDAA App Store.
   Where that mode is available, a VIDAA owner can point it at the Web
   client's PWA (the same build described in [`web.md`](web.md), which
   already implements a platform-adapter interface generic enough to run
   in any Chromium/WebKit-class TV browser — see
   [`webos.md`](webos.md#code-sharing-story-with-sibling-platforms) for
   the adapter mechanism this reuses). This path is explicitly
   **unsupported**: it is not tested against VIDAA's browser as part of any
   release process, it is not listed as an official Playarr client, and it
   is offered purely as a best-effort option for advanced users willing to
   accept that it may not work well, or at all, on a given firmware
   version.

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
