# Microsoft Store submission checklist — Playarr for Xbox

Playarr for Xbox is the native UWP/XAML client at `clients/xbox/` for a
self-hosted Playarr Server media server. It is a media/entertainment app, not a
game, and it targets the Xbox device family.

**This document is preparation material, not a record of anything already
done.** It cannot be built, signed, or submitted from this environment —
there is no Windows machine, no Windows 10/11 SDK, and no Partner Center
account for this project. Nothing below has been submitted, and no field
value here should be read as final; re-check each item against the live
Partner Center documentation at the time someone actually submits, because
Store and Xbox program requirements shift. Where this checklist states a
number or a fee, treat it as "true as of research, confirm before relying on
it."

Repo state as of writing: both halves of `clients/xbox/` exist —
`Playarr.Core` (the portable, Windows-free core) and `Playarr.Xbox` (the UWP
XAML application head, including `Package.appxmanifest`). Neither has been
built, packaged, or signed: `Playarr.Xbox` is a legacy UWP project that needs
MSBuild, the Windows 10/11 SDK, and Visual Studio's UWP workload, none of
which exist in this environment — see `clients/xbox/README.md` for exactly
what is and isn't verified. Several items below (the icon/tile art, the
actual signed MSIX) can only be finished once that project is opened and
packaged on a real Windows machine.

---

## 1. Prerequisites

- [ ] **Microsoft Partner Center developer account.** One-time registration
      fee, not a recurring subscription (unlike Apple's $99/year). Historically
      priced around $19 for an individual account and $99 for a company
      account, but Microsoft has changed Store account pricing/tiers before —
      confirm the current fee and account-type options on the Partner Center
      signup page before paying anything.
- [ ] **Identity verification.** Partner Center requires identity/address
      verification for the account holder (and, for a company account, the
      legal entity) before a submission can go live. Budget lead time for
      this — it is not instant.
- [ ] **App name reservation.** Reserve "Playarr for Xbox" (or the final
      chosen name) in Partner Center before the first submission; this also
      locks the package Identity Name used in the manifest.
- [ ] **Xbox device-family access/approval.** Publishing a non-game app for
      the Xbox device family has historically involved gating beyond the
      standard developer account — separate from ID@Xbox, which is Microsoft's
      program for *games*, not media apps. Historically this has meant
      requesting Xbox app access through Partner Center (sometimes framed as
      enrolling the account for the "Apps for Xbox" or "media apps on Xbox"
      track) before a submission targeting `Windows.Xbox` is accepted. **This
      needs confirming against current Partner Center docs at submission
      time** — the exact mechanism, whether it is still a separate gate, and
      how long approval takes have all changed over the life of the program
      and this checklist should not be trusted as the current process.
- [ ] **Tax and payout profiles.** Not applicable if the app ships free with
      no in-app purchases, but Partner Center may still prompt for these
      during account setup; skip them if the listing stays free.

## 2. Package requirements

- [ ] **Format: MSIX.** MSIX is the current Store packaging format (the
      legacy `.appx` is still accepted for some flows but MSIX is the one to
      target for a new submission).
- [ ] **Package identity matches the Partner Center reservation.** The
      `Identity Name` and `Publisher` in the manifest must be an exact
      character-for-character match to what Partner Center issued when the
      app name was reserved, or the submission is rejected at upload.
- [ ] **`TargetDeviceFamily` declaration.** The `Package.appxmanifest` must
      declare one of:
      - `Windows.Xbox` — targets only the Xbox device family. Simplest choice
        if this client will only ever ship for consoles.
      - `Windows.Universal` — targets the whole Windows device family
        (Desktop, Xbox, etc.). If used, Partner Center's submission still
        lets device-family availability be restricted to Xbox only under
        "Device family availability," so `Windows.Universal` does not force
        a Desktop listing to exist.
      Either way, set `MinVersion` and `MaxVersionTested` to real, tested
      Windows/Xbox OS build numbers, not placeholder values — Store
      certification runs the package against the declared `MaxVersionTested`
      build.
- [ ] **Four-part package version, last segment `0`.** UWP/MSIX package
      versions are `Major.Minor.Build.Revision`; Store submissions require
      the last segment to be `0` (the fourth segment is reserved for the
      Store's own servicing). `Directory.Build.props` currently pins
      `<Version>0.1.0</Version>` for the assemblies — the packaging manifest
      version is a separate four-part value that has to be kept in step with
      it manually (the way the repo's own comment in
      `Directory.Build.props` already describes for the assembly/manifest
      version relationship).
- [ ] **Architecture: x64.** Xbox One and Series consoles are x64; build and
      package for that architecture (ARM is irrelevant for `Windows.Xbox`).
- [ ] **`rescap:hevcPlayback` restricted capability — required if 4K/HEVC
      playback is claimed.** `Playarr.Core.Playback.XboxPlaybackProfile`
      already advertises `hevc` in `VideoCodecs` for every console except the
      original Xbox One (see `ForModel`), so this client *does* claim
      HEVC/4K playback and will need this capability declared in the
      manifest. Concretely:
      - It is a *restricted* capability, so Partner Center's submission flow
        requires a written justification for why the app needs it before the
        submission can proceed to certification.
      - Declaring it adds a certification pass specifically for the
        capability and lengthens the overall certification turnaround.
      - It costs nothing to declare for local development/sideloading via
        Developer Mode — the friction is entirely at Store-submission
        certification time, not at build time.
      - See also §3 for the memory-budget trade-off this capability carries.

## 3. Certification requirements specific to Xbox

These are requirements beyond the generic Store policies (age-appropriate
content, no malware, functional claims match reality, etc.) that apply
specifically because the device family is Xbox.

- [ ] **Gamepad-only navigation, no keyboard/mouse assumption.** XAML's
      built-in XY focus-navigation engine (`FocusManager`, directional
      `Up`/`Down`/`Left`/`Right` traversal between focusable controls) covers
      the baseline for free — this client does not need to hand-roll spatial
      navigation. What is *not* free and needs explicit handling in the
      application head:
      - The gamepad **B button** must map to system back navigation
        (`BackRequested`/`SystemNavigationManager.BackRequested`).
        Certification checks that B always backs out one level rather than
        doing nothing or exiting the app unexpectedly.
      - The **View** and **Menu** buttons need an explicit contract (or an
        explicit decision that they do nothing) — Xbox certification expects
        consistent, documented behavior for these, not silent no-ops that
        differ per screen.
      - Every focusable element needs a visible focus rectangle at all
        times ("reveal focus"); a control that can receive focus but shows
        no visible indication of it is a common cert-fail specific to
        10-foot UI review.
- [ ] **TV-safe content margins.** Keep essential text and controls inside
      the title-safe area (a margin historically around 10% of the frame
      edge, action-safe closer to 5%) even though modern consoles apply
      their own output scaling — some displays/TV settings still crop or
      overscan, and cert review checks readability on unscaled hardware.
- [ ] **Foreground memory ceiling.** A UWP app on Xbox without the
      `rescap:hevcPlayback` capability is limited to roughly **1 GB** of
      foreground memory. Declaring `rescap:hevcPlayback` raises that ceiling
      to roughly **3.25 GB** — but at a real cost: the app loses the ability
      to run concurrently with games or background music/other apps (the
      system reclaims that concurrency to grant the larger single-app
      budget). State this trade-off plainly in any internal design notes:
      since this client already declares HEVC support (see §2), it is
      already on the 3.25 GB / no-concurrency side of that line, and that
      should be a deliberate, documented choice rather than a side effect
      discovered during cert.
- [ ] **Accessibility.** Store policy expects baseline accessibility support:
      - Narrator (UI Automation) compatibility — every interactive XAML
        element needs correct `AutomationProperties` so Narrator can read
        it.
      - High-contrast theme support — the app should respect the system
        high-contrast theme rather than hard-coding colors that break under
        it.
- [ ] **Age rating / content descriptors.** Completed via the IARC
      questionnaire in Partner Center. This app ships no user-generated
      content and no media of its own — it only plays whatever content the
      connecting Playarr Server's owner has put on that server. That
      should make the questionnaire straightforward (comparable to how
      Plex/Jellyfin/Kodi-style clients are already rated in the Store), but
      answer it honestly: because the app *can* play arbitrary
      user-supplied content depending on what the configured server holds,
      an age-rating or "unrated/mixed content" conversation with reviewers
      may come up. Do not understate this to get a lower rating — disclose
      that content displayed depends entirely on the user's own server and
      is outside the app's control.

## 4. Store listing assets

- [ ] **App icon set.** UWP/MSIX Xbox tiles need the full asset set at their
      required sizes (each typically also needed at 100/125/150/200/400%
      scale variants, which Visual Studio's manifest designer or an asset
      generator produces from a master image):
      - `Square44x44Logo` (app list icon) + unplated 44x44 target-size
        variant (taskbar/Start use)
      - `Square71x71Logo` (small tile)
      - `Square150x150Logo` (medium tile)
      - `Wide310x150Logo` (wide tile)
      - `Square310x310Logo` (large tile)
      - `StoreLogo` 50x50 (Store listing use)
      - Splash screen, 620x300
- [ ] **Screenshots — 1920x1080.** Xbox listings require screenshots at
      1920x1080 (16:9). At least one is required; in practice several
      (browsing a library, a title detail view, and playback) communicate
      the app better than a single image and are worth producing even
      though only one is mandatory.
- [ ] **Store description copy.** Short description, full description,
      feature bullet list, and search/keyword terms for discoverability.
- [ ] **Privacy policy URL.** Required, must be a live, publicly reachable
      URL. Content should state plainly: Playarr for Xbox talks only to the
      self-hosted Playarr Server address the user enters, and collects no
      telemetry about the user beyond whatever the user's own server
      chooses to log. No analytics SDK, no ad SDK, no first-party telemetry
      to a Playarr Server-operated service — because no such service exists in
      this architecture.
- [ ] **Support contact info.** A support email or website URL, required by
      Partner Center for every listing.

## 5. What is genuinely unverified / deferred, and why

This checklist is preparation, not a claim of readiness. Specifically, as of
writing:

- No MSIX signing certificate exists for this project.
- No Partner Center account has ever been used for Playarr/Playarr Server.
- Xbox device-family submission access for this specific app has not been
  requested from Microsoft, so its approval status (see §1) is genuinely
  unknown rather than assumed-fine.
- The UWP XAML application head (`Playarr.Xbox`) exists and its
  `Package.appxmanifest` declares the `rescap:hevcPlayback` restricted
  capability and a placeholder self-signed publisher identity, but it has
  never been opened, built, or packaged on Windows — the real icon/tile art
  is still missing, and the manifest's `TargetDeviceFamily`/version fields are
  unverified against a live Windows 10/11 SDK.
- None of the numeric figures above (fees, memory ceilings, screenshot
  dimensions) have been re-verified against current Microsoft documentation
  at submission time; they reflect research at the time this document was
  written and should be treated as a starting point, not a source of truth.
