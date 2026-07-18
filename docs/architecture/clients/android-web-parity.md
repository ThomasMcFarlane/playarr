# Android and Playarr Web parity audit

The Android application is one native Compose package for phones, tablets,
Android TV, and Google TV. It does not embed Playarr Web. Product parity means
that the same account, catalogue, navigation, playback, profile, playlist, and
settings tasks are available with platform-native controls and the same visual
hierarchy.

## Audited surfaces

| Playarr Web surface | Native Android surface | Responsive behaviour |
| --- | --- | --- |
| Sign in | Direct per-account server sign-in | Flat phone form; device-code linking on television |
| Profiles | Profile selector, PIN entry, settings, and sign-out | Touch carousel; focusable television row |
| Home | Feature stage, continue/start watching, and kind rails | Full-width touch rails; fixed 1920 x 1080 television stage |
| Search | Query, kind filters, work results, and playlist results | Native keyboard input; D-pad-safe result cards |
| Series, Movies, Sites, Music | Access-gated libraries, A-Z navigation, view, size, and sort filters | Bottom navigation on phones; grouped rail on television |
| Work details | Kind-aware child hierarchy and playable media actions | Scrolling phone page; staged television layout |
| Playlists | Personal/system and video/audio filters, creation, reorder, removal, and deletion | Adaptive card grid and native confirmation dialogs |
| Player | Direct/HLS negotiation, resume, progress persistence, track controls, and fullscreen playback | One Media3 player on touch and television |
| Settings | Appearance, avatar, language, player defaults, server, profile lock, and invitation | Horizontal phone section picker; permanent television split view |

## Visual contract

- Colours use the same Playarr light and dark surface, ink, muted-ink, and pink
  tokens as the web client.
- Phones use the web client's floating safe-area bottom navigation and
  top-right profile control.
- Television geometry is rendered at a one-CSS-pixel-to-one-physical-pixel
  density against the same 1920 x 1080 canvas used by Playarr Web.
- Content navigation is access-gated from the server's catalogue kinds.
- Every overflowing catalogue or settings surface is a native scroll
  container; focus is not the only way to reach content.
- Artwork requests carry the current bearer token and never expose tokens in
  logs or URLs.

## Interaction contract

- Touch, mouse, keyboard, and D-pad activation share the same navigation graph.
- Television focus moves from the grouped navigation rail into media cards and
  scales the active target without changing selection on hover.
- Long-press media actions provide open, playlist, and watched-state commands.
- Watch progress is loaded into Home, used as the player resume position, and
  persisted during playback and when leaving the player.
- Profile switching replaces the token and identity together so the new
  profile does not inherit the previous profile's catalogue state.
- A server address is entered at runtime and stored for the account; no
  Streamarr URL is compiled into the APK.

## Release verification

Each universal APK release must pass:

1. Android shared-data, authentication, and mobile unit tests.
2. A debug install on phone and Android TV emulators.
3. Phone checks for Home, Search, library filters, Playlists, Profiles,
   Settings, and light/dark appearance.
4. Television checks for the 1920 x 1080 layout, grouped navigation, D-pad
   movement into content, and a playable detail route.
5. A signed release build whose package, version code, certificate, and SHA-256
   digest match the public update manifest.
6. An unauthenticated HTTP request to the versioned APK and stable APK URLs,
   including content type, content disposition, byte length, and checksum.
