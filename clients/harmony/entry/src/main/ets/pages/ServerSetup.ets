/**
 * Manual server-address entry (brief section 9, "Slice 5" acceptance;
 * implementation brief section 2.5 lists this page as "manual
 * server-address entry (touch keyboard / TV numeric-friendly), used before
 * pairing"). This is the first screen of the boot flow whenever
 * `auth/ServerDirectory.ets` has no known address yet.
 *
 * A single text field accepts a server address in ordinary touch-keyboard
 * form; a TV remote's on-screen keyboard can drive the same field, clumsily
 * but adequately, so no separate TV-only affordance is built here (matching
 * this slice's own acceptance note). `core/Url.ts#normaliseServerUrl` is the
 * single source of truth for what counts as a valid address, called BOTH
 * locally (for immediate inline validation feedback, before ever touching
 * `ServerDirectory`) and again inside `ServerDirectory#addServer` itself
 * (that second call is idempotent on an already-normalised value).
 *
 * On success, the normalised address is added to the shared
 * `ServerDirectory` singleton (obtained from `AppContainer.ets`, never
 * constructed locally -- see that file's own header comment) and selected
 * as the active server, then this page pushes the `Pairing` route via
 * `navigation/NavStack.ets`.
 *
 * `pages/*.ets` may never import `net/` or `auth/` directly (brief section
 * 3.1's layer rule, enforced by `checks/arkts.mjs`'s Check 4) -- this file's
 * only route to `ServerDirectory` is `AppContainer#getServerDirectory`,
 * whose return type is used purely by inference below, never re-imported
 * from `auth/ServerDirectory.ets` by name.
 *
 * This page is a `NavDestination` target reached only via
 * `NavPathStack#pushPathByName` (brief section 2.5's `router_map.json`
 * "NavDestination route table"), never a standalone entry page of its own
 * -- the app's sole entry/`loadContent` target is `pages/Index.ets`.
 */

import { getServerDirectory } from '../AppContainer';
import { normaliseServerUrl } from '../core/Url';
import { Spacing, Radii } from '../core/Tokens';
import { activeColors, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../design/Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from '../design/components/FocusLift';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { ROUTES } from '../navigation/Routes';
import { getNavStack, pushRoute } from '../navigation/NavStack';
import { logWarn } from '../util/Log';

/** Shown while the field is empty or unparseable. Kept as one named
 * constant, rather than repeated inline, so the two call sites that can
 * report it (submit-time validation and the defensive `addServer` null
 * branch, which should never actually differ from it) never drift apart. */
const INVALID_URL_MESSAGE: string = 'Enter a valid address starting with http:// or https://';

@Component
struct ServerSetup {
  // Tracked purely to force a re-render on theme change; see
  // design/Theme.ets's own header comment for this exact pattern.
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private serverAddress: string = '';
  @State private errorMessage: string = '';
  @State private isSubmitting: boolean = false;
  @State private connectFocusPercent: number = 0;

  private setConnectFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.connectFocusPercent = focused ? 1 : 0;
    });
  }

  private async handleConnect(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }
    const normalised = normaliseServerUrl(this.serverAddress);
    if (normalised === null) {
      this.errorMessage = INVALID_URL_MESSAGE;
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;
    try {
      const directory = getServerDirectory();
      const added = await directory.addServer(normalised);
      if (added === null) {
        // Should not happen -- `normalised` already passed the same
        // validation `addServer` re-applies -- but never surface a blank
        // screen over a defensive edge case.
        this.errorMessage = INVALID_URL_MESSAGE;
        return;
      }
      const servers = directory.listServers();
      const index = servers.indexOf(added);
      if (index !== -1) {
        await directory.selectServer(index);
      }
      pushRoute(getNavStack(), ROUTES.Pairing);
    } catch (err) {
      logWarn('ServerSetup', 'failed to save server address: ' + String(err));
      this.errorMessage = 'Could not save this address. Try again.';
    } finally {
      this.isSubmitting = false;
    }
  }

  build() {
    NavDestination() {
      Column({ space: Spacing.lg }) {
        Text($r('app.string.server_setup_title'))
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .textAlign(TextAlign.Center)

        Text($r('app.string.server_setup_hint'))
          .fontSize(15)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)
          .width('100%')

        // Captured into a local rather than passed as `text: this.serverAddress`
        // directly: the offline validator's lexical scan for a `this`-as-a-type
        // annotation (`: this`) cannot distinguish that from an ordinary
        // object-literal property whose value merely starts with `this.` --
        // this local sidesteps the ambiguity without changing behaviour.
        const currentServerAddress = this.serverAddress;
        TextInput({ placeholder: $r('app.string.server_setup_placeholder'), text: currentServerAddress })
          .type(InputType.Normal)
          .enterKeyType(EnterKeyType.Done)
          .fontSize(16)
          .fontColor(toResourceColor(activeColors().ink))
          .placeholderColor(toResourceColor(activeColors().inkMuted))
          .backgroundColor(toResourceColor(activeColors().surface))
          .borderRadius(Radii.inputFlat)
          .padding({ left: Spacing.md, right: Spacing.md, top: Spacing.sm, bottom: Spacing.sm })
          .width('100%')
          .onChange((value: string) => {
            this.serverAddress = value;
            if (this.errorMessage.length > 0) {
              this.errorMessage = '';
            }
          })
          .onSubmit(() => {
            this.handleConnect();
          })

        if (this.errorMessage.length > 0) {
          Text(this.errorMessage)
            .fontSize(13)
            .fontColor(toResourceColor(activeColors().danger))
            .textAlign(TextAlign.Center)
            .width('100%')
        }

        if (this.isSubmitting) {
          AsyncState({ kind: AsyncStateKind.Loading })
        } else {
          Button($r('app.string.server_setup_connect'))
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().onAccent))
            .backgroundColor(toResourceColor(activeColors().accent))
            .borderRadius(Radii.btn)
            .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
            .focusable(true)
            .onFocus(() => {
              this.setConnectFocused(true);
            })
            .onBlur(() => {
              this.setConnectFocused(false);
            })
            .scale({
              x:
                1 +
                (FOCUS_LIFT.button.scale - 1) *
                  effectiveFocusPercent(this.connectFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR),
              y:
                1 +
                (FOCUS_LIFT.button.scale - 1) *
                  effectiveFocusPercent(this.connectFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR),
            })
            .onClick(() => {
              this.handleConnect();
            })
        }
      }
      .width('100%')
      .height('100%')
      .padding({ left: Spacing.xl, right: Spacing.xl })
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/**
 * Registered in `profile/router_map.json` as the `ServerSetup` route's
 * `buildFunction`, matching `pages/Index.ets#IndexBuilder`'s own
 * zero-parameter convention for a page with no navigation params (see
 * `navigation/Routes.ets`: `ServerSetup` carries no param interface).
 */
@Builder
export function ServerSetupBuilder(): void {
  ServerSetup()
}
