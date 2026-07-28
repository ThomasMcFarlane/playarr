/**
 * Reactive light/dark theme state for Playarr on HarmonyOS NEXT (brief
 * sections 5.1/5.2). Two AppStorage keys drive everything:
 *
 * - `'colorMode'` -- the OS-level signal. Seeded and kept live for the
 *   whole app lifetime by `Environment.envProp('colorMode', ColorMode.Light)`
 *   (`@kit.ArkUI`). This is the API this file settled on among the three
 *   candidates in the implementation brief:
 *     - `Environment.envProp` (chosen) -- a static call, no ability/window
 *       context required, and ArkUI keeps the bound AppStorage value
 *       current for the app's whole lifetime with zero further wiring.
 *     - `Configuration` + `UIAbility.onConfigurationUpdate` -- equally
 *       valid and not deprecated, but it is an *ability lifecycle* hook
 *       that would have to be wired into `entryability/EntryAbility.ets`,
 *       which belongs to a different slice of this workflow and is not
 *       part of this file's remit.
 *     - `getUIContext().getHostContext()` -- only reachable from inside a
 *       live `@Component` (needs `this`), so it cannot seed a module-level
 *       default before any UI exists.
 *   `ColorMode` (`.Light` / `.Dark`) is an ArkUI ambient global enum, used
 *   unimported here exactly the way `FontWeight` is already used unimported
 *   in `pages/Index.ets` in this same codebase.
 * - `'themeModeSetting'` -- Playarr's own override (`'system' | 'light' |
 *   'dark'`), defaulting to `'system'`. `getThemeModeSetting`/
 *   `setThemeModeSetting` are a plain get/set pair over this key so that
 *   the later `auth/SettingsStore.ets` slice can persist it with a
 *   one-line addition (call `setThemeModeSetting` after loading the saved
 *   preference on boot, and have its own save path call
 *   `getThemeModeSetting` -- no other file in this design system needs to
 *   change).
 *
 * `resolvedThemeMode()` merges the two: an explicit `'light'`/`'dark'`
 * override always wins over the system signal, in both directions (a
 * `'dark'` override stays dark even in a system-light session, and a
 * `'light'` override stays light even in a system-dark one); only
 * `'system'` defers to `systemColorMode()`.
 *
 * ## Usage from other design/ components
 *
 * `Theme.ets` is a plain module, not a `@Component` -- it cannot itself
 * subscribe to AppStorage changes. Any component that must re-render when
 * the theme changes should declare two tracked (but otherwise unread)
 * fields to subscribe to both keys, then call the functions below inside
 * `build()` for the actual values, e.g.:
 *
 * ```
 * @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
 * @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
 * // ...
 * build() {
 *   Text('Hi').fontColor(toResourceColor(activeColors().ink))
 * }
 * ```
 *
 * This keeps the system/override merge logic in exactly one place (this
 * file) while still giving every sibling component live re-render-on-
 * theme-change behaviour.
 */

import { Environment } from '@kit.ArkUI';
import { LightColors, DarkColors } from '../core/Tokens';
import type { ColorTokens, RgbaColor } from '../core/Tokens';

/** The AppStorage key `Environment.envProp` binds the OS colour-mode
 * signal to. This exact name is part of `Environment`'s own documented
 * contract -- it is not a name this file chose. */
export const SYSTEM_COLOR_MODE_KEY: string = 'colorMode';

/** The AppStorage key backing Playarr's own manual theme override. A
 * later slice's `auth/SettingsStore.ets` reads/writes this same key once
 * it knows how to persist it. */
export const THEME_MODE_SETTING_KEY: string = 'themeModeSetting';

// Bind + keep 'colorMode' live for the app's lifetime. Safe to evaluate at
// module load: `envProp` only binds once and is a no-op on any later call.
Environment.envProp('colorMode', ColorMode.Light);

/** Playarr's own theme preference. `'system'` (the default) follows the
 * OS signal; `'light'`/`'dark'` are an explicit user override. */
export type ThemeModeSetting = 'system' | 'light' | 'dark';

/** The two colour modes Playarr actually renders -- `'system'` never
 * reaches this far, it is always resolved to one of these first. */
export type ResolvedThemeMode = 'light' | 'dark';

if (!AppStorage.has(THEME_MODE_SETTING_KEY)) {
  AppStorage.setOrCreate<ThemeModeSetting>(THEME_MODE_SETTING_KEY, 'system');
}

/** The current manual theme override (`'system'` until the user, or a
 * restored setting, changes it). */
export function getThemeModeSetting(): ThemeModeSetting {
  const stored = AppStorage.get<ThemeModeSetting>(THEME_MODE_SETTING_KEY);
  if (stored !== undefined) {
    return stored;
  }
  return 'system';
}

/** Sets Playarr's manual theme override. Pass `'system'` to go back to
 * following the OS signal. */
export function setThemeModeSetting(mode: ThemeModeSetting): void {
  AppStorage.setOrCreate<ThemeModeSetting>(THEME_MODE_SETTING_KEY, mode);
}

/** The live OS colour-mode signal, collapsed to Playarr's two-mode model. */
export function systemColorMode(): ResolvedThemeMode {
  const mode = AppStorage.get<ColorMode>(SYSTEM_COLOR_MODE_KEY);
  if (mode === ColorMode.Dark) {
    return 'dark';
  }
  return 'light';
}

/** The mode Playarr should actually render: the manual override when one
 * is set, otherwise the live system signal. The override wins in both
 * directions -- it is never merely a "prefer dark" style bias. */
export function resolvedThemeMode(): ResolvedThemeMode {
  const setting = getThemeModeSetting();
  if (setting === 'light') {
    return 'light';
  }
  if (setting === 'dark') {
    return 'dark';
  }
  return systemColorMode();
}

/** The active `ColorTokens` record (brief 5.1 light / 5.2 dark) for the
 * resolved theme mode. Every design component must read colours through
 * this function, never through `LightColors`/`DarkColors` directly, so a
 * single call site controls light/dark selection. */
export function activeColors(): ColorTokens {
  if (resolvedThemeMode() === 'dark') {
    return DarkColors;
  }
  return LightColors;
}

/** Formats a `core/Tokens.ts` `{r,g,b,a}` record as the `rgba(...)` string
 * ArkUI's `ResourceColor` attributes (`.fontColor()`, `.backgroundColor()`,
 * gradient stops, `.border({color})`, ...) accept. */
export function toResourceColor(color: RgbaColor): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

/** As `toResourceColor`, but with the alpha channel overridden -- for the
 * handful of brief-specified opacities (e.g. "inkMuted @ 24%") that apply
 * a different alpha than the token's own stored `a` field. */
export function toResourceColorWithAlpha(color: RgbaColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}
