/**
 * Same integration posture as this directory's other screen tests: real
 * `<ApiClientProvider>` + `useAsyncData`, only `global.fetch` mocked and
 * routed by URL/method so `listPlaylists`, `listPlaylistItems`, and the
 * per-item `getWork` resolution each see the right canned response.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ActivityIndicator, Text} from 'react-native';
import type {Work} from '@playarr-tv/api-client';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {PlaylistsScreen, type PlaylistsScreenNavigation} from './PlaylistsScreen';
import {ROUTES} from '../navigation/routes';

// See LibraryScreen.test.tsx's own comment for exactly why this is needed.
(globalThis as unknown as {React: typeof React}).React = React;

function work(overrides: Partial<Work> & Pick<Work, 'id' | 'title'>): Work {
  return {
    added_at: '2026-01-01T00:00:00Z',
    availability: 'available',
    external_refs: [],
    genres: [],
    images: [],
    kind: 'movie',
    monitored: true,
    overview: null,
    sort_title: overrides.title,
    tags: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function fakeNavigation(): PlaylistsScreenNavigation & {navigate: jest.Mock} {
  return {navigate: jest.fn()};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      const fragments = Array.isArray(children) ? children : [children];
      return fragments.filter((value) => typeof value === 'string').join('');
    })
    .join(' | ');
}

const PLAYLIST = {
  created_at: '2026-01-01T00:00:00Z',
  id: 'playlist-1',
  is_system: false,
  media_type: 'video',
  name: 'Weekend Watchlist',
  owner_user_id: 'user-1',
  parent_playlist_id: null,
  updated_at: '2026-01-01T00:00:00Z',
};

function mockFetch(handlers: {playlists?: unknown[]; items?: unknown[]; work?: unknown}): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/playlists/playlist-1/items')) return jsonResponse(handlers.items ?? []);
    if (url.includes('/playlists')) return jsonResponse(handlers.playlists ?? []);
    if (url.includes('/catalog/')) {
      return jsonResponse({
        available_on: [],
        children: 'Movie',
        media_file_id: null,
        runtime_ms: null,
        work: handlers.work,
      });
    }
    return jsonResponse({}, 404);
  });
}

async function renderPlaylists(navigation: PlaylistsScreenNavigation): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ApiClientProvider>
        <PlaylistsScreen navigation={navigation} />
      </ApiClientProvider>
    );
    await Promise.resolve();
  });
  return renderer;
}

describe('PlaylistsScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a prompt to choose a playlist before one is selected', async () => {
    mockFetch({playlists: [PLAYLIST]});

    const renderer = await renderPlaylists(fakeNavigation());

    expect(allText(renderer)).toContain('Weekend Watchlist');
    expect(allText(renderer)).toContain('Choose a playlist to open it.');
  });

  it('shows the empty-playlists state when there are none yet', async () => {
    mockFetch({playlists: []});

    const renderer = await renderPlaylists(fakeNavigation());

    expect(allText(renderer)).toContain('No playlists yet');
  });

  it('loads and renders a selected playlist\'s items, resolved to real works', async () => {
    mockFetch({
      playlists: [PLAYLIST],
      items: [{added_at: '2026-01-01T00:00:00Z', id: 'item-1', playlist_id: 'playlist-1', position: 0, work_id: 'w1'}],
      work: work({id: 'w1', title: 'The First Film'}),
    });

    const renderer = await renderPlaylists(fakeNavigation());

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Open Weekend Watchlist'}).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('The First Film');
  });

  it('opens a resolved item on the correct detail screen by kind', async () => {
    mockFetch({
      playlists: [PLAYLIST],
      items: [{added_at: '2026-01-01T00:00:00Z', id: 'item-1', playlist_id: 'playlist-1', position: 0, work_id: 'a1'}],
      work: work({id: 'a1', title: 'A Band', kind: 'artist'}),
    });
    const navigation = fakeNavigation();

    const renderer = await renderPlaylists(navigation);
    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Open Weekend Watchlist'}).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Open A Band'}).props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.musicDetail, {workId: 'a1'});
  });

  it('shows a loading indicator while playlists are loading', async () => {
    let resolveFetch!: (response: Response) => void;
    jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <PlaylistsScreen navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
      await Promise.resolve();
    });

    expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);

    await act(async () => {
      resolveFetch(jsonResponse([]));
    });
  });
});
