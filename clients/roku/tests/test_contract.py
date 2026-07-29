from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "components" / "MainScene.brs").read_text(encoding="utf-8")
SCENE = (ROOT / "components" / "MainScene.xml").read_text(encoding="utf-8")
CONFIG = (ROOT / "source" / "Config.brs").read_text(encoding="utf-8")


class ApiContractTests(unittest.TestCase):
    def test_uses_the_checked_in_playarr_paths(self) -> None:
        expected = {
            "GET /api/system/version": ('"version", "GET", "/api/system/version"'),
            "POST /api/v1/auth/refresh": ('"refresh", "POST", "/api/v1/auth/refresh"'),
            # Pairing uses hosted playarr.app link (QR login); token poll still
            # hits the real server device-token endpoint after the claim.
            "POST /api/v1/oauth/token": ('"deviceToken", "POST", "/api/v1/oauth/token"'),
            "GET /api/v1/users/profiles": ('"profiles", "GET", "/api/v1/users/profiles"'),
            "GET /api/v1/catalog": 'path = "/api/v1/catalog?',
            "GET /api/v1/catalog/{id}": '"detail", "GET", "/api/v1/catalog/"',
            "GET /api/v1/playback/{id}": 'path = "/api/v1/playback/"',
            "POST playback event": '"POST", "/api/v1/playback/sessions/"',
            "GET /api/v1/users/me/profile-pin": ('"profilePin", "GET", "/api/v1/users/me/profile-pin"'),
            "PATCH /api/v1/users/me/profile-pin": ('"profilePinSave", "PATCH", "/api/v1/users/me/profile-pin"'),
        }
        for name, fragment in expected.items():
            with self.subTest(name=name):
                self.assertIn(fragment, MAIN)

    def test_home_rails_fetch_recent_catalog_by_kind(self) -> None:
        # Matches the real Home page's own rail set, confirmed live via
        # Playwright against https://playarr.app/ (5 rails: Continue/Start
        # watching, New movies, New series, More movies, More series -- no
        # "New Sites" rail exists there at all).
        self.assertIn("kind=movie&sort=recent", MAIN)
        self.assertIn("kind=series&sort=recent", MAIN)
        self.assertIn('sub loadHomeMovies()', MAIN)
        self.assertIn('sub loadHomeSeries()', MAIN)
        self.assertIn('sub loadHomeMoreMovies()', MAIN)
        self.assertIn('sub loadHomeMoreSeries()', MAIN)

    def test_device_grant_is_rfc_8628(self) -> None:
        self.assertIn(
            'grant_type: "urn:ietf:params:oauth:grant-type:device_code"',
            MAIN,
        )
        self.assertRegex(MAIN, r'code = "authorization_pending"')
        self.assertRegex(MAIN, r'code = "slow_down"')

    def test_roku_identity_is_centralised_and_documented(self) -> None:
        self.assertIn('clientPlatform: "web"', CONFIG)
        self.assertIn("Compatibility identity", CONFIG)
        self.assertIn('"X-Playarr-Client-Platform"', CONFIG)


class NavigationContractTests(unittest.TestCase):
    def test_overflowing_collections_are_native_scenegraph_lists(self) -> None:
        self.assertRegex(SCENE, r'<RowList id="libraryList"')
        self.assertRegex(SCENE, r'<RowList id="profilesRow"')
        self.assertRegex(SCENE, r'<LabelList id="detailActions"')
        self.assertIn('rowFocusAnimationStyle="fixedFocusWrap"', SCENE)

    def test_profiles_screen_renders_a_horizontal_avatar_row(self) -> None:
        # Real-screenshot correction pass: tv-web's actual Profiles page
        # renders each profile as a large circular gradient avatar button in
        # a horizontal row, not the old vertical LabelList("profilesList")
        # text list -- see MainScene.xml's profilesGroup comment and
        # ProfileAvatar.xml's header comment for the full rationale,
        # including the two platform-limitation compromises (pre-rendered
        # gradient PNGs standing in for a runtime circle mask, and an
        # initial letter standing in for tv-web's SVG mascot icon set).
        self.assertRegex(SCENE, r'itemComponentName="ProfileAvatar"')
        self.assertRegex(SCENE, r'<Label id="profilesKicker"[^>]*text="PROFILES"')
        self.assertIn("Who’s watching?", SCENE)
        self.assertIn('m.profilesRow.ObserveField("rowItemSelected", "onProfileSelected")', MAIN)
        self.assertIn("sub buildProfileAvatarContent(profiles as Object)", MAIN)
        self.assertIn("function profileAvatarPresetId(id as String) as String", MAIN)
        self.assertIn("function profileAvatarInitial(name as String) as String", MAIN)
        # rowItemSelected is a [row, col] position, unlike the old plain
        # itemSelected index -- regression guard against reintroducing the
        # old LabelList event shape.
        position_unpack = re.search(
            r"sub onProfileSelected\(event as Object\).*?end sub", MAIN, flags=re.DOTALL
        )
        self.assertIsNotNone(position_unpack)
        assert position_unpack is not None
        self.assertIn("position = event.GetData()", position_unpack.group(0))
        self.assertIn("index = position[1]", position_unpack.group(0))

    def test_profile_avatar_component_is_a_circular_gradient_item_renderer(self) -> None:
        component_path = ROOT / "components" / "ProfileAvatar.xml"
        self.assertTrue(component_path.is_file())
        component_source = component_path.read_text(encoding="utf-8")
        self.assertRegex(component_source, r'<component name="ProfileAvatar" extends="Group">')
        self.assertIn('<field id="itemContent" type="node" onChange="onContentChanged" />', component_source)
        self.assertIn('<field id="focusPercent" type="float" onChange="onFocusChanged" />', component_source)
        self.assertIn('uri="pkg:/images/avatar-ring.png"', component_source)
        brs_path = ROOT / "components" / "ProfileAvatar.brs"
        self.assertTrue(brs_path.is_file())
        brs_source = brs_path.read_text(encoding="utf-8")
        self.assertIn('m.avatarImage.uri = "pkg:/images/avatar-" + content.presetId + ".png"', brs_source)
        # Every preset PNG this component can reference must actually be
        # packaged (see scripts/package.sh, which bundles the whole images/
        # directory), or a real profile could resolve to a missing asset.
        for preset in ("astronaut", "cat", "dinosaur", "robot", "pirate", "alien"):
            with self.subTest(preset=preset):
                self.assertTrue(
                    (ROOT / "images" / f"avatar-{preset}.png").is_file(),
                    f"missing avatar-{preset}.png referenced by ProfileAvatar.brs",
                )

    def test_video_uses_the_native_roku_surface(self) -> None:
        self.assertRegex(SCENE, r'<Video id="video"')
        self.assertIn('m.video.control = "play"', MAIN)
        self.assertIn('key = "back"', MAIN)
        self.assertIn("content.httpHeaders = contentHeadersForUrl", MAIN)

    def test_library_paginates_near_the_focused_end(self) -> None:
        self.assertIn('itemIndex >= m.items.Count() - 10', MAIN)
        self.assertIn('loadCatalog(true)', MAIN)

    def test_home_rails_fetch_recent_catalog_by_kind(self) -> None:
        # Matches the real Home page's own rail set, confirmed live via
        # Playwright against https://playarr.app/ (5 rails: Continue/Start
        # watching, New movies, New series, More movies, More series -- no
        # "New Sites" rail exists there at all).
        self.assertIn("kind=movie&sort=recent", MAIN)
        self.assertIn("kind=series&sort=recent", MAIN)
        self.assertIn('sub loadHomeMovies()', MAIN)
        self.assertIn('sub loadHomeSeries()', MAIN)
        self.assertIn('sub loadHomeMoreMovies()', MAIN)
        self.assertIn('sub loadHomeMoreSeries()', MAIN)


class SecretSafetyTests(unittest.TestCase):
    def test_authorisation_header_is_not_sent_to_external_artwork_hosts(self) -> None:
        helper = re.search(
            r"function artworkHeaders.*?end function",
            MAIN,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(helper)
        assert helper is not None
        self.assertIn("url.Left(serverPrefix.Len()) = serverPrefix", helper.group(0))
        self.assertIn("return {}", helper.group(0))

    def test_catalog_artwork_uses_server_proxy_not_cdn_direct(self) -> None:
        # Stick must not fetch TMDB/CDN hosts directly (Poster stays blank).
        helper = re.search(
            r"function resolveImageUrl.*?end function",
            MAIN,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(helper)
        assert helper is not None
        body = helper.group(0)
        self.assertIn("/api/v1/artwork/work/", body)
        self.assertNotIn('image.url.Left(7) = "http://"', body)
        self.assertNotIn('image.url.Left(8) = "https://"', body)

    def test_authorisation_header_is_not_sent_to_external_video_hosts(self) -> None:
        self.assertIn("content.httpHeaders = contentHeadersForUrl(content.url)", MAIN)
        self.assertIn("return []", MAIN)

    def test_playback_stop_can_wait_for_an_in_flight_heartbeat(self) -> None:
        self.assertIn("m.queuedPlaybackEvent = body", MAIN)
        self.assertIn('action = "playbackEvent" and m.queuedPlaybackEvent', MAIN)

    def test_token_refresh_does_not_cover_active_video(self) -> None:
        self.assertIn('if m.top.screenState <> "playback"', MAIN)

    def test_first_launch_uses_hosted_link_not_a_typed_server_url(self) -> None:
        self.assertIn('hostedLinkOrigin: "https://playarr.app"', CONFIG)
        self.assertIn("if m.serverUrl = \"\"\n        beginHostedLink()", MAIN)
        self.assertIn('url: AppConfig().hostedLinkOrigin + "/api/link/code"', MAIN)
        self.assertIn(
            'url: AppConfig().hostedLinkOrigin + "/api/link/code/" + UrlEncode(m.hostedDeviceCode)',
            MAIN,
        )

    def test_hosted_link_renders_a_qr_and_keeps_a_manual_escape_hatch(self) -> None:
        self.assertIn('id="pairingQr"', SCENE)
        self.assertIn(
            'm.pairingQr.uri = AppConfig().hostedLinkOrigin + "/api/link/qr?value="',
            MAIN,
        )
        self.assertIn('key = "options"', MAIN)
        self.assertIn("openServerDialog()", MAIN)

    def test_pairing_screen_matches_web_login_qr(self) -> None:
        # Pairing mirrors web `/login/qr` layout (centered panel + QR stack)
        # in Playarr dark theme (TV product), not desktop light AuthLight.
        self.assertNotIn('id="pairingGlow1"', SCENE)
        self.assertIn('id="pairingAuthBg"', SCENE)
        self.assertIn('uri="pkg:/images/pairing-auth-bg.png"', SCENE)
        self.assertIn('id="pairingLogoIcon"', SCENE)
        self.assertIn('text="WELCOME HOME"', SCENE)
        self.assertIn('text="Sign in to Playarr"', SCENE)
        self.assertIn('color="0xF4F0F1FF"', SCENE)  # dark-theme ink on title
        self.assertIn('id="pairingQrBg"', SCENE)
        self.assertIn('id="pairingQrFrame"', SCENE)
        self.assertIn("sub showPairingBusy(", MAIN)
        self.assertIn("beginHostedLink()", MAIN)
        # The functional ids the .brs logic drives must still all exist.
        for pairing_id in (
            "pairingQr",
            "pairingCode",
            "pairingStatus",
            "pairingManualHit",
            "pairingManualLabel",
            "pairingManualPill",
            "pairingThemeHit",
            "pairingLangHit",
            "pairingBackHit",
            "pairingKicker",
            "pairingTitle",
            "pairingDescription",
            "pairingUrl",
            "pairingTimer",
        ):
            with self.subTest(pairing_id=pairing_id):
                self.assertIn(f'id="{pairing_id}"', SCENE)
        # 1:1 web chrome: square dropdown triggers + Sign in manually pill.
        self.assertIn("pairing-chrome-dd-theme.png", SCENE)
        self.assertIn("pairing-manual-pill.png", SCENE)
        self.assertIn('text="Sign in manually"', SCENE)
        self.assertIn("applyPairingChromeFocus()", MAIN)
        self.assertIn("openServerDialog()", MAIN)
        # Chrome / remote Back always returns to Who's watching (web LoginShell).
        self.assertIn("sub returnFromPairingToProfiles(", MAIN)
        self.assertIn('state = "pairing" and key = "back"', MAIN)
        self.assertIn("returnFromPairingToProfiles()", MAIN)
        self.assertIn('id="pairingBackBtn"', SCENE)
        self.assertIn('id="pairingBackHit"', SCENE)
        # Dropdown labels fill the 48px trigger and centre vertically.
        self.assertIn('id="pairingThemeLabel"', SCENE)
        self.assertIn('vertAlign="center"', SCENE)
        # Countdown must tick every second (web setInterval 1000), not the old 30s clock.
        self.assertIn('id="clockTimer" duration="1"', SCENE)
        self.assertIn("updatePairingCountdown()", MAIN)

    def test_pairing_logo_asset_exists_as_a_real_raster_not_a_placeholder(self) -> None:
        logo_path = ROOT / "images" / "pairing-logo.png"
        self.assertTrue(logo_path.is_file(), f"missing {logo_path}")
        header = logo_path.read_bytes()[:8]
        self.assertEqual(header, b"\x89PNG\r\n\x1a\n")

    def test_hosted_link_claim_reuses_the_existing_device_token_poll(self) -> None:
        self.assertIn("sub acceptHostedLinkClaim(data as Object)", MAIN)
        self.assertIn("m.deviceCode = data.server_device_code", MAIN)
        self.assertIn("SaveServerAddresses(m.serverAddresses)", MAIN)
        self.assertIn("pollDeviceToken()", MAIN)

    def test_repository_contains_no_baked_server_or_token(self) -> None:
        binary_suffixes = {".png", ".jpg", ".jpeg", ".zip", ".ico"}
        all_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in ROOT.rglob("*")
            if path.is_file()
            and "build" not in path.parts
            and "__pycache__" not in path.parts
            and path.suffix not in binary_suffixes
            and path.suffix != ".pyc"
        )
        self.assertNotRegex(all_text, r"https?://(?:192\.168|10\.|172\.(?:1[6-9]|2\d|3[01]))")
        self.assertNotRegex(all_text, r"Bearer ey[A-Za-z0-9_-]{10,}")


if __name__ == "__main__":
    unittest.main()


class BrandingAndResidualAssetTests(unittest.TestCase):
    def test_channel_poster_assets_are_non_empty_playarr_branding(self) -> None:
        images = ROOT / "images"
        for name in ("channel-poster-hd.png", "channel-poster-fhd.png", "pairing-logo.png"):
            path = images / name
            self.assertTrue(path.is_file(), name)
            self.assertGreater(path.stat().st_size, 1000, name)

    def test_manifest_points_at_channel_posters(self) -> None:
        manifest = (ROOT / "manifest").read_text(encoding="utf-8")
        self.assertIn("mm_icon_focus_hd=pkg:/images/channel-poster-hd.png", manifest)
        self.assertIn("mm_icon_focus_fhd=pkg:/images/channel-poster-fhd.png", manifest)
        self.assertIn("title=Playarr for Roku", manifest)

    def test_profiles_status_uses_watching_now(self) -> None:
        self.assertIn('suffix = "WATCHING NOW"', MAIN)
        self.assertNotIn('suffix = "Linked"', MAIN)

    def test_profiles_hides_nav_chrome(self) -> None:
        self.assertIn('name <> "profiles"', MAIN)

    def test_parity_suite_forbids_full_stage_residual_fill_theater(self) -> None:
        suite = (ROOT / "scripts" / "parity_ae0.py").read_text(encoding="utf-8")
        self.assertIn("full_ae == 0", suite)
        self.assertIn("MAX_RESIDUAL_FRAC", suite)
        # Must not fill residual from web freezes or offline-composite residual
        self.assertNotIn("filled[mask] = w[mask]", suite)
        self.assertNotIn("r[res_mask] = res_rgb[res_mask]", suite)
        self.assertIn("RESIDUAL_RECTS", suite)

    def test_scene_has_no_full_stage_residual_overpaint(self) -> None:
        self.assertNotIn("homeContentResidual", SCENE)
        self.assertNotIn("browseGroupResidual", SCENE)
        self.assertNotIn("searchGroupResidual", SCENE)
        self.assertNotIn("playlistsGroupResidual", SCENE)
        self.assertNotIn("settingsGroupResidual", SCENE)
        self.assertNotIn("content-residual.png", SCENE)
        # Residual freeze Posters must not exist in product SceneGraph at all
        # (dual stacked UI). hideAllResiduals stays as a no-op guard.
        self.assertNotIn('id="homeResidual"', SCENE)
        self.assertNotIn('id="browseResidual"', SCENE)
        self.assertNotIn('id="profilesResidual"', SCENE)
        self.assertNotIn('id="playbackResidual"', SCENE)
        self.assertNotIn("Residual", SCENE)
        self.assertIn("sub hideAllResiduals()", MAIN)
        self.assertNotIn("content-residual.png", MAIN)

    def test_parity_ae0_suite_requires_full_stage_ae0(self) -> None:
        suite = (ROOT / "scripts" / "parity_ae0.py").read_text(encoding="utf-8")
        # Full-stage AE=0 on real freezes; no residual-mask exclusion; no offline composite.
        self.assertIn("full_ae == 0", suite)
        self.assertIn("ok = full_ae == 0 and not stage_fill", suite)
        self.assertIn("MAX_RESIDUAL_FRAC", suite)
        self.assertNotIn("filled[mask] = w[mask]", suite)
        self.assertNotIn("r[res_mask] = res_rgb[res_mask]", suite)

    def test_shell_loads_in_place_not_fullscreen_status(self) -> None:
        # Authenticated navigations keep the target shell visible while data
        # loads; fullscreen statusGroup is not used for product chrome.
        self.assertNotIn('showStatus("Loading home"', MAIN)
        self.assertNotIn('showStatus("Loading details"', MAIN)
        self.assertNotIn('showStatus("Searching"', MAIN)
        self.assertNotIn('showStatus("Loading library"', MAIN)
        self.assertNotIn('showStatus("Loading playlist"', MAIN)
        self.assertNotIn('showStatus("Connecting"', MAIN)
        self.assertNotIn('showStatus("Link this Roku"', MAIN)
        self.assertIn("sub showPairingBusy(", MAIN)
        self.assertIn('visible="false"', SCENE)  # statusGroup starts hidden
        # Product surfaces must not swap to status walls on bad payloads.
        self.assertNotIn('showStatus("Library unavailable"', MAIN)
        self.assertNotIn('showStatus("Search unavailable"', MAIN)
        self.assertNotIn('showStatus("Playlists unavailable"', MAIN)
        self.assertNotIn('showStatus("Playlist unavailable"', MAIN)
        self.assertNotIn('showStatus("Title unavailable"', MAIN)
        self.assertNotIn('showStatus("Playback unavailable"', MAIN)
        self.assertIn('sendApi("catalogKinds", "GET", "/api/v1/catalog/kinds"', MAIN)
        self.assertIn("sub applyNavDockKindFilter()", MAIN)
        self.assertIn('enabled = workKind <> "site"', MAIN)
        # Sites hard-gated until kinds proves "site".
        self.assertIn('workKind = "site"', MAIN)
        self.assertIn('Lookup("site")', MAIN)
        # Home rails use real catalog artwork (not empty residual-budget tiles).
        self.assertIn("item.hdPosterUrl = artworkUrl(work)", MAIN)
        self.assertNotIn(
            "Leave artwork empty so PosterCard stays on surface-soft",
            MAIN,
        )
