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

There is no build-time or user-entered Streamarr URL on television. The native
linking screen requests a one-time code from `playarr.app`, displays both that
manual code and its QR link, and polls the hosted session while the viewer
selects a profile at `playarr.app/link`. The signed-in browser requests and
approves a short-lived device credential directly against that profile's
Streamarr server; the hosted session hands only that credential and its server
address bundle to the television. Android redeems it directly with Streamarr,
stores the selected URL in `ServerConfigStore`, and stores all supplied peer
addresses in `KnownServerGroupStore`. Signing out returns to linking so another
profile can be selected without entering an address with a remote control.

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
