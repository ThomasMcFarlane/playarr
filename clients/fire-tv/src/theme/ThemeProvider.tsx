/**
 * The app's colour scheme. The preference (`system`, `light`, `dark`) is the one the Appearance screen stores under
 * `THEME_PREFERENCE_STORAGE_KEY`; `system` is dark (the Fire TV default). A change remounts the `ThemeBoundary` subtree, so every screen is rebuilt in the new palette.
 */
import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import {Appearance, View} from 'react-native';
import {palettes, setActiveScheme, type Colour, type ColourScheme} from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_STORAGE_KEY = 'playarr.tv.themePreference.v1';

export function parseThemePreference(raw: string | null): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function readStoredThemePreference(): ThemePreference {
  return parseThemePreference(hasLocalStorage() ? localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY) : null);
}

/**
 * `system` is dark on a TV: Vega reports a light appearance even though the platform UI is dark, so following it would
 * paint every fresh install light. Only an explicit Light preference gives the light palette.
 */
export function resolveScheme(preference: ThemePreference, _system?: string | null): ColourScheme {
  return preference === 'light' ? 'light' : 'dark';
}

interface ThemeContextValue {
  scheme: ColourScheme;
  preference: ThemePreference;
  colour: Colour;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  scheme: 'dark',
  preference: 'system',
  colour: palettes.dark,
  setPreference: () => undefined,
});

export function ThemeProvider({children}: {children: React.ReactNode}): React.ReactElement {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredThemePreference);
  const scheme = resolveScheme(preference, Appearance.getColorScheme?.());
  // Set during render so the first frame of this scheme already reads the right palette.
  setActiveScheme(scheme);

  const setPreference = useCallback((next: ThemePreference) => {
    if (hasLocalStorage()) {
      if (next === 'system') localStorage.removeItem(THEME_PREFERENCE_STORAGE_KEY);
      else localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, next);
    }
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({scheme, preference, colour: palettes[scheme], setPreference}),
    [scheme, preference, setPreference]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Remounts its children when the scheme changes, so every style built at render time is rebuilt in the new palette.
 * Mount it INSIDE the `NavigationContainer`: the navigation state lives above it and survives the remount, so a theme
 * change redraws the current screen instead of resetting the stack.
 */
export function ThemeBoundary({children}: {children: React.ReactNode}): React.ReactElement {
  const {scheme} = useTheme();
  return (
    <View key={scheme} style={{flex: 1}}>
      {children}
    </View>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
