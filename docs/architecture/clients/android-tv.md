# Client architecture: universal Android app on TV

Android TV and Google TV run the same native Playarr package and APK as phones
and tablets: `clients/android/`, package `io.streamarr.mobile`.

## Native presentation

The app is Jetpack Compose throughout. It does not host Playarr Web in a
WebView. Runtime UI-mode and window-width checks adapt the shared screens:

- television displays use the same grouped navigation rail and 1920 x 1080
  stage geometry as Playarr Web;
- landscape artwork, progress shelves, and spacing are tuned for ten-foot
  viewing;
- focusable content scales when reached with a D-pad;
- the Activity enters immersive fullscreen mode on televisions; and
- the same catalogue, title-detail, settings, and Media3 player routes remain
  available on touch devices.

The manifest declares `LEANBACK_LAUNCHER` and marks touch and Leanback hardware
features optional, allowing the same artefact to install across all supported
Android form factors.

## Server and authentication

There is no build-time or default Streamarr URL. The native television linking
screen asks for the server URL, requests a device code from that server, and
polls it until the viewer approves the television. A missing scheme is
normalised to LAN-friendly HTTP and the selected URL is stored in
`ServerConfigStore`. Signing out returns to linking so another account or
server can be selected.

Requests identify as `android-tv` on television UI mode and `android-mobile`
elsewhere. Both identities come from the same installed package.

## Input and playback

Standard Compose focus and click semantics accept touch, keyboard, and D-pad
input. Text entry uses Android's system keyboard. Media playback is native
Media3/ExoPlayer after Streamarr's playback endpoint selects direct or HLS
delivery.

## Build and verification

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd clients/android
./gradlew :app:testDebugUnitTest \
  :app:assembleDebug \
  :app:lintDebug
```

Install that one APK on both phone and television targets:

```bash
adb -s <phone> install -r app/build/outputs/apk/debug/playarr-android-debug.apk
adb -s <tv> install -r app/build/outputs/apk/debug/playarr-android-debug.apk
```
