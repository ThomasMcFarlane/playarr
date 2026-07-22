# Playarr for LG webOS

This package turns the full Playarr client from `clients/tv-web/web` into an
installable LG webOS TV application. It includes the same profiles, home,
search, libraries, playlists, settings, device login, and Shaka-based player
as `playarr.app`; it is not the older limited `ui-tv` shell.

The webOS build sets `__PLAYARR_PLATFORM__` to `tv-webos`, uses hash routing so
every route works from the installed `index.html`, and emits only relative
asset paths. The package asks webOS to deliver Magic Remote Back to Playarr so
drawers, dialogs, the player, and route navigation close in the expected order;
an unhandled Back press at Playarr's entry route returns to webOS. LG media-key
codes are normalised for the shared player, and playback is paused when webOS
hides or terminates the app.

## Install a published developer package

The package can be side-loaded on an LG TV running webOS 23 or newer. The TV
and computer must be on the same network.

1. Create an LG Developer account. On the TV, install **Developer Mode** from
   LG Apps, sign in, enable **Dev Mode Status**, and let the TV restart.
2. Install LG's current webOS CLI on the computer:

   ```sh
   npm install --global @webos-tools/cli
   ares -V
   ```

3. Download the stable package published by Playarr:

   ```sh
   curl -fL https://playarr.app/downloads/webos/playarr-webos.ipk \
     -o playarr-webos.ipk
   ```

4. Add the TV to the CLI. Replace `192.0.2.10` with the IP shown in the TV's
   network settings; `9922` and `prisoner` are LG's Developer Mode values:

   ```sh
   ares-setup-device --add playarr-tv \
     -i "host=192.0.2.10" -i "port=9922" -i "username=prisoner"
   ```

5. Open Developer Mode on the TV, turn on **Key Server**, then fetch its key.
   Enter the six-character passphrase shown by the TV when prompted:

   ```sh
   ares-novacom --device playarr-tv --getkey
   ares-device --system-info --device playarr-tv
   ```

6. Install and launch Playarr:

   ```sh
   ares-install --device playarr-tv playarr-webos.ipk
   ares-launch --device playarr-tv com.streamarr.tv
   ```

On first launch, Playarr shows **Link this TV** with a QR code, a web address,
and a short code. Scan the QR code with a phone, or open the displayed
`playarr.app` address and enter the short code manually. Choose the Streamarr
server/profile in that browser and approve the TV; the app receives the chosen
server addresses and session automatically. A release operator can optionally
preset `apiBaseUrl` in `public/streamarr-config.json` before building an
operator-specific package. The checked-in value is intentionally empty for the
generic download, and the loader ignores it.

Developer Mode is time-limited. Use the **EXTEND** action in LG's Developer
Mode app before it expires; LG removes side-loaded developer apps when the
session expires.

These steps follow LG's current [webOS CLI installation guide](https://webostv.developer.lge.com/develop/tools/cli-installation)
and [Developer Mode app guide](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

## Build and package from source

From `clients/tv-web/`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @streamarr-tv/app-webos run test
pnpm --filter @streamarr-tv/app-webos... run build
```

The build creates `apps/tv-webos/dist/` with the full hashed Playarr bundle,
`appinfo.json`, `streamarr-config.json`, the in-app Playarr mark, and LG's
exact-size launcher icons.
The final preparation step rejects manifest/version drift, incorrect icon
sizes, and package-incompatible root-absolute HTML/CSS asset URLs.

With the webOS CLI installed, create the IPK:

```sh
pnpm --filter @streamarr-tv/app-webos run package:ipk
```

`ares-package` writes a versioned file such as
`out/com.streamarr.tv_0.1.0_all.ipk`. Release automation publishes that file
under the stable download name `playarr-webos.ipk`; the package's internal app
ID and version remain unchanged.

Useful device commands after installation:

```sh
ares-inspect --device playarr-tv --app com.streamarr.tv
ares-launch --device playarr-tv --close com.streamarr.tv
ares-install --device playarr-tv --remove com.streamarr.tv
```

## Compatibility and release boundaries

- The developer-package baseline is webOS 23+. The bundle targets ES2018 and
  uses Shaka Player over the TV's HTML5/MSE media pipeline. Older generations
  are not claimed until tested and certified on representative hardware.
- `appinfo.json` cannot declare a minimum webOS version; LG Seller Lounge
  device/model targeting must enforce the release floor.
- The local build and package-preparation tests do not replace a real-TV
  playback, remote-control, suspend/resume, or memory test.
- Publishing in LG Content Store still requires Seller Lounge registration,
  store artwork/metadata, LG review, and representative-device certification.
