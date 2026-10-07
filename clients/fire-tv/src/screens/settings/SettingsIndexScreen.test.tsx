/**
 * `SettingsIndexScreen` has no external dependency at all (no
 * `ApiClientProvider`, no platform hook) -- it renders `React.createElement`
 * calls the classic JSX transform generates, which is why `import React
 * from 'react';` is a real value import here (see this screen's own top
 * comment for why that matters project-wide) rather than the
 * `globalThis.React` workaround `PlayerSettingsScreen.test.tsx`/
 * `ServerScreen.test.tsx`/`ProfileLockScreen.test.tsx` need for the
 * `<ApiClientProvider>` they wrap themselves in.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {
  SettingsIndexScreen,
  buildSettingsIndexEntries,
  type SettingsIndexScreenNavigation,
} from './SettingsIndexScreen';
import {ROUTES} from '../../navigation/routes';

function fakeNavigation(): SettingsIndexScreenNavigation & {navigate: jest.Mock} {
  return {navigate: jest.fn()};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .filter((value) => typeof value === 'string')
    .join(' | ');
}

describe('buildSettingsIndexEntries', () => {
  it('lists exactly the five settings sub-screens routes.ts registers, in order', () => {
    const entries = buildSettingsIndexEntries();

    expect(entries.map((entry) => entry.route)).toEqual([
      ROUTES.settingsAppearance,
      ROUTES.settingsLanguage,
      ROUTES.settingsPlayer,
      ROUTES.settingsServer,
      ROUTES.settingsProfileLock,
    ]);
  });

  it('never lists the three v2-deferred settings pages (no ROUTES entry exists for any of them)', () => {
    const entries = buildSettingsIndexEntries();
    const titles = entries.map((entry) => entry.title);

    expect(titles).not.toContain('Profile avatar');
    expect(titles).not.toContain('Invite a friend');
    expect(titles).not.toContain('Request latency');
  });
});

describe('SettingsIndexScreen', () => {
  it('renders every entry title and description', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<SettingsIndexScreen navigation={fakeNavigation()} />);
    });

    const rendered = allText(renderer);
    for (const entry of buildSettingsIndexEntries()) {
      expect(rendered).toContain(entry.title);
      expect(rendered).toContain(entry.description);
    }
  });

  it('navigates to the pressed row\'s own route', () => {
    const navigation = fakeNavigation();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<SettingsIndexScreen navigation={navigation} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Server connection. Combine libraries from multiple servers in one Playarr interface.'}).props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.settingsServer);
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
  });

  it('gives the first row hasTVPreferredFocus so a D-pad press lands on Settings with something already focused', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<SettingsIndexScreen navigation={fakeNavigation()} />);
    });

    const rows = renderer.root.findAllByType(Pressable);
    expect(rows[0]!.props.hasTVPreferredFocus).toBe(true);
    expect(rows.slice(1).every((row) => !row.props.hasTVPreferredFocus)).toBe(true);
  });
});
