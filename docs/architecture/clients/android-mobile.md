# Client architecture: universal Android app

Playarr ships one native APK for phones, tablets, Android TV, and Google TV.
There is one package (`io.streamarr.mobile`), one Compose navigation graph, one
Media3 player, and one public download.

## Platform baseline

- Minimum SDK 26 (Android 8.0 Oreo).
- Compile and target SDK 37.
- AGP 9.3.0, Gradle 9.5.1, and Kotlin 2.3.10.
- Jetpack Compose, Hilt, DataStore, Media3, Google Play In-App Updates, and
  Firebase Cloud Messaging.

## Native responsive presentation

`MainActivity` detects television UI mode and mounts `PlayarrApp`. All visible
routes are native Compose:

- account and server sign-in;
- responsive home shelves and library grid;
- work details and playable child rows;
- Media3 direct/HLS playback; and
- connected-server settings and sign-out.

Phones use bottom navigation and compact touch geometry. Wide screens and
televisions use a navigation rail, larger poster geometry, immersive mode, and
D-pad focus scaling. Short landscape windows use a compact sign-in form so all
fields and the submit action remain visible.

## Authentication and server ownership

The server URL is never compiled into the app. Each sign-in supplies its
Streamarr URL with the username and password. `ServerConfigStore` persists the
normalised URL for that account on the device, while `TokenStore` persists the
issued session. Signing out clears the session and returns to the sign-in form,
where a different account or server can be selected.

A missing scheme is interpreted as HTTP for LAN self-hosting. Absolute HTTP
and HTTPS addresses are accepted. The request client reads the stored address
for every request and identifies as `android-mobile` or `android-tv` according
to the current device mode.

## Playback and updates

The native player calls Streamarr's playback negotiation endpoint, maps direct
and HLS responses onto the shared `StreamarrPlayer`, and renders Media3's
`PlayerView`. The same implementation runs on touch and television devices.

Google Play and signed sideload update mechanisms remain native. Both update
channels replace the same package and use the same version code.

## Distribution

The release artefact is one Android App Bundle for Google Play and one signed
APK for direct installation across every supported Android form factor. The
manifest exposes both standard and Leanback launcher categories. Cleartext HTTP
remains permitted for private LAN deployments; HTTPS is recommended for remote
access.
