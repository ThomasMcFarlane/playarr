---
title: Install the apps
summary: How to get Playarr onto a browser, phone, tablet or television, and how each device signs in to your own Playarr server.
group: Clients
order: 20
---

Playarr is the playback and library front end for a Playarr server you run yourself. It reads the library your server already knows about and plays it back. No Playarr client is distributed through any app store, and there is no 1.0 release, every route below is either the hosted browser app, a direct package download, or a documented build-from-source and sideload path.

The canonical list of platforms and their current availability lives at <https://playarr.app/clients>. That hub labels each entry **Available**, **Available · Experimental install** or **Coming soon**, and the table below uses the same labels. The browser client does not appear on the hub at all, because there is nothing to install.

| Platform | Status | Install route today |
| --- | --- | --- |
| Web browser | Available (not listed on the hub) | Open <https://playarr.app>, nothing to install |
| Android phones, tablets, Android TV, Google TV | Available | Direct APK download, one package for every form factor |
| Hisense VIDAA | Available · Experimental install | TV Browser URL; optional experimental launcher tile you install yourself |
| Roku | Available · Experimental install | Developer Mode plus the web installer and a ZIP |
| LG webOS | Available · Experimental install | LG Developer Mode plus `ares-install`. Build the IPK from source |
| Samsung Tizen | Available · Experimental install | Tizen Studio certificate, `sdb`, `tizen install`. Build and sign from source |
| Apple, iPhone, iPad, Apple TV | Coming soon | None. Source builds only, no distributable signed release |
| Xbox | Not built yet | None. `clients/xbox/` holds a handful of C# model and networking files, no application and no install route |
| HarmonyOS, Huawei phones, tablets, Vision TVs | Coming soon | None. A native ArkTS client is in development, no application and no install route yet |

> Transcoding happens on the Playarr server, not in the client. Playarr apps receive direct-play or HLS streams; none of them embeds FFmpeg.

## Start in a browser

The hosted Playarr Web App is the complete client and it works right now.

1. Open <https://playarr.app> on any evergreen desktop or mobile browser with Media Source Extensions.
2. On the sign-in screen, enter the absolute URL of your Playarr server, including the port, for example `http://192.168.1.50:8484` or `https://media.<YOUR-DOMAIN>`.
3. Sign in with your username and password. If the operator has opted the server into `PLAYARR_AUTH_MODE=trusted-network`, a request from an allowlisted address signs you in with no credentials at all instead.

There is no download, no packaging step and no review gate: a new build is live for every browser the moment it is deployed. A hand-written service worker checks `build-manifest.json` on focus and every 15 minutes, and offers an "Update available" toast when a newer bundle is published.

### Reaching a private server from the hosted app

`playarr.app` is served over HTTPS, so reaching a plain-HTTP server on your LAN needs help from the browser:

- **Local Network Access.** Playarr marks private and loopback addresses as local-network requests, so a browser that implements Local Network Access can prompt you for permission and relax mixed-content blocking. Approve the prompt the first time. A browser without that feature cannot connect to a private plain-HTTP server from the hosted app.
- **Public IPv4 addresses.** Enter the public address and Playarr rewrites it to the deterministic hostname `https://v4-A-B-C-D.relay.playarr.app:8484`. Those DNS records are DNS-only and published by `playarr.app` for servers that opt in with `PLAYARR_RELAY_REGISTER=true`, and **Playarr terminates TLS itself**. Set `PLAYARR_ACME_DOMAIN` on the server and accept the certificate authority's terms with `PLAYARR_ACME_ACCEPT_TERMS=true` so it can obtain and renew that certificate.

> Playarr never relays API or playback traffic through Cloudflare. Whatever URL you enter, the browser talks to your server directly.

## Android, Available

One project and one adaptive application. The same build installs on phones, tablets, Android TV and Google TV; the manifest exposes both the normal and `LEANBACK_LAUNCHER` categories, and the app picks touch or remote navigation at runtime. Google Play uses the canonical `app.playarr.mobile` package. The published APK temporarily retains `io.playarr.mobile` so existing sideloaded installations remain updateable; both IDs can coexist during the migration. The minimum is **Android 8.0 (API 26)**.

### Install the published APK

On the device, open <https://playarr.app/clients/android> and choose **Download Android APK**, then allow installs from unknown sources when Android asks.

To verify the package first from a computer:

```bash
curl -fL -o playarr-android.apk https://playarr.app/downloads/android/playarr-android.apk
curl -fsSL https://playarr.app/downloads/android/playarr-android.json
sha256sum playarr-android.apk
```

The JSON manifest reports `version_name`, `version_code`, an immutable versioned `apk_url` under `/downloads/android/releases/<x.y.z>/playarr-android.apk`, and the expected `sha256`. Compare that value with the checksum you computed.

### Install on a television

Android TV and Google TV devices have no browser worth using for this. Sideload over ADB from a computer on the same network.

First turn on developer options and network debugging on the television itself: **Settings → System → About**, select **Build** seven times, then **Settings → System → Developer options** and enable **USB debugging** (labelled **Network debugging** or **ADB debugging** on some Google TV builds). Note the TV's IP address under **Settings → Network & Internet**. Then, from the computer, download the APK with the `curl` command above and:

```bash
adb connect <TV-IP>:5555
adb -s <TV-IP>:5555 install -r playarr-android.apk
```

Accept the "Allow USB debugging?" prompt that appears on the television the first time you connect.

The app also updates itself outside any store: it polls `https://playarr.app/downloads/android/playarr-android.json`, refuses any manifest whose host is not exactly `playarr.app`, verifies the SHA-256 and hands the file to Android's package installer. Television viewers trigger this from the profile page.

### Build it yourself

Requires JDK 21 and the Android SDK. Point `JAVA_HOME` at your own JDK 21 installation, the path below is an example, not a fixed location:

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr/clients/android
export JAVA_HOME=<PATH-TO-YOUR-JDK-21>
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
adb install -r app/build/outputs/apk/debug/playarr-android-debug.apk
```

The debug APK is written to `clients/android/app/build/outputs/apk/debug/`. A debug build is signed with Android's debug key, so it cannot upgrade an installation of the published APK, uninstall one before installing the other.

## Hisense VIDAA, Available · Experimental install

There is no APK, IPK, WGT or USB package for VIDAA. Playarr runs on these televisions as the hosted Web client.

### Route 1, the TV Browser (reliable, recommended)

1. Update the TV: **Settings → Support → System Upgrade → Check Firmware Upgrade**.
2. Put the TV and the Playarr server on the same trusted home network.
3. Open the **Browser** app on the TV and enter:

   ```text
   https://playarr.app/?platform=tv-vidaa
   ```

4. Save it as a Browser favourite if the television offers that.
5. Sign in with the same Playarr account you use elsewhere.

The `platform=tv-vidaa` marker is persisted after the first visit, so you do not need to keep the query string visible. It identifies the TV to Playarr and selects a conservative playback profile, H.264, H.265 and VP9 video with AAC, Opus and MP3 audio.

### Route 2, the experimental launcher tile

Playarr publishes a fixed, Playarr-only custom store at <https://playarr.app/vidaa-store/>. It can install exactly one thing: the `https://playarr.app/?platform=tv-vidaa` launcher. It offers no arbitrary URL, file, console or script controls.

**Playarr does not operate a public DNS resolver.** You must supply and operate your own DNS, proxy or self-hosted interception that can present the store as `vidaahub.com`, a DNS record alone cannot satisfy HTTPS hostname and certificate validation.

1. Point the TV or router at your own resolver, and change nothing else about the network.
2. Open the VIDAA portal route your setup requires. Accept a certificate warning only if you understand and trust that setup.
3. Choose **Install Playarr** and let the tile finish writing. Do not switch the TV off.
4. Restart the TV, confirm Playarr opens, then **restore automatic DNS immediately**, even if the install failed.

> Firmware support varies. Some televisions reject the portal certificate, and some omit the installation API entirely. Do not use service-menu codes, firmware downgrades or third-party firmware.

## Roku, Available · Experimental install

Playarr for Roku is a native SceneGraph channel using Roku's own focusable lists and `Video` node. It installs through Developer Mode only.

1. **Enable Developer Mode.** On the Roku remote press **Home ×3, Up ×2, then Right, Left, Right, Left, Right**. Note the URL shown, enable the Development Application Installer, accept the agreement and create a password. The Roku restarts.
2. **Get the ZIP** from <https://playarr.app/downloads/roku/playarr-roku.zip>. Keep it zipped, Roku's installer expects the archive itself.
3. **Open the web installer** at the URL shown on the TV, from a phone or computer on the same network. Sign in with the username `rokudev` and the password you created.
4. **Upload and install.** Choose Upload, select `playarr-roku.zip` without extracting it, then Install.
5. **Connect Playarr.** Enter your Playarr server base URL, follow the code shown on the TV to authorise the Roku, then choose a household profile.

> **Only one sideloaded app can be installed on a Roku.** Installing another development app replaces Playarr. If Roku rejects an identical version, remove the existing sideloaded app and install the ZIP again.

Roku's own guide: <https://developer.roku.com/dev/docs/developer-setup>

### Build and deploy from source

Python 3 and `zip` are the only requirements:

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr/clients/roku
make validate
make package
```

The package lands at `build/playarr-roku.zip`. To push it straight to a development Roku:

```bash
export ROKU_DEV_TARGET=<ROKU-IP>
export ROKU_DEV_PASSWORD='<YOUR-DEV-PASSWORD>'
make deploy
```

The channel reports `clientVersion` `0.1.0` and, because Playarr's client-platform enum has no `tv-roku` value yet, identifies itself using the supported `web` compatibility identity. Store signing, channel artwork and physical-device certification are outside this source-only client.

## LG webOS, Available · Experimental install

The webOS app is a packaged distribution of the same complete Playarr Web application, not a second interface. It installs as `com.playarr.tv` and needs **webOS 23 or newer**.

> **No release IPK has been published yet.** The download button on the hub serves one only once an artefact exists; today, build it from source with the commands below.

### 1. Enable Developer Mode on the TV

Install **LG's own Developer Mode app** from the LG Content Store, Playarr itself is not listed there and has not been submitted anywhere. Sign in with your LG developer account, enable Dev Mode Status and let the TV restart. Reopen the app, select **Key Server**, and use **EXTEND** before the session timer runs out.

### 2. Get the IPK

Install LG's current CLI on your computer first, `@webos-tools/cli` provides every `ares-*` command below:

```bash
npm install -g @webos-tools/cli
ares -V
```

Once a release artefact exists, the published package is one command:

```bash
curl -fL https://playarr.app/downloads/webos/playarr-webos.ipk -o playarr-webos.ipk
```

Until then, build the identical IPK yourself. This needs **Node.js 20 or newer** (the workspace declares `engines.node >= 20`):

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr/clients/tv-web
npm install -g pnpm@11.13.0
pnpm install --frozen-lockfile
pnpm --filter @playarr-tv/app-webos run package:ipk
```

`package:ipk` builds the app and then runs `ares-package`, writing `apps/tv-webos/out/com.playarr.tv_<version>_all.ipk`.

### 3. Connect the TV

```bash
ares-setup-device --add playarr-tv -i "host=<TV-IP>" -i "port=9922" -i "username=prisoner"
ares-novacom --device playarr-tv --getkey
ares-device --system-info --device playarr-tv
```

Port `9922` and the user `prisoner` are LG's own Developer Mode values. `--getkey` prompts for the six-character passphrase shown on the TV.

### 4. Install and launch

Run this from `clients/tv-web` for a locally built package, or substitute `playarr-webos.ipk` if you downloaded one:

```bash
ares-install --device playarr-tv apps/tv-webos/out/com.playarr.tv_*_all.ipk
ares-launch --device playarr-tv com.playarr.tv
```

On first launch the TV shows **Link this TV** with a QR code and a short code rather than a URL box. Finish the pairing from a signed-in browser, see [Hosted first-contact linking](#hosted-first-contact-linking-at-playarrapplink) below.

> **Developer Mode installs expire with the session.** LG removes developer apps when the session ends, so keep the TV online and use EXTEND before the timer reaches zero. Treat this build as a developer preview until playback, remote, suspend and resume are validated on representative hardware.

LG's guide: <https://webostv.developer.lge.com/develop/getting-started/developer-mode-app>

## Samsung Tizen, Available · Experimental install

Also a packaged distribution of the full Playarr Web application, installing as `StrmarrTV1.Playarr`. It requires **Tizen 7.0 or newer, a 2023-or-newer Samsung television**. Playback uses Samsung's native AVPlay surface rather than the browser video element.

> **Every WGT must be signed, and a signed developer WGT is device-bound.** The distributor certificate authorises specific TV DUIDs, so an arbitrary downloaded developer package generally cannot install on someone else's television. No hosted WGT is published; build and sign your own.

### 1. Install the TV SDK and create a certificate

Install Tizen Studio, then add the **Samsung TV Extension**, **Samsung Certificate Extension** and **Web CLI** in Package Manager. Create and activate a Samsung certificate profile, Tizen will not install an unsigned widget.

### 2. Enable Developer Mode on the TV

Open **Apps → App Settings**, enter `12345`, turn Developer Mode on, enter your computer's local IP address, confirm, and reboot the TV.

The repository ships a `package:wgt` script that builds the app, copies `config.xml` into `dist/`, invokes `tizen package` with your certificate profile and copies the result to a stable filename. It needs **Node.js 20 or newer** and the `tizen` CLI on your `PATH`:

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr/clients/tv-web
npm install -g pnpm@11.13.0
pnpm install --frozen-lockfile
pnpm --filter @playarr-tv/app-tizen run package:wgt -- --profile <YOUR-CERTIFICATE-PROFILE>
```

Use the exact active profile name from Tizen Studio. Instead of `--profile` you may export `PLAYARR_TIZEN_CERT_PROFILE=<YOUR-CERTIFICATE-PROFILE>`; the script fails with a clear message if neither is supplied. The signed widget is written to `apps/tv-tizen/playarr-tizen.wgt`.

### 4. Connect, install and launch

```bash
sdb connect <TV-IP>
sdb devices
tizen list tv
tizen install -n playarr-tizen.wgt -t <TARGET-NAME> -- apps/tv-tizen
tizen run -p StrmarrTV1.Playarr -t <TARGET-NAME>
```

In Tizen Studio's **Device Manager**, right-click the connected TV and choose **Permit to install applications** before installing. Use `tizen list tv` to find the exact `<TARGET-NAME>`.

As on webOS, the first launch shows a link code rather than a URL box, finish the pairing from a signed-in browser, as described under [Hosted first-contact linking](#hosted-first-contact-linking-at-playarrapplink).

> **Treat this build as a developer preview.** Tizen rejects unsigned or modified packages, and the certificate profile must permit the target television. Remote handling and AVPlay behaviour have not been validated on a supported real TV.

Samsung's guide: <https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html>

## Apple, iPhone, iPad and Apple TV, Coming soon

There are real native SwiftUI clients in the repository, but **no distributable signed build exists and there is nothing a member of the public can install.** No signing identity, archive or beta distribution has been set up.

What is in the tree today:

| Target | Path | Minimum OS | Bundle identifier |
| --- | --- | --- | --- |
| iPhone and iPad | `clients/ios/` | iOS 17.0 | `com.playarr.ios` |
| Apple TV | `clients/apple-tv/` | tvOS 17.0 | `com.playarr.playarr.tvos` |

Both consume the same `PlayarrKit` Swift package for API models, networking, device-code authentication and AVFoundation playback. If you have Xcode and want to run the tvOS app on a simulator:

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr/clients/apple-tv
xcodegen generate
xcodebuild -project PlayarrTV.xcodeproj -scheme PlayarrTV \
  -destination 'platform=tvOS Simulator,name=Apple TV' test
```

The bundle identifier, signing team, version and artwork are development defaults. Because Playarr's client-platform enum has no tvOS value, the Apple TV app currently identifies as `ios`.

## Signing in

No Playarr package contains your server address, your credentials or a token. Every client learns where your server is at first launch, using one of three routes.

### Direct sign-in

Browsers, phones and tablets can enter a Playarr URL and use a username and password (`POST /api/v1/auth/login`), or choose **Sign in with QR code** to open the separate `/login/qr` route. QR sign-in uses the same hosted first-contact broker as TV and VIDAA: the QR URL contains no server address, and the approving phone or browser supplies the selected Playarr Server. A manually entered URL with no scheme is treated as HTTP, which is what LAN self-hosting usually needs. Household profiles come from `GET /api/v1/users/profiles`, with a four-digit PIN when a profile is locked.

The server's default is `PLAYARR_AUTH_MODE=full-account`, so a username and password are required. Under the opt-in `trusted-network` mode a bearer token is instead acquired on demand, with no interaction and no credentials, the first time a call needs one, and a request from outside the allowlist is refused rather than falling back to a password prompt.

### Device-code flow, when the client already knows your server

This is the standard RFC 8628 device authorisation flow, implemented in the server itself. Roku and the Apple TV app use it, as does the browser's device-login screen.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/oauth/device/code` | The television asks your server for a device code and a short user code |
| `POST /api/v1/oauth/device/authorize` | An already signed-in browser approves that user code |

The TV displays the user code, you approve it from a phone or laptop that is already signed in to that server, and the TV exchanges its device code for a session. Approving a device signs it in as your account, so an account that is not permitted to use Playarr cannot mint a session by pairing either.

### Hosted first-contact linking at `playarr.app/link`

Typing `http://192.168.1.50:8484` on a TV remote is miserable, so clients that know *nothing*, no address, no account, can use a hosted link broker instead. Android TV, Google TV, packaged webOS/Tizen and VIDAA use it for first contact; ordinary Web uses the same broker when **Sign in with QR code** is selected.

1. The requesting client requests a code (`POST /api/link/code`) and shows a QR code, the address `playarr.app/link`, and a short manual code.
2. You scan the QR with a phone, or open <https://playarr.app/link> and type the code. Codes are eight characters drawn from a 32-character unambiguous alphabet, `A`–`Z` without `I` or `O`, and `2`–`9`, formatted `XXXX-XXXX`.
3. In your **already signed-in browser**, you pick the Playarr server and household profile you want on that client.
4. The browser asks *your own Playarr server* for a short-lived device credential for that profile, and hands only that credential plus the server-address bundle back through the broker.
5. The requesting client redeems the credential directly with Playarr and stores the selected URL along with any peer addresses supplied with it.

Each code lives in its own isolated Durable Object, **expires after five minutes**, and is polled every two seconds. The device shows the time remaining and automatically replaces an expired code.

> **What the link record contains:** only the device secret, the selected Playarr server addresses, and a single-use Playarr device code. **It never receives a password, a browser bearer token, or a refresh token.** The broker holds no runtime secrets, and no API or playback traffic passes through it.

## Known limits

- **No store availability anywhere.** No client has been submitted to any store, and there is no 1.0 release. Every route on this page is a direct download, a sideload or a build from source.
- **No DRM on any platform.** There are no Widevine, FairPlay or PlayReady licence endpoints in the API at all, so DRM-protected playback is not offered. That is a deliberate design position, not a temporary gap.
- **Chromecast, AirPlay and deep linking are not built yet** on any client.
- **No real-device certification has been done.** The webOS and Tizen packages in particular are labelled developer previews until playback, remote handling, suspend and resume are validated on representative hardware.
- **Roku and Apple TV report a substitute platform identity** (`web` and `ios` respectively) because Playarr's client-platform enum does not yet define values for them.
- **The Xbox client is not built yet.** `clients/xbox/` contains a small amount of C# shared model and networking code and a `ClientPlatform::Xbox` value on the server. There is no application, no package and no install route, and it is not listed on the clients hub.
