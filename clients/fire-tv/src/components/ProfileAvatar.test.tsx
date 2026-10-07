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
 * has to actually call `renderer.create(<ProfileAvatar ... />)` and not
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
}));
jest.mock('@amazon-devices/react-linear-gradient', () => ({
  __esModule: true,
  LinearGradient: 'LinearGradient',
}));

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ProfileAvatar} from './ProfileAvatar';
import {pickProfileAvatarPreset} from './profileAvatarPresets';

describe('<ProfileAvatar>', () => {
  it('renders without throwing (the classic-JSX-runtime regression this file exists for)', () => {
    let tree!: renderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        tree = renderer.create(<ProfileAvatar profileId="a-real-profile-id" />);
      });
    }).not.toThrow();
    expect(tree.toJSON()).not.toBeNull();
  });

  it("paints the deterministic preset's own gradient colours", () => {
    const profileId = 'another-profile-id';
    const preset = pickProfileAvatarPreset(profileId);

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ProfileAvatar profileId={profileId} />);
    });

    const gradient = tree.root.findByType('LinearGradient' as never);
    expect(gradient.props.colors).toEqual([preset.start, preset.end]);
  });

  it('renders at a custom size', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ProfileAvatar profileId="sized-profile" size={64} />);
    });

    const svg = tree.root.findByType('Svg' as never);
    expect(svg.props.width).toBe(64);
    expect(svg.props.height).toBe(64);
  });
});
