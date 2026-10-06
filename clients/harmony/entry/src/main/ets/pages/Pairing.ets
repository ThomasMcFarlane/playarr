/**
 * Device-link ("pairing") screen: RFC 8628 device authorisation (brief
 * section 4.3, and section 9 "Slice 5" acceptance). Drives
 * `auth/DeviceAuthService.ets`'s two-step API end to end: one
 * `requestDeviceCode()` call, then `beginPolling(...)` on the schedule
 * `core/DeviceCodePolicy.ts` computes, until a terminal outcome arrives.
 *
 * `pages/*.ets` may never import `net/` or `auth/` directly (brief section
 * 3.1's layer rule, enforced by `checks/arkts.mjs`'s Check 4), so this file
 * never imports `auth/DeviceAuthService.ets` itself -- it calls
 * `AppContainer#getDeviceAuthService()` instead (see that file's own header
 * comment for why that getter exists). Every value this page reads back off
 * `requestDeviceCode()`/`beginPolling()` (the `ApiResult` success/failure
 * discriminant, the error envelope's own `kind`, the poll outcome's own
 * `kind`) is narrowed purely by comparing `.kind` against a string literal,
 * never by importing `net/ApiResult.ets`'s or `auth/DeviceAuthService.ets`'s
 * own type names -- TypeScript infers every one of those shapes from
 * `DeviceAuthService`'s declared return types without this file ever having
 * to spell them.
 *
 * Four visible states (brief 9's own vocabulary): "checking" (the initial
 * `requestDeviceCode()` call is in flight), "waiting" (a code was issued and
 * `beginPolling()` is running), "expired" (the code timed out; the user must
 * ask for a new one) and "error" (a network failure, a server error, or the
 * approving device declined the request). `design/components/AsyncState.ets`
 * renders "checking" and "error"/"expired" (its `Loading` and `Error` kinds
 * respectively); "waiting" is this page's own layout, since it has real
 * content to show (the code, the address, the completion URL) alongside a
 * small `AsyncState` `Loading` spinner, not a single full-screen state.
 *
 * QR CODE GAP: the implementation brief asks for a QR of
 * `verification_uri_complete`, generated via `@kit.ScanKit`. No QR
 * *generation* surface for `@kit.ScanKit` (or any other kit) appears
 * anywhere in this project's documented SDK reference, only a QR *scanning*
 * one, which is the wrong direction for this screen. Rather than guess at an
 * undocumented API with no compiler available to check it against, this
 * page renders `verification_uri_complete` as large, wrappable text with an
 * explicit "open this on another device" instruction instead -- functionally
 * complete (a client that ignores `servers=`, or in this case ignores the QR
 * entirely, still works per brief section 4.3), just less convenient than a
 * scan. A later slice with a confirmed `@kit.ScanKit` QR-generation API
 * should replace this block.
 *
 * On the TV profile (`device/DeviceProfileService.ets`'s published
 * `DeviceProfile.inputMode === 'dpad'`), `getUIContext().getFocusController()
 * .activate(true, false)` runs in `aboutToAppear()`, before the first frame,
 * per brief section 6.3 -- otherwise the focus ring stays hidden and the
 * first D-pad press appears to do nothing.
 *
 * On success, this page calls `NavStack#replaceRoute` (never `pushRoute`) to
 * land on `Profiles`, so Back from `Profiles` does not return to a
 * now-consumed pairing code.
 */

import { getDeviceAuthService } from '../AppContainer';
import { Spacing, Radii } from '../core/Tokens';
import type { DeviceCodeResponse } from '../core/Types/Auth';
import type { DeviceProfile } from '../core/DeviceProfile';
import { DEVICE_PROFILE_STORAGE_KEY } from '../device/DeviceProfileService';
import { activeColors, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { ROUTES } from '../navigation/Routes';
import { getNavStack, replaceRoute } from '../navigation/NavStack';
import { logWarn } from '../util/Log';

/** brief 9 ("Slice 5" acceptance): "renders the user_code at display size
 * with wide letter-spacing". Not a `core/Tokens.ts` field -- that table has
 * no typography scale at all (see `design/components/FeatureCopy.ets`'s own
 * header comment on that) -- so these are named constants here, the same
 * documented exception `design/components/AsyncState.ets`'s `SPINNER_*`
 * constants and `design/Motion.ets`'s `SPINNER_ROTATION_MS` both take. The
 * brief gives no exact figures for this screen, so the values below are
 * this file's own reasonable choice for "display size" / "wide". */
const USER_CODE_FONT_SIZE: number = 56;
const USER_CODE_LETTER_SPACING: number = 8;

/** The four states this screen's own acceptance criteria name. "success" is
 * deliberately not a rendered state -- `handleOutcome` below navigates away
 * the same tick it is reached, so there is nothing meaningful to paint. */
type PairingPhase = 'checking' | 'waiting' | 'expired' | 'error';

@Component
struct Pairing {
  // Tracked purely to force a re-render on theme change; see
  // design/Theme.ets's own header comment for this exact pattern.
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private phase: PairingPhase = 'checking';
  @State private deviceCode: DeviceCodeResponse | null = null;
  @State private errorMessage: string = '';

  // Plain (non-reactive) field: a cancel callback for whichever poll loop is
  // currently in flight, or null while none is. Deliberately typed as a
  // closure rather than the real `DeviceAuthHandle` interface `beginPolling`
  // returns, so this file never has to name (and therefore never has to
  // import) a type declared in `auth/DeviceAuthService.ets`.
  private cancelPolling: (() => void) | null = null;

  aboutToAppear(): void {
    const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
    if (profile !== undefined && profile.inputMode === 'dpad') {
      // brief section 6.3: the focus ring is hidden by default, and the
      // first D-pad press appears to do nothing until this runs. Must
      // happen before the first frame, so it belongs here rather than in
      // any click/focus handler.
      this.getUIContext().getFocusController().activate(true, false);
    }
    this.startPairing();
  }

  aboutToDisappear(): void {
    this.cancelActivePoll();
  }

  private cancelActivePoll(): void {
    if (this.cancelPolling !== null) {
      this.cancelPolling();
      this.cancelPolling = null;
    }
  }

  private restart(): void {
    this.startPairing();
  }

  private async startPairing(): Promise<void> {
    this.cancelActivePoll();
    this.phase = 'checking';
    this.errorMessage = '';
    this.deviceCode = null;

    const service = getDeviceAuthService();
    const result = await service.requestDeviceCode();

    if (result.kind === 'network_failure') {
      this.phase = 'error';
      this.errorMessage = 'Could not reach the server. Check your connection and try again.';
      return;
    }

    if (result.kind === 'http_failure') {
      this.phase = 'error';
      const envelope = result.envelope;
      if (envelope.kind === 'general') {
        this.errorMessage = envelope.message;
      } else if (envelope.kind === 'upgrade_required') {
        this.errorMessage = 'This app is out of date. Update Playarr and try again.';
      } else {
        this.errorMessage = 'Something went wrong. Try again.';
      }
      return;
    }

    // result.kind === 'ok'
    const response = result.value;
    this.deviceCode = response;
    this.phase = 'waiting';

    const handle = service.beginPolling(response.device_code, response.interval, response.expires_in, (outcome): void => {
      if (outcome.kind === 'success') {
        this.cancelPolling = null;
        replaceRoute(getNavStack(), ROUTES.Profiles);
        return;
      }
      if (outcome.kind === 'cancelled') {
        return;
      }
      this.cancelPolling = null;
      if (outcome.kind === 'expired') {
        this.phase = 'expired';
        this.errorMessage = 'This code expired. Request a new one.';
        return;
      }
      if (outcome.kind === 'access_denied') {
        this.phase = 'error';
        this.errorMessage = 'Pairing was declined on the other device.';
        return;
      }
      // outcome.kind === 'request_failed'
      this.phase = 'error';
      this.errorMessage = outcome.message;
      logWarn('Pairing', 'device pairing poll failed: ' + outcome.message);
    });
    this.cancelPolling = (): void => {
      handle.cancel();
    };
  }

  build() {
    NavDestination() {
      Column({ space: Spacing.xl }) {
        Text($r('app.string.pairing_title'))
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .textAlign(TextAlign.Center)

        if (this.phase === 'checking') {
          AsyncState({ kind: AsyncStateKind.Loading })
        } else if (this.phase === 'expired' || this.phase === 'error') {
          AsyncState({
            kind: AsyncStateKind.Error,
            message: this.errorMessage,
            retryLabel: 'Try again',
            retry: (): void => {
              this.restart();
            },
          })
        } else if (this.deviceCode !== null) {
          Column({ space: Spacing.lg }) {
            Text(this.deviceCode.user_code)
              .fontSize(USER_CODE_FONT_SIZE)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(USER_CODE_LETTER_SPACING)
              .fontColor(toResourceColor(activeColors().ink))
              .textAlign(TextAlign.Center)

            Text(this.deviceCode.verification_uri)
              .fontSize(16)
              .fontColor(toResourceColor(activeColors().inkSoft))
              .textAlign(TextAlign.Center)

            // See the file header's "QR CODE GAP" note: no confirmed
            // @kit.ScanKit QR-generation surface exists to render here, so
            // the full completion URL is shown as text with an explicit
            // instruction instead.
            Column({ space: Spacing.sm }) {
              Text($r('app.string.pairing_open_instruction'))
                .fontSize(14)
                .fontColor(toResourceColor(activeColors().inkSoft))
                .textAlign(TextAlign.Center)

              Text(this.deviceCode.verification_uri_complete)
                .fontSize(14)
                .fontColor(toResourceColor(activeColors().ink))
                .textAlign(TextAlign.Center)
                .maxLines(3)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .width('100%')
            .padding(Spacing.md)
            .backgroundColor(toResourceColor(activeColors().surface))
            .border({ width: 1, color: toResourceColor(activeColors().line), radius: Radii.railPanel })

            Row({ space: Spacing.sm }) {
              AsyncState({ kind: AsyncStateKind.Loading })
              Text($r('app.string.pairing_waiting'))
                .fontSize(14)
                .fontColor(toResourceColor(activeColors().inkMuted))
            }
          }
          .width('100%')
        }
      }
      .width('100%')
      .height('100%')
      .padding(Spacing.xl)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/**
 * Registered in `profile/router_map.json` as the `Pairing` route's
 * `buildFunction`, matching `pages/Index.ets#IndexBuilder`'s own
 * zero-parameter convention for a page with no navigation params (see
 * `navigation/Routes.ets`: `Pairing` carries no param interface).
 */
@Builder
export function PairingBuilder(): void {
  Pairing()
}
