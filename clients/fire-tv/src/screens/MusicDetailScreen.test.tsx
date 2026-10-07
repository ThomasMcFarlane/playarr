/**
 * Same integration posture as `WorkDetailScreen.test.tsx`: real
 * `<ApiClientProvider>` + `useWorkDetail`, only `global.fetch` mocked.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import type {Work} from '@playarr-tv/api-client';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {MusicDetailScreen, type MusicDetailScreenNavigation} from './MusicDetailScreen';

// See LibraryScreen.test.tsx's own comment for exactly why this is needed.
(globalThis as unknown as {React: typeof React}).React = React;

function work(overrides: Partial<Work> & Pick<Work, 'id' | 'title'>): Work {
  return {
    added_at: '2026-01-01T00:00:00Z',
    availability: 'available',
    external_refs: [],
    genres: [],
    images: [],
    kind: 'artist',
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

function fakeNavigation(): MusicDetailScreenNavigation {
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

const ARTIST_DETAIL = {
  available_on: [],
  children: {
    Artist: [
      {
        album: {
          album_type: 'studio',
          artist_work_id: 'artist-1',
          availability: 'available',
          id: 'album-1',
          images: [],
          monitored: true,
          release_date: '2020-01-01',
          title: 'Debut',
        },
        tracks: [
          {
            media_file_id: 'mf-track-1',
            runtime_ms: 210_000,
            track: {
              album_id: 'album-1',
              availability: 'available',
              disc_number: 1,
              duration_seconds: 210,
              id: 'track-1',
              title: 'Opening Track',
              track_number: 1,
            },
          },
          {
            media_file_id: null,
            runtime_ms: null,
            track: {
              album_id: 'album-1',
              availability: 'pending',
              disc_number: 1,
              duration_seconds: null,
              id: 'track-2',
              title: 'Unsynced Track',
              track_number: 2,
            },
          },
        ],
      },
    ],
  },
  media_file_id: null,
  runtime_ms: null,
  work: work({id: 'artist-1', title: 'A Great Band'}),
};

describe('MusicDetailScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the artist name, its albums, and the first album's tracks", async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(ARTIST_DETAIL));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <MusicDetailScreen route={{params: {workId: 'artist-1'}}} navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const rendered = allText(renderer);
    expect(rendered).toContain('A Great Band');
    expect(rendered).toContain('Debut');
    expect(rendered).toContain('Opening Track');
    expect(rendered).toContain('Unsynced Track');
  });

  it('calls onPlay with the media file id for a synced track, and disables an unsynced one', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(ARTIST_DETAIL));
    const onPlay = jest.fn();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <MusicDetailScreen route={{params: {workId: 'artist-1'}}} navigation={fakeNavigation()} onPlay={onPlay} />
        </ApiClientProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Play Opening Track'}).props.onPress();
    });
    expect(onPlay).toHaveBeenCalledWith('mf-track-1');

    const unsyncedRow = renderer.root.findByProps({accessibilityLabel: 'Play Unsynced Track'});
    expect(unsyncedRow.props.accessibilityState).toEqual({disabled: true});
  });

  it('shows an error state when the artist fails to load', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({error: 'not_found', message: 'gone'}, 404));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <MusicDetailScreen route={{params: {workId: 'artist-1'}}} navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('This artist could not be loaded');
  });
});
