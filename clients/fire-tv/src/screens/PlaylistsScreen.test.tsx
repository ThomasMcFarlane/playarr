/** Playlists: the empty state and one track per top-level playlist, with its titles resolved to real works. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import type {Work} from '@playarr-tv/api-client';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {ROUTES} from '../navigation/routes';
import {PlaylistsScreen, type PlaylistsScreenNavigation} from './PlaylistsScreen';

(globalThis as unknown as {React: typeof React}).React = React;

jest.mock('../navigation/backPolicy', () => ({useTvBackNavigation: jest.fn(), useBackLayer: jest.fn()}));

function work(overrides: Partial<Work> & Pick<Work, 'id' | 'title'>): Work {
  return {added_at: '2026-01-01T00:00:00Z', availability: 'available', external_refs: [], genres: [], images: [], kind: 'movie', monitored: true, overview: null, sort_title: overrides.title, tags: [], ...overrides};
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function allText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      return (Array.isArray(children) ? children : [children]).filter((value) => typeof value === 'string').join('');
    })
    .join(' | ');
}

const PLAYLIST = {created_at: '2026-01-01T00:00:00Z', id: 'playlist-1', is_system: false, media_type: 'video', name: 'Weekend Watchlist', owner_user_id: 'user-1', parent_playlist_id: null, updated_at: '2026-01-01T00:00:00Z'};

function mockFetch(handlers: {playlists?: unknown[]; items?: unknown[]; work?: unknown}): void {
  jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/playlists/playlist-1/items')) return json(handlers.items ?? []);
    if (url.includes('/playlists')) return json(handlers.playlists ?? []);
    if (url.includes('/catalog/')) return json({available_on: [], children: 'Movie', media_file_id: null, runtime_ms: null, work: handlers.work});
    return json({}, 404);
  });
}

async function render(navigation: PlaylistsScreenNavigation): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ApiClientProvider>
        <LanguageProvider>
          <PlaylistsScreen navigation={navigation} />
        </LanguageProvider>
      </ApiClientProvider>,
    );
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  return renderer;
}

describe('PlaylistsScreen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the empty state when there are no playlists', async () => {
    mockFetch({playlists: []});
    const text = allText(await render({navigate: jest.fn()}));
    expect(text).toContain('No playlists yet');
    expect(text).toContain('Your collection');
  });

  it('lists a playlist as a track of its titles and opens one', async () => {
    mockFetch({
      playlists: [PLAYLIST],
      items: [{id: 'item-1', playlist_id: 'playlist-1', work_id: 'w1', position: 0, added_at: '2026-01-01T00:00:00Z'}],
      work: work({id: 'w1', title: 'The First Film'}),
    });
    const navigation = {navigate: jest.fn()};
    const renderer = await render(navigation);
    const text = allText(renderer);
    expect(text).toContain('Weekend Watchlist');
    expect(text).toContain('The First Film');
    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'The First Film'}).props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.workDetail, {workId: 'w1', backTo: ROUTES.playlists});
  });
});
