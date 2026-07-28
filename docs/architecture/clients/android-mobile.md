# Client architecture: universal Android app

Playarr ships one APK for phones, tablets, Android TV, and Google TV.
There is one package (`io.playarr.mobile`), one public download, and a single
product bar: native Compose + Media3 with full parity to Playarr Web (see
[`../client-principles.md`](../client-principles.md) and
[`android-web-parity.md`](android-web-parity.md)).

Phones and tablets use the native Compose navigation graph and Media3 player
end to end. Television currently has a temporary WebView shell of Playarr Web
for the signed-in experience; that is a documented policy deviation and must
return to the same native Compose + Media3 path (see
[`android-tv.md`](android-tv.md)).

## Platform baseline

- Minimum SDK 26 (Android 8.0 Oreo).
- Compile and target SDK 37.
- AGP 9.3.0, Gradle 9.5.1, and Kotlin 2.3.10.
- Jetpack Compose, Hilt, DataStore, Media3, Google Play In-App Updates, and
  Firebase Cloud Messaging.

## Native responsive presentation

`MainActivity` detects television UI mode and mounts `PlayarrApp`. All visible
routes are native Compose:

- account and server sign-in plus profile switching;
- responsive feature stages, progress shelves, search, and filtered libraries;
- playlists, work details, watched-state actions, and playable child rows;
- Media3 direct/HLS playback; and
- appearance, avatar, language, player, server, profile-lock, invitation, and
  sign-out settings.

Phones use safe-area-aware bottom navigation and compact touch geometry. Wide
screens and televisions use grouped navigation, larger landscape artwork,
immersive mode, and D-pad focus scaling. Television density maps the native
layout to Playarr Web's 1920 x 1080 presentation canvas.

## Authentication and server ownership

The server URL is never compiled into the app. Each sign-in supplies its
Playarr Server URL with the username and password. `ServerConfigStore` persists the
normalised URL for that account on the device, while `TokenStore` persists the
issued session. Signing out clears the session and returns to the sign-in form,
where a different account or server can be selected.

A missing scheme is interpreted as HTTP for LAN self-hosting. Absolute HTTP
and HTTPS addresses are accepted. The request client reads the stored address
for every request and identifies as `android-mobile` or `android-tv` according
to the current device mode.

## Playback and updates

The native player calls Playarr Server's playback negotiation endpoint, maps direct
and HLS responses onto the shared `PlayarrPlayer`, and renders Media3's
`PlayerView`. The same implementation runs on touch and television devices.

Google Play and signed sideload update mechanisms remain native. Both update
channels replace the same package and use the same version code.

## Distribution

The release artefact is one Android App Bundle for Google Play and one signed
APK for direct installation across every supported Android form factor. The
manifest exposes both standard and Leanback launcher categories. Cleartext HTTP
remains permitted for private LAN deployments; HTTPS is recommended for remote
access.
