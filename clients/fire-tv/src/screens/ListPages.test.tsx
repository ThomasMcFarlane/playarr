/** The Watchlist, Requests and Downloads pages: the empty states, and a watchlist row with its actions. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {DownloadsScreen, RequestsScreen, WatchlistScreen} from './ListPages';

(globalThis as unknown as {React: typeof React}).React = React;

// The pages register a BACK policy and read the navigator; neither is under test here.
jest.mock('../navigation/backPolicy', () => ({useTvBackNavigation: jest.fn(), useBackLayer: jest.fn()}));
jest.mock('@amazon-devices/react-navigation__native', () => ({useNavigation: () => ({navigate: jest.fn()})}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
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

async function render(screen: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <ApiClientProvider>
        <LanguageProvider>{screen}</LanguageProvider>
      </ApiClientProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe('list pages', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the watchlist empty state', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => jsonResponse({items: []}));
    expect(allText(await render(<WatchlistScreen />))).toContain('Your watchlist is empty');
  });

  it('shows the requests empty state', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => jsonResponse([]));
    expect(allText(await render(<RequestsScreen />))).toContain('No requests yet');
  });

  it('lists a request with its status', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => jsonResponse([{id: 'r1', title: 'A Film', year: 2024, status: 'pending', mine: true, requested_by: 'me', status_note: null}]));
    const text = allText(await render(<RequestsScreen />));
    expect(text).toContain('A Film');
    expect(text).toContain('Waiting for approval');
  });

  it('shows the downloads page empty, as nothing downloads on this platform', async () => {
    expect(allText(await render(<DownloadsScreen />))).toContain('No downloads yet');
  });
});
