/**
 * Same integration posture as `LibraryScreen.test.tsx`/`SearchScreen.test.
 * tsx`: real `<ApiClientProvider>` + `useWorkDetail`/`useAsyncData`, only
 * `global.fetch` mocked, routed by URL so the three requests this screen
 * fires (`getWork`, `getWorkCredits`, `getSimilarWorks`) each get their own
 * canned response.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {ActivityIndicator, Text} from 'react-native';
import type {Work, WorkDetail} from '@playarr-tv/api-client';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {WorkDetailScreen, type WorkDetailScreenNavigation} from './WorkDetailScreen';
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

function fakeNavigation(): WorkDetailScreenNavigation & {navigate: jest.Mock} {
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

/** Routes each fetched URL to a canned response, so `getWork`/`getWorkCredits`/`getSimilarWorks` each see the right shape. */
function mockDetailFetch(options: {
  work: WorkDetail | {error: string; message: string};
  credits?: unknown;
  similar?: unknown;
}): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/credits')) return jsonResponse(options.credits ?? {cast: [], crew: []});
    if (url.includes('/similar')) return jsonResponse(options.similar ?? []);
    const status = 'error' in options.work ? 404 : 200;
    return jsonResponse(options.work, status);
  });
}

async function renderDetail(navigation: WorkDetailScreenNavigation, workId = 'w1'): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ApiClientProvider>
        <WorkDetailScreen route={{params: {workId}}} navigation={navigation} />
      </ApiClientProvider>
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe('WorkDetailScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a movie\'s title and overview once loaded', async () => {
    mockDetailFetch({
      work: {
        available_on: [],
        children: 'Movie',
        media_file_id: 'mf-1',
        runtime_ms: 5_400_000,
        work: work({id: 'w1', title: 'The First Film', overview: 'A film about firsts.'}),
      },
    });

    const renderer = await renderDetail(fakeNavigation());

    expect(allText(renderer)).toContain('The First Film');
    expect(allText(renderer)).toContain('A film about firsts.');
    expect(allText(renderer)).toContain('Play');
  });

  it('shows an error state when the work fails to load', async () => {
    mockDetailFetch({work: {error: 'not_found', message: 'No such work.'}});

    const renderer = await renderDetail(fakeNavigation());

    expect(allText(renderer)).toContain('This title could not be loaded');
  });

  it('lists episodes for a series and lets the play button follow the selected one', async () => {
    mockDetailFetch({
      work: {
        available_on: [],
        children: {
          Series: [
            {
              season: {
                availability: 'available',
                id: 'season-1',
                monitored: true,
                overview: null,
                season_number: 1,
                series_work_id: 'w2',
                title: null,
              },
              episodes: [
                {
                  episode: {
                    availability: 'available',
                    episode_number: 1,
                    id: 'ep-1',
                    images: [],
                    monitored: true,
                    overview: null,
                    runtime_minutes: 42,
                    season_id: 'season-1',
                    title: 'Pilot',
                  },
                  media_file_id: 'mf-ep-1',
                  runtime_ms: 2_520_000,
                },
                {
                  episode: {
                    availability: 'available',
                    episode_number: 2,
                    id: 'ep-2',
                    images: [],
                    monitored: true,
                    overview: null,
                    runtime_minutes: 40,
                    season_id: 'season-1',
                    title: 'Second Episode',
                  },
                  media_file_id: null,
                  runtime_ms: null,
                },
              ],
            },
          ],
        },
        media_file_id: null,
        runtime_ms: null,
        work: work({id: 'w2', title: 'A Series', kind: 'series'}),
      },
    });

    const renderer = await renderDetail(fakeNavigation(), 'w2');

    expect(allText(renderer)).toContain('Pilot');
    expect(allText(renderer)).toContain('Second Episode');
    expect(allText(renderer)).toContain('Unavailable');
  });

  it('opens a similar title on the correct detail screen by kind', async () => {
    mockDetailFetch({
      work: {
        available_on: [],
        children: 'Movie',
        media_file_id: 'mf-1',
        runtime_ms: 5_400_000,
        work: work({id: 'w1', title: 'The First Film'}),
      },
      similar: [work({id: 'w3', title: 'A Related Film'})],
    });
    const navigation = fakeNavigation();

    const renderer = await renderDetail(navigation);
    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Open A Related Film'}).props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.workDetail, {workId: 'w3'});
  });

  it('calls onPlay with the movie\'s media file id when Play is pressed', async () => {
    mockDetailFetch({
      work: {
        available_on: [],
        children: 'Movie',
        media_file_id: 'mf-1',
        runtime_ms: 5_400_000,
        work: work({id: 'w1', title: 'The First Film'}),
      },
    });
    const onPlay = jest.fn();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <WorkDetailScreen route={{params: {workId: 'w1'}}} navigation={fakeNavigation()} onPlay={onPlay} />
        </ApiClientProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'Play'}).props.onPress();
    });

    expect(onPlay).toHaveBeenCalledWith('mf-1');
  });

  it('shows a loading indicator before the work resolves', async () => {
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
          <WorkDetailScreen route={{params: {workId: 'w1'}}} navigation={fakeNavigation()} />
        </ApiClientProvider>
      );
      await Promise.resolve();
    });

    expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);

    await act(async () => {
      resolveFetch(
        jsonResponse({
          available_on: [],
          children: 'Movie',
          media_file_id: null,
          runtime_ms: null,
          work: work({id: 'w1', title: 'The First Film'}),
        })
      );
    });
  });
});
