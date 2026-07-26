from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "components" / "MainScene.brs").read_text(encoding="utf-8")
SCENE = (ROOT / "components" / "MainScene.xml").read_text(encoding="utf-8")
CONFIG = (ROOT / "source" / "Config.brs").read_text(encoding="utf-8")


class ApiContractTests(unittest.TestCase):
    def test_uses_the_checked_in_streamarr_paths(self) -> None:
        expected = {
            "GET /api/system/version": ('"version", "GET", "/api/system/version"'),
            "POST /api/v1/auth/refresh": ('"refresh", "POST", "/api/v1/auth/refresh"'),
            "POST /api/v1/oauth/device/code": ('"deviceCode", "POST", "/api/v1/oauth/device/code"'),
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
        self.assertIn('"X-Streamarr-Client-Platform"', CONFIG)


class NavigationContractTests(unittest.TestCase):
    def test_overflowing_collections_are_native_scenegraph_lists(self) -> None:
        self.assertRegex(SCENE, r'<RowList id="libraryList"')
        self.assertRegex(SCENE, r'<RowList id="profilesRow"')
        self.assertRegex(SCENE, r'<LabelList id="detailActions"')
        self.assertIn('rowFocusAnimationStyle="fixedFocusWrap"', SCENE)

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

    def test_authorisation_header_is_not_sent_to_external_video_hosts(self) -> None:
        self.assertIn("content.httpHeaders = contentHeadersForUrl(content.url)", MAIN)
        self.assertIn("return []", MAIN)

    def test_playback_stop_can_wait_for_an_in_flight_heartbeat(self) -> None:
        self.assertIn("m.queuedPlaybackEvent = body", MAIN)
        self.assertIn('action = "playbackEvent" and m.queuedPlaybackEvent', MAIN)

    def test_token_refresh_does_not_cover_active_video(self) -> None:
        self.assertIn('if m.top.screenState <> "playback"', MAIN)

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
