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

## Test without a TV

Two ways to run this app before real hardware is available, both wired up
under `scripts/webos-sdk/`. They share `@webos-tools/cli` (`ares -V` to
verify) with the real-device workflow above.

### webOS TV Simulator (start here)

A desktop Electron app that runs the built `dist/` bundle with webOS TV APIs
and remote-control key events emulated -- good for UI/navigation/focus work.
It does not validate DRM, real media codecs, or actual remote hardware.

1. Build the app: `pnpm --filter @streamarr-tv/app-webos run build`
2. Download a Simulator zip for the target webOS TV version from LG's
   [Simulator Installation page](https://webostv.developer.lge.com/develop/tools/simulator-installation)
   in a browser. That page is a JS-rendered SPA gated behind a click-through
   EULA with no stable direct-download URL, so this step can't be scripted.
3. Install it: `pnpm run simulator:install ~/Downloads/webOS_TV_26_Simulator_1.5.0_linux.zip`
4. Launch it: `pnpm run simulator`
5. In the Simulator window, use File > Open (or drag-and-drop) to load the
   `dist/` path the launch script prints.

LG's own Linux docs note `ares-launch --simulator` cannot pass the Electron
flags the AppImage needs on modern Linux (`--ozone-platform=x11
--no-sandbox`), so `launch-simulator.sh` runs the AppImage directly with
those flags instead of going through `ares-launch`.

### webOS OSE Emulator (fuller platform, heavier)

A full webOS Open Source Edition VM -- closer to the real Surface
Manager/LS2 bus than the Simulator, but heavier and not TV-specific. LG's
only *officially supported* way to run it is VirtualBox (the
`webos-emulator` Python launcher + VBoxManage, VirtualBox 7.0+, Intel VT-x
required) -- LG's own QEMU-based emulator was deprecated in 2018. The disk
image itself is a plain VMDK that QEMU reads natively though, so this repo's
scripts boot the same official image directly under **QEMU/KVM** instead:
unofficial and untested by LG, but avoids installing a second hypervisor
alongside an existing KVM setup. If it misbehaves, LG's
[VirtualBox Emulator User Guide](https://www.webosose.org/docs/tools/sdk/emulator/virtualbox-emulator/emulator-user-guide/)
is the documented fallback.

1. Install qemu if `qemu-system-x86_64` isn't already on your PATH (needs
   sudo): `sudo pacman -S qemu-desktop`
2. Download the image (~650MB from GitHub Releases, no login required):
   `pnpm run emulator:install`
3. Boot it: `pnpm run emulator`

The launch script boots with software-rendered `-vga std` rather than LG's
GL-accelerated default, because it detects (on this workstation) only a
server-class ASPEED BMC framebuffer (`ast` driver, no `/dev/dri/renderD*`) --
no GPU render node to pass through. Whether webOS OSE's compositor tolerates
pure software rendering is untested; if the guest doesn't come up, that's a
host limitation, not a script bug. A host with a real GPU can switch the
script to `-device virtio-gpu-gl-pci -display sdl,gl=on` (see the comment at
the top of `launch-ose-emulator.sh`).

**Known issue on this workstation:** QEMU 11's `fdmon-io_uring` event-loop
backend needs to `mlock()` memory at startup and fails outright (even with
zero drives attached) if `RLIMIT_MEMLOCK` is too low. This account's is
capped at 8MB -- confirmed both for interactive login sessions and for the
`systemd --user` manager itself, so it's a per-account default, not specific
to one terminal. `launch-ose-emulator.sh` detects the failure and prints the
fix (a `systemd/user.conf.d` drop-in raising `DefaultLimitMEMLOCK`, needs
sudo + a full logout/login) or points at the VirtualBox fallback, which
doesn't use io_uring and is unaffected.

Once it's booted:

```sh
ares-config -p ose                 # switch the CLI to the OSE device profile
ares-setup-device --list           # should show: emulator (default) developer@127.0.0.1:6622
ares-install --device emulator out/com.streamarr.tv_0.1.0_all.ipk
ares-launch --device emulator com.streamarr.tv
ares-config -p tv                  # switch back -- this is global CLI state,
                                    # needed before the real-device steps above
```

`@webos-tools/cli` ships this `emulator` device profile out of the box
(SSH-key auth via `~/.ssh/webos_emul`, installed automatically with the CLI)
-- no manual `ares-setup-device --add` needed. LG's docs separately mention a
root/blank-password SSH login (`ssh -p 6622 root@localhost`) as a fallback if
the key-based profile doesn't connect. Web Inspector is at
<http://localhost:9998> once the app is running.

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
