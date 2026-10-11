/**
 * Root page for Playarr's HarmonyOS NEXT client (brief sections 2.5, 3.2
 * and 9 "Slice 5" acceptance).
 *
 * This is the single page loaded by `entryability/EntryAbility.ets`, the
 * sole entry registered in both `profile/main_pages.json` and
 * `profile/router_map.json` (as `IndexBuilder`, below), and the ONE
 * `Navigation` host for the whole app: it calls `navigation/NavStack.ets`'s
 * `installNavStack()` once, at construction, to obtain the shared
 * `NavPathStack` and hands it straight to its own `Navigation(...)`
 * component. Every other page pushes/replaces/pops through that same
 * shared stack via `getNavStack()`, never a second, disconnected one.
 *
 * `aboutToAppear()` runs the boot state machine exactly once, per brief 9's
 * "Slice 5" acceptance:
 *
 * 1. No server configured (`AppContainer#getServerDirectory().
 *    getActiveBaseUrl()` is `null`) -> push `ROUTES.ServerSetup`.
 * 2. A server exists -> probe it with `GET /api/system/version` (this
 *    file's only network call, via `data/SystemRepository.ets`, never
 *    `net/`/`auth/` directly, per this project's `pages/` layering rule).
 *    On failure, advance to the next known address in `ServerDirectory`
 *    and probe again, until either one succeeds or every known address has
 *    been tried once. If none answers, stay on the address that was active
 *    and carry on, as web does (`ApiClientProvider`): a network blip at
 *    start must not strand the TV on an error page; a request that still
 *    fails surfaces through that page's own error handling and retry.
 * 3. Once connected: no access token (`AppContainer#getSessionManager().
 *    getAccessToken()` is `null`) -> push `ROUTES.Pairing`. A token is
 *    present -> push `ROUTES.Profiles` directly, proceeding optimistically
 *    rather than forcing an explicit refresh here: `net/PlayarrClient.
 *    ets`'s own reactive 401-refresh-and-replay handling (every `data/`
 *    repository call goes through it) already catches a stale token the
 *    moment `Profiles` makes its first request, so a second, redundant
 *    refresh call on this page would only add boot latency for no benefit.
 *    `Profiles` is not this page's own concern beyond that push; a later
 *    slice's `Home` page is the eventual destination from `Profiles`, not
 *    from here.
 *
 * On the TV profile (`device/DeviceProfileService.ets`'s published
 * `DeviceProfile.inputMode === 'dpad'`), `getUIContext().
 * getFocusController().activate(true, false)` runs in `aboutToAppear()`,
 * before the first frame, so the focus ring is visible from the very first
 * D-pad press (brief section 6.3), matching the same
 * pattern `pages/Pairing.ets` already establishes.
 */


import { getServerDirectory, getSessionManager, savedThemeChoice } from '../AppContainer';
import type { DeviceProfile } from '../core/DeviceProfile';
import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';

import { getSystemVersion } from '../data/SystemRepository';

import { Spacing } from '../core/Tokens';
import { activeColors, setThemeModeSetting, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { ROUTES } from '../navigation/Routes';
import { installNavStack, pushRoute } from '../navigation/NavStack';

import { logWarn } from '../util/Log';

const LOG_TAG: string = 'Index';

@Entry
@Component
struct Index {
  // Tracked purely to force a re-render on theme change; see
  // design/Theme.ets's own header comment for this exact pattern.
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  // The ONE shared NavPathStack for the whole app, obtained here, at
  // construction, exactly once, see navigation/NavStack.ets's own header
  // comment for why this must be the only place `installNavStack()` is
  // ever called.
  private navPathStack: NavPathStack = installNavStack();


  aboutToAppear(): void {
    savedThemeChoice().then((mode: ThemeModeSetting) => {
      setThemeModeSetting(mode);
    });
    const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
    if (profile !== undefined && profile.inputMode === 'dpad') {
      // brief section 6.3: the focus ring is hidden by default, and the
      // first D-pad press appears to do nothing until this runs. Must
      // happen before the first frame, so it belongs here rather than in
      // any click/focus handler.
      this.getUIContext().getFocusController().activate(true, false);
    }
    this.runBoot();
  }

  /** Step 1, and the entry point into step 2, see this file's header
   * comment for the full boot sequence. */
  private async runBoot(): Promise<void> {

    const directory = getServerDirectory();
    const activeBaseUrl = directory.getActiveBaseUrl();
    if (activeBaseUrl === null) {
      pushRoute(this.navPathStack, ROUTES.ServerSetup);
      return;
    }

    if (await this.probeConnectivity()) {
      this.continueAfterConnectivity();
    }
  }

  /**
   * Step 2: `GET /api/system/version` against the currently active server
   * address. On any failure (network or HTTP), advances `ServerDirectory`
   * to the next known address and probes again, until either a probe
   * succeeds (leaving that address selected) or every known address has
   * been tried exactly once (restores whichever address was active when
   * this call started). Returns `false` only when there is no address at
   * all (it has then routed to server setup).
   */
  private async probeConnectivity(): Promise<boolean> {
    const directory = getServerDirectory();
    const servers = directory.listServers();
    const startIndex = directory.getActiveIndex();

    if (servers.length === 0) {
      // Defensive only, runBoot already checked getActiveBaseUrl() !==
      // null, which implies at least one address exists.
      pushRoute(this.navPathStack, ROUTES.ServerSetup);
      return false;
    }

    let index = startIndex;
    let attempts = 0;
    while (attempts < servers.length) {
      if (index !== directory.getActiveIndex()) {
        await directory.selectServer(index);
      }
      const result = await getSystemVersion();
      if (result.kind === 'ok') {
        return true;
      }
      logWarn(LOG_TAG, 'connectivity probe failed against ' + servers[index] + ', kind=' + result.kind);
      attempts = attempts + 1;
      index = (index + 1) % servers.length;
    }

    if (directory.getActiveIndex() !== startIndex) {
      await directory.selectServer(startIndex);
    }
    return true;
  }

  /** Step 3, see this file's header comment for why this pushes
   * `Profiles` directly on a present token rather than refreshing first. */
  private continueAfterConnectivity(): void {
    const accessToken = getSessionManager().getAccessToken();
    if (accessToken === null) {
      pushRoute(this.navPathStack, ROUTES.Pairing);
      return;
    }
    pushRoute(this.navPathStack, ROUTES.Profiles);
  }

  build() {
    Navigation(this.navPathStack) {
      Column({ space: Spacing.lg }) {
        AsyncState({ kind: AsyncStateKind.Loading })
      }
      .width('100%')
      .height('100%')
      .padding(Spacing.xl)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    // Stack, never Auto: at TV and tablet widths Auto splits off an empty 240 vp nav bar beside every page.
    .mode(NavigationMode.Stack)
    .hideTitleBar(true)
  }
}

/**
 * Registered in `profile/main_pages.json` (this page's own standalone
 * entry) and in `profile/router_map.json` as the `Index` route's
 * `buildFunction`, so the system router table can construct this page by
 * name without a direct static import.
 */
@Builder
export function IndexBuilder(): void {
  Index()
}
