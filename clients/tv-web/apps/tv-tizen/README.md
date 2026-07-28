# Playarr for Samsung Tizen

This package turns the complete Playarr client from `clients/tv-web/web` into
an installable Samsung Smart TV application. It includes the same profiles,
home, search, libraries, playlists, settings, device login, and player as
`playarr.app`; it is not the earlier limited `ui-tv` shell.

The package sets `__PLAYARR_PLATFORM__` to `tv-tizen`, uses hash routing so
every route works from the widget's installed `index.html`, and emits relative
asset paths. Video uses Samsung's native `webapis.avplay` plane while the
shared Web player supplies controls, tracks, resume state, quality selection,
analytics, and authenticated playback-session handling. Samsung media keys,
Back-at-root exit confirmation, AVPlay suspend/resume, and screen-saver policy
are installed by the Tizen bootstrap. The bootstrap keeps both the AVPlay
display rectangle and its `<object>` CSS bounds aligned with the full-screen
or minimised shared player. Playarr's downloaded WebVTT sidecars are converted
to a local SAMI file before AVPlay receives `setExternalSubtitlePath`.

## Install on a physical Samsung TV

Samsung does not support generic USB installation of a developer WGT. The TV
and development computer must be on the same network, and the WGT must be
signed by a Samsung TV certificate profile that authorises that TV's DUID.

1. Install [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download),
   then use Package Manager to add **Samsung TV Extensions**, **Samsung
   Certificate Extension**, and the Web CLI tools.
2. In Tizen Studio's Certificate Manager, create a **Samsung** certificate
   profile with an author and distributor certificate. Add the target TV's
   DUID to the distributor certificate. A Partner certificate is needed only
   for APIs or submission classes that specifically require Partner privilege;
   it is not a blanket prerequisite for this widget.
3. On the TV, open **Smart Hub → Apps**, scroll to **App Settings**, enter
   `12345`, enable **Developer Mode**, enter the development computer's IP
   address, and restart the TV.
4. Find the TV's IP address in its network settings and connect it. Replace
   the documentation-only addresses and target name below:

   ```sh
   sdb connect 192.0.2.20
   sdb devices
   tizen list tv
   ```

   In Tizen Studio's **Device Manager**, right-click the connected TV and
   choose **Permit to install applications**.

5. From `clients/tv-web/`, build and sign the widget with the certificate
   profile created above:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @playarr-tv/app-tizen... run build
   pnpm --filter @playarr-tv/player-avplay run test
   pnpm --filter @playarr-tv/app-tizen run test
   pnpm --filter @playarr-tv/app-tizen run package:wgt -- --profile PlayarrTV
   ```

   The command writes the signed, stable artifact to
   `apps/tv-tizen/playarr-tizen.wgt`.

6. Install and launch it, using the target reported by `tizen list tv`:

   ```sh
   tizen install -n playarr-tizen.wgt -t <target-name> -- apps/tv-tizen
   tizen run -p StrmarrTV1.Playarr Server -t <target-name>
   ```

On a fresh install, the TV asks `playarr.app` for a short-lived link code. Scan
the displayed QR code with a phone, or open the displayed `playarr.app`
address and type the manual code. Choose the existing Playarr profile/server
on the phone; the TV then receives that server's own device authorisation and
finishes login without entering a LAN URL on a TV keyboard. An
operator-specific package may instead set an absolute HTTP or HTTPS
`apiBaseUrl` in `public/playarr-config.json` before building. The checked-in
value is intentionally empty for the hosted first-install flow.

The physical-device procedure follows Samsung's
[TV device setup](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html),
[certificate](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html),
and [CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)
guides.

## Build without packaging

From `clients/tv-web/`:

```sh
pnpm --filter @playarr-tv/app-tizen... run build
pnpm --filter @playarr-tv/player-avplay run test
pnpm --filter @playarr-tv/app-tizen run test
```

The build creates `apps/tv-tizen/dist/` with the complete hashed Playarr
bundle, `config.xml`, `playarr-config.json`, and launcher icon. Package
preparation fails if the Tizen TV profile, network/input privileges, Product
API bootstrap, or AVPlay object is missing.

The package shortcut shown above requires a profile explicitly so an unsigned
artifact cannot be mistaken for an installable release. The equivalent manual
commands are:

```sh
tizen package -t wgt -s <certificate-profile> -- apps/tv-tizen/dist
tizen install -n <generated-name>.wgt -t <target-name> -- apps/tv-tizen/dist
```

## Compatibility and release boundaries

- The developer-package baseline is Tizen 7.0+ (2023 Samsung TVs). The bundle
  targets ES2018 and the build's CSS baseline is Chromium 94. Older
  models are not claimed until tested and certified on representative
  hardware.
- Local unit, type, and package-preparation tests cannot exercise Samsung's
  proprietary Product APIs. Playback, DRM, remote keys, suspend/resume,
  screen-saver behavior, memory pressure, and subtitles still need real-TV
  testing.
- An arbitrary downloaded developer WGT generally cannot be installed on a
  different TV because the distributor certificate contains authorised DUIDs.
  Broad consumer distribution belongs in Samsung Seller Office/Smart Hub;
  publishing a download is useful only when its signature authorises the
  intended device or Samsung provides the applicable distribution signature.
- Smart Hub publication still needs a Samsung seller account, store metadata
  and artwork, representative-device certification, and Samsung review.
