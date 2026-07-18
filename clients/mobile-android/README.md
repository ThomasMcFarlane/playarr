# mobile-android

The Playarr Android phone/tablet app is a thin native host for the same
responsive React application used by Playarr Web and Android TV. This keeps
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

The hosted bundle identifies this wrapper through the
`PlayarrAndroidMobile/<version>` user-agent token. It selects the
`android-mobile` API compatibility profile and the existing phone
breakpoints rather than the Android TV D-pad profile.

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
├── update/                    Google Play in-app update integration
└── di/                        native data, auth, and update bindings
```

All visible app routes come from `clients/tv-web/web`; the Android module no
longer contains a parallel Compose catalogue, navigation graph, or player.
