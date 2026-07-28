# Using Playarr on Xbox

Playarr for Xbox has three delivery routes, at very different stages of
readiness:

1. **Microsoft Store** — not yet submitted. See
   [Register and publish through the Microsoft Store](#register-and-publish-through-the-microsoft-store)
   below.
2. **Xbox Developer Mode sideload** — will be available once a signed (or
   Dev Mode self-signed) package exists. No such package has been built yet;
   see [About Developer Mode installation](#about-developer-mode-installation).
3. **Edge browser** — available today, no install required. This is the one
   route you can actually use right now.

There is no Playarr APK, IPK, or WGT for Xbox — the native app is a UWP/XAML
project (`clients/xbox/`), distinct from the packaged webOS/Tizen clients.

## Before you start

1. Update your console under **Settings > System > Updates > Update console
   now**.
2. Put the console and your Playarr Server on the same trusted home
   network.
3. Open your Playarr Server's address (or <https://playarr.app>) from
   another phone or computer first, and confirm you can connect and sign in.

Use HTTPS if your server already has a certificate the console trusts. Plain
HTTP may work on a trusted, isolated home LAN, but it must not be exposed
directly to the internet.

## Open Playarr in Xbox's Edge browser

This is the only Playarr route that works on Xbox today. There is no
special URL parameter to remember — unlike some other TV browsers, Xbox's
Edge identifies itself on every request, so Playarr detects it automatically
and keeps identifying it correctly on every later visit without saving
anything.

1. From the Xbox dashboard, open **Microsoft Edge** (under **My apps &
   games**, or install it from the Microsoft Store if it isn't already on
   your console).
2. Enter your Playarr Server's address, or <https://playarr.app> if you use
   the hosted bootstrap.
3. Sign in with the same Playarr Server account you use on other devices.
4. Save the page as an Edge favourite if you want a faster way back to it.

Playarr automatically applies a conservative playback profile for this
browser: H.264 and VP9 video, AAC and Opus audio. HEVC, AV1, and MKV sources
are not played directly here even though this browser reports some of them
as supported — they are transcoded instead, because Xbox's built-in browser
does not actually decode them reliably. The separate native app (once
installed) supports a wider range, including MKV and HEVC direct play — see
[`docs/architecture/clients/xbox.md`](../architecture/clients/xbox.md) for
the full technical comparison.

## About Developer Mode installation

**No Playarr package exists to sideload yet.** This section documents the
general Developer Mode process for when one does; it is not a set of steps
you can complete against Playarr today.

Sideloading any app onto an Xbox console — Playarr included, once a package
exists — requires putting the console into **Developer Mode**:

1. Install the **Dev Mode Activation** app from the Microsoft Store on the
   console you want to use for sideloading.
2. Run it and follow its prompts. This is a one-time activation per console
   and reboots the console into a separate Developer Mode partition; the
   console still plays games and media normally, but app development and
   sideloading only work from that partition.
3. Once activated, the console exposes the **Xbox Device Portal**, a local
   web UI (reached at an address and access code the Dev Mode Activation app
   displays) used to install `.appx`/`.msix` packages, view logs, and manage
   installed apps.
4. When a signed or Dev-Mode-self-signed Playarr package is available, the
   Device Portal's **Add** / app-management page is where it gets installed
   — copy the package to a location the portal can reach and install it from
   there.

Check your console's OS version under **Settings > System > About** if you
need it for a compatibility report.

## Register and publish through the Microsoft Store

Nothing has been submitted to the Microsoft Store for Playarr yet. The
checklist for that future submission — Partner Center registration, Xbox
device-family access, package/manifest requirements, Xbox-specific
certification items, and store listing assets — is tracked in
[`clients/xbox/docs/store-submission.md`](../../clients/xbox/docs/store-submission.md).
That document is explicitly preparation material, not a record of anything
already done: it states plainly that no signing certificate, no Partner
Center account, and no Xbox device-family submission access exist for this
project today.

## Official references

- [Xbox Developer Mode activation](https://learn.microsoft.com/en-us/windows/uwp/xbox-apps/devkit-activation)
- [Xbox Device Portal](https://learn.microsoft.com/en-us/windows/uwp/xbox-apps/device-portal-xbox)
- [UWP apps on Xbox, general documentation](https://learn.microsoft.com/en-us/windows/uwp/xbox-apps/)
