# mobile-android

The Playarr Android app is the single native phone, tablet, Android TV, and
Google TV APK. One responsive Jetpack Compose application adapts its layout,
navigation, focus treatment, and client identity to the current device.

The app targets Android 8.0+ (`minSdk 26`). Its native UI owns:

- per-account Streamarr server sign-in and connection recovery;
- responsive phone, tablet, and television Home, Search, libraries, and
  playlist navigation;
- native profiles, settings, title details, watch progress, and Media3 playback;
- Google Play in-app updates and Firebase invite notifications;
- Android lifecycle and fullscreen handling; and
- native push registration aligned with the authenticated account.

The app detects Android's current UI mode. Phones and tablets identify as
`android-mobile` and use touch layouts; televisions identify as `android-tv`,
expose a Leanback launcher, use Playarr's grouped wide navigation and support
D-pad focus. Both device types install and update the same package. Television
sign-in uses device-code linking against the server address entered on screen.

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
├── MainActivity.kt            responsive phone/TV activity
├── ui/                        native sign-in, catalogue, details, and player
├── update/                    Google Play and signed sideload updates
└── di/                        native data, auth, and update bindings
```

`mobile-android` is the only application module included by the shared Android
Gradle build. There is no WebView presentation layer or separate TV APK.
