# Client architecture: universal Android app on TV

Android TV and Google TV run the same native Playarr package and APK as phones
and tablets: `clients/mobile-android/`, package `io.streamarr.mobile`.

## Native presentation

The app is Jetpack Compose throughout. It does not host Playarr Web in a
WebView. Runtime UI-mode and window-width checks adapt the shared screens:

- television and wide displays use an always-visible navigation rail;
- poster dimensions and spacing grow for ten-foot viewing;
- focusable content scales when reached with a D-pad;
- the Activity enters immersive fullscreen mode on televisions; and
- the same catalogue, title-detail, settings, and Media3 player routes remain
  available on touch devices.

The manifest declares `LEANBACK_LAUNCHER` and marks touch and Leanback hardware
features optional, allowing the same artefact to install across all supported
Android form factors.

## Server and authentication

There is no build-time or default Streamarr URL. The native sign-in screen asks
for the server URL with the account credentials, normalises a missing scheme to
LAN-friendly HTTP, and stores the selected URL in `ServerConfigStore` for that
session. Signing out returns to the same screen so another account or server can
be selected.

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
cd clients/android-shared
./gradlew :mobile-android:testDebugUnitTest \
  :mobile-android:assembleDebug \
  :mobile-android:lintDebug
```

Install that one APK on both phone and television targets:

```bash
adb -s <phone> install -r ../mobile-android/build/outputs/apk/debug/mobile-android-debug.apk
adb -s <tv> install -r ../mobile-android/build/outputs/apk/debug/mobile-android-debug.apk
```
