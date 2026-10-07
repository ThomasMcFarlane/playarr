/**
 * Runs once per test file, after Jest's own globals (`expect`, etc.) are
 * installed -- see jest.config.json's `setupFilesAfterEnv`. Two jobs, both
 * named directly in design doc §2's file-purpose comment for this file:
 *
 *  1. Install the same runtime polyfills production gets, by importing the
 *     real src/bootstrap/polyfills.ts rather than re-declaring a second,
 *     parallel set that could quietly drift from what App.tsx actually
 *     runs. A test asserting behaviour that depends on `atob`/`URL`/
 *     `crypto.randomUUID` existing should see EXACTLY the environment
 *     production has, not a test-only approximation of it.
 *  2. Provide an in-memory jest.mock() double for the Vega AsyncStorage
 *     module, so anything that eventually imports
 *     src/platform/storage/asyncStorage.ts (directly, or transitively
 *     through src/platform/index.ts) resolves to a working fake instead of
 *     a real native module Jest has no host for -- see
 *     src/platform/storage/localStorageShim.test.ts's own doc comment for
 *     why the shim's OWN tests deliberately do NOT rely on this mock (they
 *     inject a fake store directly instead, so they keep working even if
 *     this double's shape ever falls out of sync with the real module).
 */
import './src/bootstrap/polyfills';

jest.mock('@amazon-devices/react-native-async-storage__async-storage', () => {
  let store = new Map<string, string>();

  return {
    __esModule: true,
    default: {
      getItem: async (key: string): Promise<string | null> => store.get(key) ?? null,
      setItem: async (key: string, value: string): Promise<void> => {
        store.set(key, value);
      },
      removeItem: async (key: string): Promise<void> => {
        store.delete(key);
      },
      getAllKeys: async (): Promise<string[]> => Array.from(store.keys()),
      multiGet: async (keys: string[]): Promise<Array<[string, string | null]>> =>
        keys.map((key) => [key, store.get(key) ?? null]),
      multiSet: async (pairs: Array<[string, string]>): Promise<void> => {
        for (const [key, value] of pairs) store.set(key, value);
      },
      multiRemove: async (keys: string[]): Promise<void> => {
        for (const key of keys) store.delete(key);
      },
      clear: async (): Promise<void> => {
        store = new Map<string, string>();
      },
    },
  };
});

// Native modules the shared components (artwork, shell, gradients) reach on import. Under Jest there is no Kepler host to
// register them against, so each gets a plain double; a test that needs different behaviour mocks the module itself.
jest.mock('@amazon-devices/react-native-device-info', () => ({
  __esModule: true,
  getModel: () => 'Fire TV Stick 4K Select',
  getSystemVersion: () => '1.2',
}));

jest.mock('@amazon-devices/react-linear-gradient', () => ({
  __esModule: true,
  default: 'LinearGradient',
}));

jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
  G: 'G',
  Defs: 'Defs',
  Stop: 'Stop',
  Line: 'Line',
  Polyline: 'Polyline',
  Polygon: 'Polygon',
  LinearGradient: 'SvgLinearGradient',
  RadialGradient: 'RadialGradient',
}));
