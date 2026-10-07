/**
 * Regression guard for the "renders without throwing" class of bug this
 * component actually shipped with once: `babel.config.js` forces the
 * classic JSX runtime (see that file's own doc comment, and
 * `platform/focus.tsx`'s), which compiles every `<Foo>` in this file to a
 * bare `React.createElement(...)` call. `ProfileAvatar.tsx` only ever
 * imported `React` as a *type* (or not at all), so `React` was undefined
 * at the value position the moment this component actually mounted --
 * `tsc` had no way to catch it because `React.ReactElement` as a return
 * type annotation is a perfectly valid type-only use, and nothing here was
 * ever exercised by a real `react-test-renderer` render before now. This
 * file exists specifically to close that gap: it does not assert much
 * about the six presets' own artwork (`profileAvatarPresets.test.ts`
 * already covers the deterministic hash/colour pairing in full), it just
 * has to actually call `renderer.create(<ApiClientProvider><ProfileAvatar ... /></ApiClientProvider>)` and not
 * throw.
 *
 * Same `jest.mock()` posture as `QrCode.test.tsx`'s own doc comment
 * explains in full: `@amazon-devices/react-native-svg` reaches down to
 * `requireNativeComponent` on import, so it needs a trivial string-tag
 * double under plain `jest` (no real Kepler/RN host here) --
 * `@amazon-devices/react-linear-gradient` gets the same treatment for the
 * same reason.
 */
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Defs: 'Defs',
  Stop: 'Stop',
  RadialGradient: 'RadialGradient',
}));
jest.mock('@amazon-devices/react-linear-gradient', () => ({
  __esModule: true,
  default: 'LinearGradient',
}));

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {ProfileAvatar} from './ProfileAvatar';
import {pickProfileAvatarPreset} from './profileAvatarPresets';

describe('<ProfileAvatar>', () => {
  it('renders without throwing (the classic-JSX-runtime regression this file exists for)', () => {
    let tree!: renderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        tree = renderer.create(<ApiClientProvider><ProfileAvatar profileId="a-real-profile-id" /></ApiClientProvider>);
      });
    }).not.toThrow();
    expect(tree.toJSON()).not.toBeNull();
  });

  it("paints the deterministic preset's own gradient colours", () => {
    const profileId = 'another-profile-id';
    const preset = pickProfileAvatarPreset(profileId);

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ApiClientProvider><ProfileAvatar profileId={profileId} /></ApiClientProvider>);
    });

    const gradient = tree.root.findByType('LinearGradient' as never);
    expect(gradient.props.colors).toEqual([preset.start, preset.end]);
  });

  it('renders at a custom size', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ApiClientProvider><ProfileAvatar profileId="sized-profile" size={64} /></ApiClientProvider>);
    });

    // The glyph is drawn at 86% of the disc (the web's `.profile-avatar > svg`), and the sheen fills it.
    const [glyph, sheen] = tree.root.findAllByType('Svg' as never);
    expect(glyph.props.width).toBeCloseTo(64 * 0.86);
    expect(glyph.props.height).toBeCloseTo(64 * 0.86);
    expect(sheen.props.width).toBe(64);
    expect(sheen.props.height).toBe(64);
  });
});
