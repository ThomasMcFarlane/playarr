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
            "POST /api/v1/oauth/device/code": ('"deviceCode", "POST", "/api/v1/oauth/device/code"'),
            "POST /api/v1/oauth/token": ('"deviceToken", "POST", "/api/v1/oauth/token"'),
            "GET /api/v1/users/profiles": ('"profiles", "GET", "/api/v1/users/profiles"'),
            "GET /api/v1/catalog": 'path = "/api/v1/catalog?',
            "GET /api/v1/catalog/{id}": '"detail", "GET", "/api/v1/catalog/"',
            "GET /api/v1/playback/{id}": 'path = "/api/v1/playback/"',
            "POST playback event": '"POST", "/api/v1/playback/sessions/"',
<<<<<<< Updated upstream
            "GET /api/v1/users/me/profile-pin": ('"profilePin", "GET", "/api/v1/users/me/profile-pin"'),
            "PATCH /api/v1/users/me/profile-pin": ('"profilePinSave", "PATCH", "/api/v1/users/me/profile-pin"'),
=======
            "GET /api/v1/playback/progress": (
                '"watchProgress", "GET", "/api/v1/playback/progress"'
            ),
            "GET /api/v1/catalog/search": 'path = "/api/v1/catalog/search?q="',
            "GET/PATCH /api/v1/users/me/player-preferences": (
                '"/api/v1/users/me/player-preferences"'
            ),
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
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
=======
    def test_home_screen_is_composed_on_the_shared_tv_stage(self) -> None:
        self.assertRegex(SCENE, r'<Group id="homeGroup"')
        self.assertRegex(SCENE, r'<TvStage id="homeStage"')
        self.assertIn("m.homeStage = m.top.findNode(\"homeStage\")", MAIN)
        self.assertIn('m.homeStage.callFunc("playEntrance")', MAIN)

    def test_home_rail_navigation_has_no_wraparound(self) -> None:
        self.assertIn("function moveHomeFocus(delta as Integer) as Boolean", MAIN)
        self.assertIn("newIndex < 0 or newIndex >= m.visibleRails.Count()", MAIN)

    def test_entering_nav_dock_releases_rail_focus(self) -> None:
        self.assertIn("sub enterNavDock()", MAIN)
        self.assertIn("m.visibleRails[idx].row.SetFocus(false)", MAIN)

    def test_library_grid_is_a_native_scenegraph_markup_grid(self) -> None:
        self.assertRegex(SCENE, r'<MarkupGrid id="browseGrid"')
        self.assertIn('path = "/api/v1/catalog?kind=" + m.browseKind', MAIN)
        self.assertIn("sub loadBrowseCatalog(append as Boolean)", MAIN)
        self.assertIn("sub onBrowseItemFocused(event as Object)", MAIN)
        self.assertIn("itemIndex >= m.browseItems.Count() - 10", MAIN)

    def test_library_grid_detail_back_returns_to_the_grid_not_home(self) -> None:
        self.assertIn('m.detailOrigin = "browse"', MAIN)
        self.assertIn(
            'else if m.detailOrigin = "browse"\n            showOnly("browse")',
            MAIN,
        )

    def test_library_grid_back_returns_to_home(self) -> None:
        self.assertIn('else if state = "browse" and key = "back"', MAIN)

    def test_search_screen_is_reachable_from_nav_dock(self) -> None:
        self.assertRegex(SCENE, r'<Label id="navLabel1" .*text="Search"')
        self.assertRegex(SCENE, r'<Group id="searchGroup"')
        self.assertRegex(SCENE, r'<MarkupGrid id="searchGrid"')
        self.assertIn(
            'return ["downloads", "search", "home", "series", "movie", "site", "artist", "playlist"]',
            MAIN,
        )
        self.assertIn("sub openSearchDialog()", MAIN)
        self.assertIn('dialog.ObserveField("buttonSelected", "onSearchDialogButton")', MAIN)
        self.assertIn("sub performSearch(query as String)", MAIN)
        self.assertIn("sub acceptSearchResults(data as Object)", MAIN)

    def test_search_detail_back_returns_to_the_search_results_not_home(self) -> None:
        self.assertIn('m.detailOrigin = "search"', MAIN)
        self.assertIn(
            'else if m.detailOrigin = "search"\n            showOnly("search")',
            MAIN,
        )

    def test_search_results_back_returns_to_home(self) -> None:
        self.assertIn('else if state = "search" and key = "back"', MAIN)

    def test_playlists_screen_is_reachable_from_nav_dock(self) -> None:
        # Phase 10: playlists directory + detail, reached from the nav
        # dock's playlists group (see MainScene.xml's navDock comment). Uses
        # GET /api/v1/playlists (no offset/limit -- confirmed against
        # tv-web's generated schema.ts, list_playlists_handler takes no
        # query params) rather than a paginated catalog-style fetch.
        self.assertRegex(SCENE, r'<Label id="navLabel7" .*text="Playlists"')
        self.assertRegex(SCENE, r'<Group id="playlistsGroup"')
        self.assertRegex(SCENE, r'<MarkupGrid id="playlistsGrid"')
        self.assertRegex(SCENE, r'<TvStage id="playlistDetailStage"')
        self.assertRegex(SCENE, r'<MarkupGrid id="playlistItemsGrid"')
        self.assertIn(
            'return ["Downloads", "Search", "Home", "Series", "Movies", "Sites", "Music", "Playlists"]',
            MAIN,
        )
        self.assertIn("sub openPlaylists()", MAIN)
        self.assertIn('"playlists", "GET", "/api/v1/playlists"', MAIN)
        self.assertIn("sub acceptPlaylists(data as Object)", MAIN)

    def test_downloads_screen_is_reachable_from_nav_dock(self) -> None:
        # Phase 11: Downloads is a deliberately honest empty-state stub, NOT
        # a functional download manager -- this channel has no local file
        # storage / download-queue infrastructure at all (see the
        # downloadsGroup XML comment). Pinned here so a future pass doesn't
        # quietly turn this into (or claim it is) a working download engine.
        self.assertRegex(SCENE, r'<Label id="navLabel0" .*text="Downloads"')
        self.assertRegex(SCENE, r'<Group id="downloadsGroup"')
        self.assertIn('kind = "downloads"', MAIN)
        self.assertIn("sub openDownloads()", MAIN)
        self.assertIn('showOnly("downloads")', MAIN)
        self.assertIn('else if state = "downloads" and key = "back"', MAIN)
        # No API request backs this screen -- there is nothing to fetch.
        downloads_sub = re.search(
            r"sub openDownloads\(\).*?end sub", MAIN, flags=re.DOTALL
        )
        self.assertIsNotNone(downloads_sub)
        assert downloads_sub is not None
        self.assertNotIn("sendApi", downloads_sub.group(0))
        self.assertNotIn("startApiRequest", downloads_sub.group(0))
        # Copy must not claim Roku supports downloads.
        self.assertIn("aren’t available on this device yet", SCENE)

    def test_playlist_items_are_hydrated_one_at_a_time_like_continue_watching(
        self,
    ) -> None:
        # PlaylistItemResponse only carries work_id/track_id, no embedded
        # Work (confirmed against tv-web's generated schema.ts), and there
        # is no batch-by-ids catalog endpoint, so each item's full Work is
        # fetched individually through the existing detail endpoint, chained
        # exactly like Continue Watching's processNextHomeWork above.
        self.assertIn(
            '"playlistItems", "GET", "/api/v1/playlists/" + UrlEncode(playlist.id) + "/items"',
            MAIN,
        )
        self.assertIn("sub processNextPlaylistItem()", MAIN)
        self.assertIn(
            '"playlistItemWork", "GET", "/api/v1/catalog/" + UrlEncode(item.work_id)',
            MAIN,
        )
        self.assertIn("sub acceptPlaylistItemWork(data as Object)", MAIN)
        self.assertIn('if action = "playlistItemWork"', MAIN)

    def test_playlist_item_selection_reuses_open_work_detail_with_its_own_origin(
        self,
    ) -> None:
        self.assertIn("sub onPlaylistItemSelected(event as Object)", MAIN)
        self.assertIn(
            'openWorkDetail(m.playlistItems[index], "playlists")', MAIN
        )
        self.assertIn('m.detailOrigin = "playlists"', MAIN)
        self.assertIn(
            'else if m.detailOrigin = "playlists"\n            showOnly("playlists")',
            MAIN,
        )

    def test_playlist_detail_back_returns_to_the_directory_not_home(self) -> None:
        # One screenState ("playlists") covers both the directory grid and
        # an opened playlist's items, toggled via m.playlistDetailOpen --
        # Back must pop the detail sub-view back to the directory first, and
        # only fall through to Home from the directory itself.
        self.assertIn('else if state = "playlists" and key = "back"', MAIN)
        self.assertIn("if m.playlistDetailOpen", MAIN)
        self.assertIn("m.playlistsGrid.SetFocus(true)", MAIN)

    def test_detail_screen_branches_movie_vs_series_shaped_children(self) -> None:
        self.assertRegex(SCENE, r'<RowList id="detailEpisodes"')
        self.assertIn("sub showMovieDetailActions(detail as Object)", MAIN)
        self.assertIn("sub showSeriesDetailActions()", MAIN)
        self.assertIn('isSeriesShaped = work.kind = "series" or work.kind = "site"', MAIN)

    def test_detail_screen_is_composed_on_the_shared_tv_stage(self) -> None:
        # Phase 9: WorkDetail visually migrates onto the same TvStage
        # composition Home already uses (see homeGroup's own
        # test_home_screen_is_composed_on_the_shared_tv_stage above) instead
        # of the original plain poster-thumbnail-plus-text layout. The old
        # dedicated detailPoster/detailTitle/detailMeta nodes are gone in
        # favour of detailStage's stageTitle/stageKicker/stageMeta/keyArtUri
        # fields, set the same way Home's updateHeroFromWork sets them.
        self.assertRegex(SCENE, r'<Group id="detailGroup"')
        self.assertRegex(SCENE, r'<TvStage id="detailStage"')
        self.assertNotRegex(SCENE, r'<Poster id="detailPoster"')
        self.assertNotIn('id="detailTitle"', SCENE)
        self.assertNotIn('id="detailMeta"', SCENE)
        self.assertIn('m.detailStage = m.top.findNode("detailStage")', MAIN)
        self.assertIn("m.detailContent = m.detailStage.contentTarget", MAIN)
        self.assertIn("m.detailStage.stageTitle = work.title", MAIN)
        self.assertIn("m.detailStage.stageKicker = UCase(work.kind)", MAIN)
        self.assertIn("m.detailStage.keyArtUri = heroArtworkUrl(work)", MAIN)

    def test_detail_entrance_animation_replays_on_every_detail_visit(self) -> None:
        # Unlike Home's one-shot m.homeShown flag, detail re-enters fresh
        # with a different work every time (mirroring tv-web's own
        # per-selection DetailPage remount), so playEntrance is expected to
        # run unconditionally inside showDetail() rather than being gated
        # behind a "shown once" flag.
        self.assertIn('m.detailStage.callFunc("playEntrance")', MAIN)

    def test_playback_uses_a_custom_control_bar_not_native_osd(self) -> None:
        # Regression guard for the phase-5 decision to turn OFF Roku's
        # built-in trick-play OSD (Video enableUI) in favour of a hand-drawn
        # overlay matching tv-web's custom transport bar. Pinned so a future
        # pass doesn't "fix" enableUI back to true without realising this was
        # deliberate -- see MainScene.xml's playerControls Group comment.
        self.assertIn('<Video id="video" visible="false" width="1920" height="1080" enableUI="false" />', SCENE)
        self.assertRegex(SCENE, r'<Group id="playerControls"')
        self.assertRegex(SCENE, r'<Rectangle id="playerProgressFill"')
        self.assertIn("sub togglePlayPause()", MAIN)
        self.assertIn("sub seekPlayback(deltaSeconds as Integer)", MAIN)
        self.assertIn("function formatPlaybackTime(totalSeconds as Dynamic) as String", MAIN)
        self.assertIn("sub resetPlayerAutoHide()", MAIN)
        self.assertIn("sub hidePlayerControls()", MAIN)

    def test_playback_previous_next_are_honestly_wired_or_dimmed(self) -> None:
        # Previous/Next only make sense for series episode playback; this
        # pins that they are genuinely wired to the in-memory episode tree
        # (not a silent no-op button) and that the no-adjacent-episode case
        # is visibly dimmed rather than pretending to work.
        self.assertIn("sub playAdjacentEpisode(delta as Integer)", MAIN)
        self.assertIn("m.playbackEpisodeList = flattenEpisodes(m.detailSeasons)", MAIN)
        self.assertIn("sub renderPlayerEpisodeNav()", MAIN)
        self.assertIn("m.playbackEpisodeList = []", MAIN)

    def test_settings_screen_is_reachable_from_profile_actions(self) -> None:
        # Phase 7 v1 settings stub: reached from profilesGroup's
        # profileActions LabelList, Back returns to the profiles state it
        # was entered from (settings has no other entry point).
        self.assertRegex(SCENE, r'<Group id="settingsGroup"')
        self.assertRegex(SCENE, r'<LabelList id="settingsSectionList"')
        self.assertRegex(SCENE, r'<LabelList id="settingsActionList"')
        self.assertIn(
            'setListContent(m.profileActions, ["Link another profile", "Change server", "Sign out", "Settings"])',
            MAIN,
        )
        self.assertIn("sub openSettings()", MAIN)
        self.assertIn('else if state = "settings" and key = "back"', MAIN)
        self.assertIn('showOnly("profiles")', MAIN)

    def test_settings_server_section_reuses_the_existing_server_dialog(self) -> None:
        # "Add another server" in Settings must reuse openServerDialog
        # rather than a second, near-duplicate manual-entry UI.
        self.assertIn("sub renderServerSettings()", MAIN)
        self.assertIn('if index = 0 then openServerDialog()', MAIN)

    def test_settings_player_section_uses_the_real_preferences_endpoint(self) -> None:
        self.assertIn("sub loadPlayerPreferences()", MAIN)
        self.assertIn("sub saveAudioLanguage(code as String)", MAIN)
        self.assertIn(
            '"playerPrefsSave", "PATCH", "/api/v1/users/me/player-preferences"',
            MAIN,
        )

    def test_episode_selection_drives_playback_by_its_own_media_file_id(self) -> None:
        # Regression guard for the phase-4 upgrade away from
        # findFirstMediaFileId's old "grab the first playable file found
        # anywhere in the response" behaviour: an episode row/column selection
        # must resolve *that* episode's own media_file_id, and both the movie
        # Play button and an episode selection must funnel into the same
        # single requestPlayback(mediaFileId) entry point rather than each
        # reinventing the playback-negotiation request.
        self.assertIn("sub onDetailEpisodeSelected(event as Object)", MAIN)
        self.assertIn("epDetail = episodes[colIndex]", MAIN)
        self.assertIn("mediaFileId = epDetail.media_file_id", MAIN)
        self.assertIn("sub requestPlayback(mediaFileId as String)", MAIN)
        self.assertIn("requestPlayback(m.currentMediaFileId)", MAIN)
        self.assertIn("requestPlayback(mediaFileId)", MAIN)

    def test_detail_screen_handles_artist_shaped_children(self) -> None:
        # Phase 8: artist works (WorkChildrenSchema's `{ Artist:
        # AlbumDetailSchema[] }` variant) reuse the exact same
        # detailEpisodes RowList and onDetailEpisodeSelected/
        # flattenEpisodes/playAdjacentEpisode machinery phase 4 built for
        # series/site, generalized (not duplicated) via
        # renderGroupedDetailActions/buildEpisodeContent/groupLeaves and
        # m.detailGroupKind -- pinned here so a future pass doesn't
        # reintroduce a parallel "flattenTracks" style code path.
        self.assertIn('isArtistShaped = work.kind = "artist"', MAIN)
        self.assertIn("sub showArtistDetailActions()", MAIN)
        self.assertIn("function albumsFromDetail(detail as Object) as Object", MAIN)
        self.assertIn("children.Artist <> invalid", MAIN)
        self.assertIn("sub renderGroupedDetailActions(groups as Object, kind as String)", MAIN)
        self.assertIn("function groupLeaves(group as Object, kind as String) as Object", MAIN)
        self.assertIn("m.detailGroupKind", MAIN)
        # Same shared functions drive both kinds -- no duplicated
        # "artist" copy of onDetailEpisodeSelected/flattenEpisodes/
        # playAdjacentEpisode/requestPlayback.
        self.assertEqual(MAIN.count("sub onDetailEpisodeSelected(event as Object)"), 1)
        self.assertEqual(MAIN.count("function flattenEpisodes(seasons as Object) as Object"), 1)
        self.assertEqual(MAIN.count("sub playAdjacentEpisode(delta as Integer)"), 1)
        self.assertEqual(MAIN.count("sub requestPlayback(mediaFileId as String)"), 1)
>>>>>>> Stashed changes


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

    def test_pairing_screen_matches_the_real_device_login_visual_pass(self) -> None:
        # Visual-correction phase: pairingGroup was rebuilt to mirror
        # tv-web's real DeviceLogin page (logo lockup, kicker, left-anchored
        # column, decorative glow) -- these checks pin the structural
        # pieces of that pass so a future edit doesn't silently drop them,
        # without over-constraining exact pixel values.
        self.assertIn('id="pairingGlow1"', SCENE)
        self.assertIn('id="pairingLogoIcon"', SCENE)
        self.assertIn('uri="pkg:/images/pairing-logo.png"', SCENE)
        self.assertIn('text="SIGN IN ON ANOTHER DEVICE"', SCENE)
        self.assertIn('id="pairingQrBg"', SCENE)
        self.assertIn('id="pairingManualHintBg"', SCENE)
        # The functional ids the .brs logic drives must still all exist.
        for pairing_id in (
            "pairingQr",
            "pairingInstruction",
            "pairingCode",
            "pairingStatus",
            "pairingManualHint",
        ):
            with self.subTest(pairing_id=pairing_id):
                self.assertIn(f'id="{pairing_id}"', SCENE)

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
<<<<<<< Updated upstream
            and path.suffix not in binary_suffixes
            and path.suffix != ".pyc"
=======
            and path.suffix not in {".pyc", ".png", ".jpg", ".jpeg"}
>>>>>>> Stashed changes
        )
        self.assertNotRegex(all_text, r"https?://(?:192\.168|10\.|172\.(?:1[6-9]|2\d|3[01]))")
        self.assertNotRegex(all_text, r"Bearer ey[A-Za-z0-9_-]{10,}")


if __name__ == "__main__":
    unittest.main()
