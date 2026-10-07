/**
 * Regression guard for the classic-JSX-runtime "React is not defined"
 * class of bug (see `ProfileAvatar.test.tsx`'s own doc comment for the
 * full explanation, which applies here unchanged: `TvEmptyState.tsx` used
 * to render JSX with no value-level `import React from 'react'` in scope,
 * a bug `tsc` cannot see because every `React.` use in that file is a type
 * position). Mounting each `tone`/`graphic` combination at least once here
 * is cheap and, unlike a single smoke render, also exercises every branch
 * of the `EmptyStateGraphic` switch and the `tone === 'error'` colour
 * fork, so a future accidental exhaustiveness gap in that switch fails a
 * test instead of only failing at runtime on a real device.
 *
 * `@amazon-devices/react-native-svg` is mocked out for the same reason
 * `QrCode.test.tsx`'s own doc comment gives: it reaches `requireNativeComponent`
 * on import, which has no real host under plain `jest`.
 */
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
}));

import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {TvEmptyState, type TvEmptyStateGraphic} from './TvEmptyState';

const ALL_GRAPHICS: TvEmptyStateGraphic[] = [
  'home',
  'movies',
  'series',
  'music',
  'search',
  'playlist',
  'move',
  'details',
];

describe('<TvEmptyState>', () => {
  it('renders without throwing (the classic-JSX-runtime regression this file exists for)', () => {
    let tree!: renderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        tree = renderer.create(<TvEmptyState title="Nothing here yet" />);
      });
    }).not.toThrow();
    expect(tree.toJSON()).not.toBeNull();
  });

  it('renders every graphic variant without throwing', () => {
    for (const graphic of ALL_GRAPHICS) {
      expect(() => {
        act(() => {
          renderer.create(<TvEmptyState title="Empty" graphic={graphic} />);
        });
      }).not.toThrow();
    }
  });

  it('shows the title and, when given one, the description', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<TvEmptyState title="No results" description="Try a different search" />);
    });

    const strings = tree.root.findAllByType(Text).map((node) => node.props.children);
    expect(strings).toContain('No results');
    expect(strings).toContain('Try a different search');
  });

  it('sets accessibilityRole="alert" for tone="error", "text" otherwise', () => {
    let errorTree!: renderer.ReactTestRenderer;
    act(() => {
      errorTree = renderer.create(<TvEmptyState title="Failed to load" tone="error" />);
    });
    expect(errorTree.root.findByProps({accessibilityLabel: 'Failed to load'}).props.accessibilityRole).toBe('alert');

    let emptyTree!: renderer.ReactTestRenderer;
    act(() => {
      emptyTree = renderer.create(<TvEmptyState title="Nothing yet" />);
    });
    expect(emptyTree.root.findByProps({accessibilityLabel: 'Nothing yet'}).props.accessibilityRole).toBe('text');
  });
});
