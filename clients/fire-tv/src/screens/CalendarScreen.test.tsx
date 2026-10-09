/** The calendar's agenda: entries under their day, the selected release's details and the unreadable-source banner. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {CalendarScreen} from './CalendarScreen';

(globalThis as unknown as {React: typeof React}).React = React;

jest.mock('../navigation/backPolicy', () => ({useTvBackNavigation: jest.fn(), useBackLayer: jest.fn()}));
jest.mock('@amazon-devices/react-navigation__native', () => ({useNavigation: () => ({navigate: jest.fn()})}));

function allText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      return (Array.isArray(children) ? children : [children]).filter((value) => typeof value === 'string').join('');
    })
    .join(' | ');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const response = {
  start: todayIso(),
  end: todayIso(),
  entries: [
    {
      id: 'e1',
      date: todayIso(),
      title: 'A Film',
      media_kind: 'movie',
      release_type: 'cinema',
      has_file: true,
      monitored: true,
      sources: [{arr_id: 1, source_instance_id: 's1', source_kind: 'radarr', source_name: 'Radarr'}],
    },
  ],
  sources: [{source_instance_id: 's2', name: 'Sonarr', kind: 'sonarr', status: 'unreachable', entry_count: 0, error: 'timed out'}],
};

describe('CalendarScreen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists a release with its state and warns about an unreadable source', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), {status: 200, headers: {'Content-Type': 'application/json'}}));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <CalendarScreen />
          </LanguageProvider>
        </ApiClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = allText(renderer);
    expect(text).toContain('Calendar');
    expect(text).toContain('A Film');
    expect(text).toContain('In library');
    expect(text).toContain('1 source(s) could not be read');
    expect(text).toContain('Sonarr');
  });
});
