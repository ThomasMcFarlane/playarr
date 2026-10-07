/**
 * Same integration posture as `LibraryScreen.test.tsx`: real
 * `<ApiClientProvider>` + `useAsyncData`, only `global.fetch` mocked. Uses
 * fake timers to control the debounce window explicitly rather than
 * `waitFor`-polling real time, since `DEBOUNCE_MS` is an internal
 * implementation detail this test should not need to know the exact value
 * of just to pass reliably.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import type {Work} from '@playarr-tv/api-client';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {SearchScreen, type SearchScreenNavigation} from './SearchScreen';
import {ROUTES} from '../navigation/routes';

// See LibraryScreen.test.tsx's own comment for exactly why this is needed:
// ApiClientProvider.tsx (a concurrent Foundation-stage file, out of this
// task's scope to fix) renders JSX without importing React as a value.
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

function mockSearchFetch(respond: () => Response | Promise<Response>): jest.SpyInstance {
  // Only the catalogue search answers with the canned response; the progress lookup the cards use gets an empty list.
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes('/search') ? respond() : jsonResponse([]);
  });
}

function searchCalls(fetchMock: jest.SpyInstance): number {
  return fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/search')).length;
}

function fakeNavigation(): SearchScreenNavigation & {navigate: jest.Mock} {
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

describe('SearchScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the idle prompt before anything is typed', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <SearchScreen navigation={fakeNavigation()} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    expect(allText(renderer)).toContain('Start typing to search.');
  });

  it('debounces keystrokes into a single search request', async () => {
    const fetchMock = mockSearchFetch(() => jsonResponse({items: [work({id: 'w1', title: 'Test Movie A'})]}));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <SearchScreen navigation={fakeNavigation()} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    const input = renderer.root.findByType(TextInput);
    act(() => {
      input.props.onChangeText('d');
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    act(() => {
      input.props.onChangeText('du');
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    act(() => {
      input.props.onChangeText('dune');
    });

    // No request yet -- every keystroke above reset the debounce timer.
    expect(searchCalls(fetchMock)).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(searchCalls(fetchMock)).toBe(1);
    expect(allText(renderer)).toContain('Test Movie A');
  });

  it('shows the empty state for a query with no matches', async () => {
    mockSearchFetch(() => jsonResponse({items: []}));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <SearchScreen navigation={fakeNavigation()} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    act(() => {
      renderer.root.findByType(TextInput).props.onChangeText('nonexistent');
    });
    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('No matching titles or playlists.');
  });

  it('opens a search result on the correct detail screen by kind', async () => {
    mockSearchFetch(() => jsonResponse({items: [work({id: 'a1', title: 'A Band', kind: 'artist'})]}));
    const navigation = fakeNavigation();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <SearchScreen navigation={navigation} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    act(() => {
      renderer.root.findByType(TextInput).props.onChangeText('band');
    });
    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'A Band'}).props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.musicDetail, {workId: 'a1', backTo: ROUTES.search});
  });
});
