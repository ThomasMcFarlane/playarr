/**
 * RN port of `clients/tv-web/web/src/lib/i18n/LanguageProvider.tsx`, re-using
 * tv-web's `translations/{en,th,ja}.ts` -- and its small `languages.ts`
 * companion (the `ResolvedLanguage`/`LanguagePreference` types,
 * `SUPPORTED_LANGUAGES`, `LANGUAGE_NAMES`, `isLanguagePreference`) -- as DATA
 * via a plain relative import, exactly as design doc §2's directory layout
 * says ("RN port; re-uses tv-web's translations/{en,th,ja}.ts as data") and
 * exactly why that directory listing shows only ONE file under `i18n/`: the
 * translated strings themselves are not meant to be copied into this
 * project at all, only this provider is.
 *
 * A necessary, explicitly-flagged caveat about that relative import: it
 * reaches outside `clients/fire-tv/` entirely, into
 * `clients/tv-web/web/src/lib/i18n/`. TypeScript and Jest both resolve it
 * correctly (relative imports are plain filesystem paths to either tool,
 * independent of `tsconfig.json`'s `paths` / `metro.config.js`'s
 * `extraNodeModules`, which only ever rewrite bare-specifier imports like
 * `@playarr-tv/*` -- see both files' own doc comments). Metro is the one
 * tool this has NOT been verified against: `metro.config.js`'s
 * `watchFolders` currently lists only `../tv-web/packages` (the shared
 * `@playarr-tv/*` packages design doc §4.1 is about), not
 * `../tv-web/web`, and this task's own constraints explicitly forbid
 * editing `metro.config.js` -- "if you genuinely need [something the
 * Foundation stage did not add], say so in your report instead of editing
 * it yourself" is exactly the situation this is. Whether Metro's real
 * bundler accepts a relative `require` reaching a directory outside every
 * configured root is genuinely unverified here, for the same reason the
 * Foundation stage's own report gives for not having run Metro at all yet:
 * this project's validation boundary today is `tsc` + `jest` only (design
 * doc §8.2). If a later, real `npx react-native build-vega` run rejects
 * this import, the fix is a one-line addition to `metro.config.js`'s
 * `watchFolders` array (`path.resolve(projectRoot, '../tv-web/web/src/lib/
 * i18n')`) -- flagged here explicitly for whoever next touches that file,
 * rather than silently copying ~3,100 lines of translation strings into
 * this project instead and accepting the drift risk that would create.
 */
// `React` itself must be a real value import, not just the named hooks --
// this project's babel.config.js forces the CLASSIC JSX runtime project-wide
// (`@babel/plugin-transform-react-jsx` with no `runtime: "automatic"`
// option, needed for `@amazon-devices/react-native-w3cmedia`'s
// `KeplerVideoView`), so the `<LanguageContext.Provider>` JSX below compiles
// to a literal `React.createElement(...)` call. TypeScript's own `"jsx":
// "react-native"` typecheck does not itself demand `React` be in scope (it
// checks JSX elements structurally against the global `JSX` namespace, not
// by requiring the identifier) -- `screens/LinkScreen.test.tsx`'s own top
// comment documents finding exactly this gap for real in
// `api/ApiClientProvider.tsx`/`App.tsx` (both throw `ReferenceError: React
// is not defined` the instant their JSX actually runs); this import exists
// so this file does not repeat that mistake.
import React, {createContext, useContext, useMemo, useState, type ReactNode} from 'react';
import {I18nManager} from 'react-native';
import {
  isLanguagePreference,
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
  type ResolvedLanguage,
} from '../../../tv-web/web/src/lib/i18n/languages';
import {translations, type TranslationKey} from '../../../tv-web/web/src/lib/i18n/translations';

export {LANGUAGE_NAMES, SUPPORTED_LANGUAGES};
export type {LanguagePreference, ResolvedLanguage, TranslationKey};

/**
 * Renamed from the web app's own `"playarr-language"` -- deliberately, not
 * an oversight. `platform/storage/localStorageShim.ts`'s
 * `PERSISTED_PREFIXES` allow-list is `['streamarr:', 'playarr.']` (note the
 * dot), so a key written under the web app's literal hyphenated name would
 * be accepted by `globalThis.localStorage.setItem` (the in-memory Map side
 * of the shim never rejects a write) but silently NEVER reach
 * AsyncStorage's write-behind -- exactly the "looks like it works all
 * session, forgets everything on restart" failure mode design doc §4.6
 * warns about for a completely different key. Every other key this app
 * persists uses the `playarr.` (dot) form for the same reason; this one
 * follows suit.
 */
const LANGUAGE_STORAGE_KEY = 'playarr.language';

const DEFAULT_LANGUAGE: ResolvedLanguage = 'en';

function isResolvedLanguage(value: string): value is ResolvedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Guards every `localStorage` touch -- defensive, not load-bearing in the real app (`src/bootstrap/hydrate.ts` awaits hydration before the first render, so the shim is always installed by the time this provider mounts for real), but it keeps this file safe to render in a standalone test that skips that boot sequence. */
function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function storedPreference(): LanguagePreference {
  if (!hasLocalStorage()) return 'system';
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored && isLanguagePreference(stored) ? stored : 'system';
}

/**
 * Best-effort system-language probe -- Fire TV's equivalent of tv-web's own
 * `detectBrowserLanguage()` (which reads `navigator.languages`, a global
 * Hermes simply does not have; that function's own `typeof navigator ===
 * "undefined"` guard means calling it unmodified here would just return
 * `'en'` unconditionally, silently disabling "system" detection rather than
 * implementing it).
 *
 * `I18nManager` is plain React Native core -- no `@amazon-devices/*`
 * dependency, so this does not need to live behind `src/platform/`'s
 * import boundary -- and `getConstants().localeIdentifier` is real on every
 * RN platform's own `.d.ts` (`react-native/Libraries/ReactNative/
 * I18nManager.d.ts`), typed as genuinely optional
 * (`string | null | undefined`) rather than assumed present. Whether
 * Vega's own Kepler bridge actually populates it with a real device locale
 * is unverified (no design doc §1 fact or §9 risk covers it -- this is a
 * new, small, honestly-flagged unknown in the same spirit as those), but
 * the risk is purely cosmetic: an unpopulated or unrecognised value falls
 * through to `DEFAULT_LANGUAGE`, exactly like tv-web's own "unset/
 * unsupported resolves to English" contract, so "system" never renders
 * something worse than English -- it just may not yet auto-follow the
 * device's real locale until this is confirmed on hardware.
 */
function detectDeviceLanguage(): ResolvedLanguage {
  const localeIdentifier = I18nManager.getConstants().localeIdentifier;
  if (typeof localeIdentifier === 'string') {
    // Android/iOS report locale identifiers underscore-separated
    // ("en_US"); BCP 47 tags (and some platforms) use a hyphen ("en-US").
    // Vega's own separator is unverified, so both are accepted rather than
    // guessing one.
    const subtag = localeIdentifier.toLowerCase().split(/[-_]/)[0] ?? '';
    if (isResolvedLanguage(subtag)) return subtag;
  }
  return DEFAULT_LANGUAGE;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match
  );
}

interface LanguageContextValue {
  preference: LanguagePreference;
  language: ResolvedLanguage;
  detectedLanguage: ResolvedLanguage;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Playarr's UI language controller -- the RN sibling of tv-web's own
 * same-named provider, and (once a later step builds a Vega
 * `ThemeProvider`, per `App.tsx`'s own doc comment on why one does not
 * exist yet) `theme.tsx`'s eventual counterpart for language rather than
 * appearance. "System" is the default and resolves once from
 * `detectDeviceLanguage()` at mount; choosing a language explicitly
 * persists an override under `LANGUAGE_STORAGE_KEY` until "System" is
 * chosen again, exactly mirroring tv-web's own persistence contract.
 *
 * Two things tv-web's version does that this one deliberately drops, both
 * because they are DOM-specific with no Vega equivalent to substitute --
 * not oversights:
 *
 *  - `document.documentElement.lang = language`: there is no `document` on
 *    Hermes (design doc §1.1: "No DOM, no CSS"), and nothing on Vega reads
 *    an HTML `lang` attribute for anything (screen readers, form
 *    autofill, search-engine hints) that would give this a purpose here.
 *  - A live `window.addEventListener("languagechange", ...)` subscription:
 *    RN core exposes no equivalent event for "the device's system locale
 *    just changed while this app is running", and even on the platforms
 *    that do have one, subscribing to it needs a native module this app
 *    does not have. A Fire TV's system language also changes far less
 *    often, and far less plausibly *while this app is foregrounded*, than
 *    a browser tab's `navigator.language` can (a user simply is not
 *    expected to dive into Fire OS's own settings mid-session) -- the
 *    practical effect of dropping this is "system" language re-detects on
 *    next launch rather than instantly, which is a reasonable trade
 *    against needing a whole native subscription for it.
 *
 * Consequently this provider needs no `useEffect` at all -- everything it
 * computes is either read once at mount (`useState`'s lazy initialiser
 * form, for `preference` and `detectedLanguage` alike) or derived during
 * render (`language`, `t`), matching this repo's React rule (CLAUDE.md:
 * prefer derived state over `useEffect`) more closely than tv-web's own
 * two-effect version could, purely because the two effects it has exist
 * for DOM synchronisation this platform doesn't have to do at all.
 */
export function LanguageProvider({children}: {children: ReactNode}): JSX.Element {
  const [preference, setPreferenceState] = useState<LanguagePreference>(storedPreference);
  const [detectedLanguage] = useState<ResolvedLanguage>(detectDeviceLanguage);
  const language = preference === 'system' ? detectedLanguage : preference;

  function setPreference(nextPreference: LanguagePreference): void {
    setPreferenceState(nextPreference);
    if (!hasLocalStorage()) return;
    if (nextPreference === 'system') {
      localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextPreference);
    }
  }

  const t = useMemo(() => {
    const dictionary = translations[language];
    return (key: TranslationKey, params?: Record<string, string | number>) =>
      interpolate(dictionary[key], params);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({preference, language, detectedLanguage, setPreference, t}),
    // setPreference is a fresh closure every render but stable in every way
    // that matters (it only ever reads the latest setter functions, never
    // `preference`/`detectedLanguage` themselves) -- omitted rather than
    // wrapped in its own `useCallback` purely to avoid a second
    // memoisation whose only job would be feeding this one, the same
    // trade-off tv-web's own version makes for the identical reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preference, language, detectedLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a <LanguageProvider>.');
  }
  return context;
}
