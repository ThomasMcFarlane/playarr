# Playarr Android

`clients/android/` is the repository's only Android project. It produces one
native APK for phones, tablets, Android TV, and Google TV. The `app` directory
is its single application module; the `core-*` directories are internal
library modules in the same Gradle project.

## Module graph

```text
playarr-android
├── core-auth          account and device authentication
├── core-data          server configuration, models, and Retrofit APIs
├── core-designsystem  shared Compose theme and components
├── core-domain        repositories and use cases
├── core-player        Media3/ExoPlayer wrapper
├── core-update        update policy and Play update integration
└── app                responsive native application and APK
```

## Build

Use JDK 21:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd clients/android
./gradlew :app:testDebugUnitTest \
  :app:assembleDebug \
  :app:lintDebug
```

The APK is written to `clients/android/app/build/outputs/apk/debug/`.

Firebase invite notifications accept the public Android project values through
the `firebaseApiKey`, `firebaseMobileApplicationId`, `firebaseProjectId`, and
`firebaseSenderId` Gradle properties. With no values supplied, the app builds
normally with push registration disabled.

## Responsive application contract

- The canonical Google Play package is `app.playarr.mobile` on every Android
  device. The playarr.app sideload channel temporarily retains the legacy
  `io.playarr.mobile` ID so existing APK installations remain updateable; the
  two IDs install side by side during this migration.
- The manifest exposes both normal and Leanback launcher categories.
- Runtime UI-mode detection selects `android-mobile` or `android-tv` request
  headers without changing the package or APK.
- Phone layouts use Playarr's floating navigation pill, touch-sized landscape
  rails, edge-to-edge artwork, and compact detail surfaces.
- Wide and television layouts use the same native components with Playarr's
  editorial stage, right-hand content rails, immersive mode, and D-pad focus
  scaling.
- Television sign-in starts at `playarr.app`: the app displays a QR and manual code, and the
  profile selected in the browser supplies the short-lived Playarr Server device credential plus its
  server-address bundle. No server URL is entered or compiled into the television application.
- Touch-device username/password sign-in still accepts a direct Playarr Server URL for account setup.
- Phones, tablets, and television: all visible screens are native Compose;
  playback uses Media3. There is **no WebView presentation layer** on any
  form factor. Do not reintroduce `PlayarrTvWebShell` or SPA AE freeze gates
  for television "parity" (see `clients/android/AGENTS.md`).

Cleartext HTTP is permitted because self-hosted Playarr Server instances commonly run
on a private LAN. Public deployments should use HTTPS.

## Publishing

Release tags use `android-v<semver>`. The release build requires the four
`ANDROID_KEYSTORE_*` environment variables and publishes one signed APK plus a
checksum and update manifest at:

- `https://playarr.app/downloads/android/playarr-android.apk`

The same tag also builds an AAB with the canonical `app.playarr.mobile` ID and
publishes it privately to Google Play's internal-testing track. A manual
workflow dispatch can publish a semver without creating a tag. Fastlane keeps
the English store listing and branded Play assets in `fastlane/metadata/android`.
The Play channel has its own upload certificate and uses Play App Signing;
the legacy sideload certificate and update chain remain untouched.
The `release-android` environment stores that upload identity as
`ANDROID_PLAY_KEYSTORE_BASE64`, `ANDROID_PLAY_KEYSTORE_PASSWORD`,
`ANDROID_PLAY_KEY_ALIAS`, and `ANDROID_PLAY_KEY_PASSWORD`, with its public
fingerprint in `ANDROID_PLAY_SIGNING_CERT_SHA256`.

The `release-android` GitHub environment must also define the non-secret
`ANDROID_SIGNING_CERT_SHA256` variable with the release certificate's SHA-256 fingerprint. The
publisher rejects missing, mismatched, multi-signer, or Android debug certificates and validates
the APK package and version against the release tag before uploading anything.

The first production signing certificate is permanent: later APKs signed with a different
certificate cannot update existing installations.

## Chromecast

The app can act as a Google Cast sender, launching Playarr's own custom web
receiver on a Chromecast device rather than casting through a generic media
receiver. The receiver's App ID is set via the `castReceiverAppId` Gradle
property, surfaced to the app as the `CAST_RECEIVER_APP_ID` `BuildConfig`
field; with no value supplied, casting stays inert. See
[`docs/architecture/clients/cast.md`](../../docs/architecture/clients/cast.md)
for the full protocol, auth model, and configuration story shared across all
three senders.

The Cast button only appears on phone/tablet form factors: it is hidden on
the television layout, since a television casting to another Cast device is
not a meaningful action. No Google Cast Developer Console registration exists
yet, so the App ID above is a placeholder and casting has not been exercised
against a real device.
