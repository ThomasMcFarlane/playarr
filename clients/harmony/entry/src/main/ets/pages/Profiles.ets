/**
 * "Who's watching" profile picker (brief section 4.7 "Profiles", section
 * 5.11 "Avatar presets", and section 9 Slice 5's Profiles acceptance
 * criteria).
 *
 * Loads `data/ProfileRepository.ets#listProfiles()` (server route: GET
 * users/profiles, see that file's own header comment for the exact path)
 * and renders its `AvailableProfileResponse[]` as a grid of
 * `design/components/ProfileAvatar.ets` tiles, one per profile, using
 * `core/AvatarPreset.ts`'s `resolveAvatarPreset(userId)` to pick each
 * tile's deterministic gradient preset id (brief 5.11: this page resolves
 * the preset, `ProfileAvatar.ets` never hashes a user id itself). Under
 * `AuthMode::FullAccount` the repository degrades to a single-entry list
 * (brief 4.7); this page renders that as one tile rather than treating a
 * short list as an error or an empty state, per this slice's own
 * acceptance criteria.
 *
 * A tapped/selected profile whose `pin_locked` is true opens a numeric PIN
 * prompt that calls `data/ProfileRepository.ets#verifyPin(...)`; a profile
 * with `pin_locked === false` skips straight to selection. Per brief 4.7,
 * `verify-pin` only unlocks the target profile, it is not itself a profile
 * switch (a real switch needs "a separately stored per-profile session, or
 * a fresh pairing for that profile", left undocumented beyond that one
 * sentence) -- this page's job ends at replacing the nav stack with
 * `ROUTES.Home` once the PIN (if any) is verified, exactly per this
 * slice's acceptance criteria; it does not invent a profile-switch
 * endpoint the brief never specifies.
 *
 * Sign-out calls `getSessionManager().signOut()` (via `AppContainer.ets`,
 * the one approved way a page reaches session state, per this project's
 * layering rule that `pages/` may never import `auth/` or `net/` directly)
 * then replaces the nav stack with `ROUTES.Pairing` (a server address is
 * still configured; `SessionManager.ets#signOut`'s own contract preserves
 * the server address list) or, defensively, `ROUTES.ServerSetup` if
 * `ServerDirectory` reports no active server at all.
 *
 * There is no create-profile endpoint anywhere in brief section 4.7, or
 * anywhere else in the implementation brief. The "Add Profile" tile below
 * is therefore a disabled placeholder with no `onClick` handler, not a
 * call to an invented endpoint; profile management stays on Playarr
 * Server's own admin surface.
 *
 * Wired into `profile/router_map.json` as the `Profiles` route (name ->
 * `pages/Profiles.ets` -> `ProfilesBuilder`, below), matching
 * `navigation/Routes.ets`'s now-exported `ROUTE_PROFILES` -- the same
 * pattern `pages/ServerSetup.ets` and `pages/Pairing.ets` already
 * established for their own routes in this same slice.
 */

import type { AvailableProfileResponse } from '../core/Types/Profiles.ts';
import { resolveAvatarPreset } from '../core/AvatarPreset.ts';
import { BRAND_PINK, Spacing, Radii } from '../core/Tokens';

import { listProfiles, verifyPin } from '../data/ProfileRepository';

import { getSessionManager, getServerDirectory } from '../AppContainer';
import { getNavStack, pushRoute, replaceRoute } from '../navigation/NavStack';
import { ROUTES } from '../navigation/Routes';

import { activeColors, tintFilter, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { isTvMetrics, tv } from '../design/Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../design/Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from '../design/components/FocusLift';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { ProfileAvatar } from '../design/components/ProfileAvatar';

// Layout/typography literals with no matching `core/Tokens.ts` field (that
// file has no typography table at all, per `design/components/
// FeatureCopy.ets`'s own header comment) -- named constants here rather
// than inline magic numbers, the same documented-exception pattern every
// other `design/`/`pages/` file in this client already follows.
const HEADING_FONT_SIZE: number = 28;
const PIN_TITLE_FONT_SIZE: number = 20;
const SUBHEADING_FONT_SIZE: number = 15;
const PROFILE_NAME_FONT_SIZE: number = 16;
// Web `.profile-action-button` gear: 44 px round, 18 px pink icon.
const SETTINGS_BUTTON_SIZE: number = 44;
const SETTINGS_ICON_SIZE: number = 18;
const PROFILE_STATUS_FONT_SIZE: number = 12;
const ADD_PROFILE_GLYPH_FONT_SIZE: number = 32;

// Avatar sizing: a "who's watching" picker tile is deliberately larger than
// `ProfileAvatar.ets`'s own 64vp default (sized for a nav-rail account
// tile, per that file's own header comment) -- scaled through
// `design/Metrics.ets#tv()` on the TV profile the same way every other
// TV-geometry literal in this client is, and used as-is on the touch
// profile.
const TV_AVATAR_DIAMETER: number = 168;
const TOUCH_AVATAR_DIAMETER: number = 104;
const PIN_DIALOG_AVATAR_DIAMETER: number = 72;

const TILE_MARGIN: number = Spacing.md;
const PIN_LENGTH: number = 4;
const PIN_DIALOG_WIDTH: number = 320;
const PIN_INPUT_WIDTH: number = 180;

// Modal scrim: a plain translucent black, not a theme-dependent
// `core/Tokens.ts` colour role (there is no "modal backdrop" role, and
// `activeColors().ink` would render near-white in dark mode, exactly
// wrong for a dimming backdrop) -- the same documented exception
// `design/components/ProfileAvatar.ets`'s own rgba(255,255,255,*)
// highlight and `design/components/Skeleton.ets`'s shimmer already
// establish for a colour with no matching token.
const MODAL_SCRIM_ALPHA: number = 0.55;

enum ProfilesViewState {
  Loading,
  Error,
  Ready,
}

@Component
struct Profiles {
  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern, already
  // used by every design/ component in this client).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private viewState: ProfilesViewState = ProfilesViewState.Loading;
  @State private profiles: AvailableProfileResponse[] = [];
  @State private errorMessage: string = '';

  @State private pinTargetProfile: AvailableProfileResponse | null = null;
  @State private pinValue: string = '';
  @State private pinError: string = '';
  @State private pinSubmitting: boolean = false;

  @State private signOutFocusPercent: number = 0;
  @State private pinCancelFocusPercent: number = 0;
  @State private pinContinueFocusPercent: number = 0;

  aboutToAppear(): void {
    this.loadProfiles();
  }

  /** `GET users/profiles` via `data/ProfileRepository.ets#listProfiles()`.
   * Never throws (`ApiResult` end to end) -- a failure is reflected as
   * `ProfilesViewState.Error` with a message, not an exception. */
  private async loadProfiles(): Promise<void> {
    this.viewState = ProfilesViewState.Loading;
    const result = await listProfiles();
    if (result.kind === 'ok') {
      this.profiles = result.value;
      this.viewState = ProfilesViewState.Ready;
      return;
    }
    if (result.kind === 'network_failure') {
      this.errorMessage = 'Could not reach the server. Check your connection and try again.';
    } else if (result.envelope.kind === 'general') {
      this.errorMessage = result.envelope.message;
    } else {
      this.errorMessage = 'Something went wrong loading profiles. Please try again.';
    }
    this.viewState = ProfilesViewState.Error;
  }

  /** Tapped/selected from the grid. Only a `pin_locked` profile detours
   * through the PIN prompt (brief 4.7); every other profile goes straight
   * to `completeProfileSelection`. */
  private selectProfile(profile: AvailableProfileResponse): void {
    if (profile.pin_locked) {
      this.pinTargetProfile = profile;
      this.pinValue = '';
      this.pinError = '';
      return;
    }
    this.completeProfileSelection();
  }

  /** Closes any open PIN prompt and replaces the nav stack with Home --
   * never pushes, per this slice's acceptance criteria ("Back from
   * Profiles does not return to Pairing"). See this file's header comment
   * for why this page's own responsibility ends here. */
  private completeProfileSelection(): void {
    this.pinTargetProfile = null;
    this.pinValue = '';
    this.pinError = '';
    replaceRoute(getNavStack(), ROUTES.Home);
  }

  private closePinPrompt(): void {
    this.pinTargetProfile = null;
    this.pinValue = '';
    this.pinError = '';
    this.pinSubmitting = false;
  }

  /** `POST users/profiles/{id}/verify-pin` via `data/ProfileRepository.ets#
   * verifyPin(...)`. A wrong PIN, a disabled/missing target profile, and
   * (under `AuthMode::FullAccount`) a cross-account probe all come back as
   * the same 401 (brief 4.7) -- shown with the same message as a
   * `verified: false` response, by design; this prompt never tries to
   * distinguish them. */
  private async submitPin(): Promise<void> {
    const target = this.pinTargetProfile;
    if (target === null) {
      return;
    }
    if (this.pinValue.length !== PIN_LENGTH || this.pinSubmitting) {
      return;
    }
    this.pinSubmitting = true;
    this.pinError = '';
    const result = await verifyPin(target.id, this.pinValue);
    this.pinSubmitting = false;
    if (result.kind === 'ok') {
      if (result.value.verified) {
        this.completeProfileSelection();
        return;
      }
      this.pinError = 'Incorrect PIN. Try again.';
      return;
    }
    if (result.kind === 'network_failure') {
      this.pinError = 'Could not reach the server. Check your connection and try again.';
      return;
    }
    this.pinError = 'Incorrect PIN. Try again.';
  }

  /** Strips non-digit characters and clamps to `PIN_LENGTH`, so the field
   * only ever holds a plain numeric string regardless of what the on
   * screen keyboard reports. */
  private onPinDigitsChange(rawValue: string): void {
    let digitsOnly = '';
    for (const character of rawValue) {
      if (character >= '0' && character <= '9') {
        digitsOnly = digitsOnly + character;
      }
    }
    if (digitsOnly.length > PIN_LENGTH) {
      digitsOnly = digitsOnly.slice(0, PIN_LENGTH);
    }
    this.pinValue = digitsOnly;
    this.pinError = '';
  }

  /** Sign-out (brief section 9 Slice 3's sign-out contract, consumed here
   * through `AppContainer.ets` only): clears tokens via
   * `getSessionManager().signOut()`, then routes to `ROUTES.Pairing` when a
   * server address is still configured (the normal case -- sign-out
   * preserves the server address list) or, defensively, `ROUTES.ServerSetup`
   * when `ServerDirectory` reports none at all. */
  private async handleSignOut(): Promise<void> {
    await getSessionManager().signOut();
    const activeBaseUrl = getServerDirectory().getActiveBaseUrl();
    if (activeBaseUrl === null) {
      replaceRoute(getNavStack(), ROUTES.ServerSetup);
      return;
    }
    replaceRoute(getNavStack(), ROUTES.Pairing);
  }

  private setSignOutFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.signOutFocusPercent = focused ? 1 : 0;
    });
  }

  private setPinCancelFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.pinCancelFocusPercent = focused ? 1 : 0;
    });
  }

  private setPinContinueFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.pinContinueFocusPercent = focused ? 1 : 0;
    });
  }

  private avatarDiameter(): number {
    return isTvMetrics() ? tv(TV_AVATAR_DIAMETER) : TOUCH_AVATAR_DIAMETER;
  }

  private focusScale(focusPercent: number): number {
    return 1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR);
  }

  private pinContinueEnabled(): boolean {
    return this.pinValue.length === PIN_LENGTH && !this.pinSubmitting;
  }

  build() {
    NavDestination() {
      Stack() {
        Scroll() {
          Column({ space: Spacing.xl }) {
            Text($r('app.string.profiles_heading'))
              .fontSize(HEADING_FONT_SIZE)
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().ink))

            if (this.viewState === ProfilesViewState.Loading) {
              AsyncState({ kind: AsyncStateKind.Loading })
            } else if (this.viewState === ProfilesViewState.Error) {
              AsyncState({
                kind: AsyncStateKind.Error,
                message: this.errorMessage,
                retryLabel: 'Retry',
                retry: () => {
                  this.loadProfiles();
                },
              })
            } else if (this.profiles.length === 0) {
              // Defensive only -- brief 4.7 guarantees at least one entry
              // (the caller's own account) even under `AuthMode::FullAccount`.
              AsyncState({ kind: AsyncStateKind.Empty, message: 'No profiles are available.' })
            } else {
              Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center, alignItems: ItemAlign.Center }) {
                ForEach(
                  this.profiles,
                  (profile: AvailableProfileResponse) => {
                    Column({ space: Spacing.sm }) {
                      ProfileAvatar({
                        presetId: resolveAvatarPreset(profile.id),
                        diameter: this.avatarDiameter(),
                        onSelect: () => {
                          this.selectProfile(profile);
                        },
                      })

                      Text(profile.display_name)
                        .fontSize(PROFILE_NAME_FONT_SIZE)
                        .fontColor(toResourceColor(activeColors().ink))

                      if (profile.is_current) {
                        Text($r('app.string.profiles_current_badge'))
                          .fontSize(PROFILE_STATUS_FONT_SIZE)
                          .fontColor(toResourceColor(activeColors().accent))
                      } else if (profile.pin_locked) {
                        Text($r('app.string.profiles_pin_locked_badge'))
                          .fontSize(PROFILE_STATUS_FONT_SIZE)
                          .fontColor(toResourceColor(activeColors().inkMuted))
                      }
                    }
                    .margin(TILE_MARGIN)
                  },
                  (profile: AvailableProfileResponse): string => profile.id
                )

                // No create-profile endpoint exists anywhere in the
                // contract (brief 4.7) -- this tile is a disabled
                // placeholder, not a call to an invented endpoint. Profile
                // management stays on Playarr Server's own admin surface.
                Column({ space: Spacing.sm }) {
                  Column() {
                    Text('+')
                      .fontSize(ADD_PROFILE_GLYPH_FONT_SIZE)
                      .fontColor(toResourceColor(activeColors().inkMuted))
                  }
                  .width(this.avatarDiameter())
                  .height(this.avatarDiameter())
                  .borderRadius(Radii.circleFull)
                  .backgroundColor(toResourceColor(activeColors().surfaceSoft))
                  .justifyContent(FlexAlign.Center)
                  .alignItems(HorizontalAlign.Center)

                  Text($r('app.string.profiles_add_profile'))
                    .fontSize(PROFILE_NAME_FONT_SIZE)
                    .fontColor(toResourceColor(activeColors().inkMuted))

                  Text($r('app.string.profiles_add_profile_hint'))
                    .fontSize(PROFILE_STATUS_FONT_SIZE)
                    .fontColor(toResourceColor(activeColors().inkMuted))
                    .textAlign(TextAlign.Center)
                    .constraintSize({ maxWidth: this.avatarDiameter() + Spacing.xl })
                }
                .margin(TILE_MARGIN)
                .opacity(0.6)
                .enabled(false)
              }
              .width('100%')
            }

            Row({ space: Spacing.md }) {
            // Web `.profile-settings-button`: a round gear in the selected profile's actions, opening Settings.
            Stack() {
              Image($r('app.media.nav_settings'))
                .width(SETTINGS_ICON_SIZE)
                .height(SETTINGS_ICON_SIZE)
                .colorFilter(tintFilter(BRAND_PINK))
            }
            .width(SETTINGS_BUTTON_SIZE)
            .height(SETTINGS_BUTTON_SIZE)
            .borderRadius(SETTINGS_BUTTON_SIZE / 2)
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
            .focusable(true)
            .onClick(() => {
              pushRoute(getNavStack(), ROUTES.Settings);
            })
            Button($r('app.string.sign_out'))
              .fontSize(PROFILE_NAME_FONT_SIZE)
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().onAccent))
              .backgroundColor(toResourceColor(activeColors().accent))
              .borderRadius(Radii.btn)
              .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
              .focusable(true)
              .onFocus(() => {
                this.setSignOutFocused(true);
              })
              .onBlur(() => {
                this.setSignOutFocused(false);
              })
              .scale({ x: this.focusScale(this.signOutFocusPercent), y: this.focusScale(this.signOutFocusPercent) })
              .onClick(() => {
                this.handleSignOut();
              })
            }
          }
          .width('100%')
          .padding(Spacing.xl)
          .alignItems(HorizontalAlign.Center)
        }
        .width('100%')
        .height('100%')

        if (this.pinTargetProfile !== null) {
          Stack({ alignContent: Alignment.Center }) {
            Column()
              .width('100%')
              .height('100%')
              .backgroundColor(toResourceColorWithAlpha({ r: 0, g: 0, b: 0, a: 1 }, MODAL_SCRIM_ALPHA))

            Column({ space: Spacing.md }) {
              ProfileAvatar({
                presetId: resolveAvatarPreset(this.pinTargetProfile.id),
                diameter: PIN_DIALOG_AVATAR_DIAMETER,
                onSelect: () => {},
              })

              Text($r('app.string.profiles_pin_title'))
                .fontSize(PIN_TITLE_FONT_SIZE)
                .fontWeight(FontWeight.Bold)
                .fontColor(toResourceColor(activeColors().ink))

              Text(this.pinTargetProfile.display_name)
                .fontSize(SUBHEADING_FONT_SIZE)
                .fontColor(toResourceColor(activeColors().inkSoft))

              TextInput({ text: this.pinValue, placeholder: '0000' })
                .type(InputType.Number)
                .maxLength(PIN_LENGTH)
                .textAlign(TextAlign.Center)
                .width(PIN_INPUT_WIDTH)
                .onChange((value: string) => {
                  this.onPinDigitsChange(value);
                })

              if (this.pinError.length > 0) {
                Text(this.pinError)
                  .fontSize(PROFILE_STATUS_FONT_SIZE)
                  .fontColor(toResourceColor(activeColors().danger))
              }

              Row({ space: Spacing.md }) {
                Button($r('app.string.cancel'))
                  .fontSize(PROFILE_NAME_FONT_SIZE)
                  .fontColor(toResourceColor(activeColors().ink))
                  .backgroundColor(toResourceColor(activeColors().surfaceStrong))
                  .borderRadius(Radii.drawerButton)
                  .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
                  .focusable(true)
                  .onFocus(() => {
                    this.setPinCancelFocused(true);
                  })
                  .onBlur(() => {
                    this.setPinCancelFocused(false);
                  })
                  .scale({ x: this.focusScale(this.pinCancelFocusPercent), y: this.focusScale(this.pinCancelFocusPercent) })
                  .onClick(() => {
                    this.closePinPrompt();
                  })

                Button($r('app.string.profiles_pin_continue'))
                  .fontSize(PROFILE_NAME_FONT_SIZE)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(toResourceColor(activeColors().onAccent))
                  .backgroundColor(toResourceColor(activeColors().accent))
                  .borderRadius(Radii.drawerButton)
                  .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.sm })
                  .enabled(this.pinContinueEnabled())
                  .focusable(true)
                  .onFocus(() => {
                    this.setPinContinueFocused(true);
                  })
                  .onBlur(() => {
                    this.setPinContinueFocused(false);
                  })
                  .scale({ x: this.focusScale(this.pinContinueFocusPercent), y: this.focusScale(this.pinContinueFocusPercent) })
                  .onClick(() => {
                    this.submitPin();
                  })
              }
              .width('100%')
              .justifyContent(FlexAlign.Center)
            }
            .width(PIN_DIALOG_WIDTH)
            .padding(Spacing.xl)
            .backgroundColor(toResourceColor(activeColors().surface))
            .borderRadius(Radii.railPanel)
            .alignItems(HorizontalAlign.Center)
          }
          .width('100%')
          .height('100%')
        }
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(toResourceColor(activeColors().bg))
  }
}

/**
 * Registered in `profile/router_map.json` as the `Profiles` route's
 * `buildFunction` -- same zero-parameter passthrough pattern
 * `pages/Index.ets`'s `IndexBuilder` and `pages/DesignGallery.ets`'s
 * `DesignGalleryBuilder` already establish, since `Profiles` (per
 * `navigation/Routes.ets` / `navigation/NavStack.ets`) is one of the
 * routes pushed/replaced with no navigation parameters.
 */
@Builder
export function ProfilesBuilder(): void {
  Profiles()
}
