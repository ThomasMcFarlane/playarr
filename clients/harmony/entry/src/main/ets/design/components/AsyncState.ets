/**
 * One shared loading / empty / error+retry surface, switched by the
 * `kind` discriminant below, so every catalogue/detail screen renders
 * exactly one of these three states through a single component instead of
 * each screen re-implementing its own loader/error UI.
 *
 * - `Loading` (brief 5.7): a 20x20 spinner, a 2px ring at `inkMuted @ 24%`
 *   with its top edge overridden to the Playarr brand pink (`BRAND_PINK`,
 *   `core/Tokens.ts`), 50% radius (`Radii.circleFull`), 720ms linear
 *   infinite rotation.
 * - `Empty`: a single centred message -- no icon in the source design.
 * - `Error`: a message plus a retry button that calls back into `retry`.
 *   The button applies `FOCUS_LIFT.button` on focus, following
 *   `design/components/FocusLift.ets`'s documented pattern. This
 *   component is never rail-scoped, so it passes `DEFAULT_ACTIVE_RAIL_FACTOR`.
 *
 * The 20x20 size and 2px ring width are brief-5.7 literals with no
 * matching field in `core/Tokens.ts` (there is no icon-size or
 * border-width table) -- named constants below rather than inline magic
 * numbers, same documented exception as `design/Motion.ets`'s
 * `SPINNER_ROTATION_MS`.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { INTERACTION_CURVE, INTERACTION_CARD_MS, SPINNER_ROTATION_MS } from '../Motion';
import { BRAND_PINK, Spacing, Radii } from '../../core/Tokens';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from './FocusLift';

/** brief 5.7: "20x20 ... 2px border". Not in core/Tokens.ts -- see header. */
const SPINNER_DIAMETER: number = 20;
const SPINNER_BORDER_WIDTH: number = 2;
/** brief 5.7: "inkMuted @ 24%". Overrides `inkMuted`'s own stored alpha. */
const SPINNER_RING_ALPHA: number = 0.24;

/** Which of the three states `AsyncState` should render. */
export enum AsyncStateKind {
  Loading,
  Empty,
  Error,
}

@Component
export struct AsyncState {
  /** The discriminant switching between the three rendered states. */
  @Prop kind: AsyncStateKind = AsyncStateKind.Loading;
  /** The empty-state or error-state message. Unused while `Loading`. */
  @Prop message: string = '';
  /** The retry button's label. Unused outside `Error`. */
  @Prop retryLabel: string = 'Retry';
  /** Called when the retry button is activated. Plain (non-reactive)
   * callback field -- functions are not observable state. */
  retry: () => void = () => {};

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private spinnerAngle: number = 0;
  @State private retryFocusPercent: number = 0;

  aboutToAppear(): void {
    if (this.kind === AsyncStateKind.Loading) {
      this.getUIContext().animateTo(
        { duration: SPINNER_ROTATION_MS, curve: Curve.Linear, iterations: -1 },
        () => {
          this.spinnerAngle = 360;
        }
      );
    }
  }

  private setRetryFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.retryFocusPercent = focused ? 1 : 0;
    });
  }

  build() {
    Column({ space: Spacing.md }) {
      if (this.kind === AsyncStateKind.Loading) {
        Column()
          .width(SPINNER_DIAMETER)
          .height(SPINNER_DIAMETER)
          .border({
            width: SPINNER_BORDER_WIDTH,
            radius: Radii.circleFull,
            color: {
              top: toResourceColor(BRAND_PINK),
              left: toResourceColorWithAlpha(activeColors().inkMuted, SPINNER_RING_ALPHA),
              right: toResourceColorWithAlpha(activeColors().inkMuted, SPINNER_RING_ALPHA),
              bottom: toResourceColorWithAlpha(activeColors().inkMuted, SPINNER_RING_ALPHA),
            },
          })
          .rotate({ x: 0, y: 0, z: 1, angle: (this.spinnerAngle) })
      } else if (this.kind === AsyncStateKind.Empty) {
        Text(this.message)
          .fontSize(15)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)
      } else {
        Text(this.message)
          .fontSize(15)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)

        Button(this.retryLabel)
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().onAccent))
          .backgroundColor(toResourceColor(activeColors().accent))
          .borderRadius(Radii.btn)
          .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
          .focusable(true)
          .onFocus(() => {
            this.setRetryFocused(true);
          })
          .onBlur(() => {
            this.setRetryFocused(false);
          })
          .scale({
            x: 1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(this.retryFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR),
            y: 1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(this.retryFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR),
          })
          .onClick(() => {
            this.retry();
          })
      }
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }
}
