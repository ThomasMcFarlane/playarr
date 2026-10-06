/**
 * Thin re-export of Vega's only persistence primitive, narrowed to the
 * `AsyncStorageLike` shape `localStorageShim.ts` actually calls. Kept as its
 * own file, separate from the shim, for one reason: the shim's own tests
 * must be able to exercise every real code path via a trivial injected
 * fake, with zero dependency on this native module resolving under Jest at
 * all (see localStorageShim.test.ts's top comment). This file is the one
 * and only place in the app that imports the real package -- everything
 * else, including the shim itself, only ever sees the narrow interface.
 *
 * The cast below is deliberate, not lazy: `@amazon-devices/react-native-
 * async-storage__async-storage` is a brand-new package (design doc §3.3)
 * whose shipped `.d.ts` quality is unverified, and `skipLibCheck` in
 * tsconfig.json already accepts that risk for third-party types generally.
 * Asserting the shape explicitly here, at the one seam that matters, is
 * more honest than hoping structural inference lines up with whatever the
 * package actually ships -- if the real module's runtime shape ever
 * doesn't match `AsyncStorageLike`, this line is exactly where that surfaces.
 */
import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import type {AsyncStorageLike} from './localStorageShim';

export const asyncStorage: AsyncStorageLike = AsyncStorage as unknown as AsyncStorageLike;
