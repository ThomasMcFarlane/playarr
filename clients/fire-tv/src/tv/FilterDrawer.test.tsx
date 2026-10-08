/** The filter drawer: its title, its sections of chips and rows, capitalised labels, and Back/close. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {ThemeProvider} from '../theme/ThemeProvider';
import {FilterDrawer} from './FilterDrawer';

(globalThis as unknown as {React: typeof React}).React = React;

jest.mock('../platform/focus', () => ({TvFocusScope: ({children}: {children: unknown}) => children, focusNode: jest.fn()}));

const layers: Array<() => void> = [];
jest.mock('../navigation/backPolicy', () => ({useBackLayer: (active: boolean, onBack: () => void) => (active ? layers.push(onBack) : 0)}));

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map((node) => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)));
}

describe('FilterDrawer', () => {
  it('shows the kicker, the title and every section, with each chip label capitalised', () => {
    const picked: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ThemeProvider>
          <FilterDrawer
            kicker="Library controls"
            title="Filters"
            closeLabel="Close filters"
            onClose={() => undefined}
            sections={[
              {key: 'view', label: 'View', columns: 2, chips: [{key: 'list', label: 'list', selected: true, icon: 'list', onPress: () => picked.push('list')}]},
              {key: 'type', label: 'Type', columns: 3, chips: [{key: 'tv', label: 'TV', selected: false, onPress: () => picked.push('tv')}, {key: 'm', label: 'monitored only', selected: false, onPress: () => picked.push('m')}]},
              {key: 'q', label: 'Quality', rows: [{key: 'o', title: 'Original', detail: '13 Mbps', selected: true, onPress: () => picked.push('o')}]},
            ]}
          />
        </ThemeProvider>,
      );
    });
    const all = texts(renderer);
    expect(all).toEqual(expect.arrayContaining(['Library controls', 'Filters', 'View', 'List', 'Type', 'TV', 'Monitored Only', 'Quality', 'Original', '13 Mbps']));
    const chips = renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === 'monitored only');
    act(() => chips[0]!.props.onPress());
    expect(picked).toEqual(['m']);
  });

  it('closes on its close button and registers as a Back layer', () => {
    layers.length = 0;
    const onClose = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ThemeProvider>
          <FilterDrawer kicker="k" title="t" closeLabel="Close" onClose={onClose} sections={[]} />
        </ThemeProvider>,
      );
    });
    expect(layers).toHaveLength(1);
    act(() => renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === 'Close')!.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
