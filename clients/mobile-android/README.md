# mobile-android

The Playarr Android app is the single phone, tablet, Android TV, and Google TV
APK. It is a thin native host for the same responsive React application used
by Playarr Web. This keeps
the visible library, profiles, settings, search, and player surfaces in one
codebase while Android retains the platform responsibilities that belong in
an APK.

The app targets Android 8.0+ (`minSdk 26`) and uses a hardware-accelerated
WebView for presentation. Its native Compose layer owns:

- server-address bootstrap and connection recovery;
- lifecycle, cookie, DOM-storage, Back, and fullscreen-video handling;
- Google Play in-app updates and Firebase invite notifications;
- Android image picking for custom profile avatars; and
- a session bridge that keeps native push registration aligned with the
  authenticated web profile.

The app detects Android's current UI mode. Phones and tablets identify as
`PlayarrAndroidMobile/<version>` and use touch breakpoints; televisions identify
as `PlayarrAndroidTV/<version>`, expose a Leanback launcher, fix the web viewport
at 1920 by 1080 CSS pixels, and enable D-pad navigation. Television sideloads
retain the signed playarr.app self-update path.

This module is included by the Gradle root at
`../android-shared/settings.gradle.kts`.

## Build

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd ../android-shared
./gradlew :mobile-android:testDebugUnitTest :mobile-android:assembleDebug
```

The APK is written beneath
`clients/mobile-android/build/outputs/apk/debug/`.

## Structure

```text
src/main/kotlin/io/streamarr/mobile/
├── StreamarrMobileApp.kt      native application, FCM bootstrap
├── MainActivity.kt            Activity hosting the shared web surface
├── ui/web/                    WebView host and server recovery UI
├── update/                    Google Play and signed sideload updates
└── di/                        native data, auth, and update bindings
```

All visible app routes come from `clients/tv-web/web`; the Android module no
longer contains a parallel Compose catalogue, navigation graph, or player.
