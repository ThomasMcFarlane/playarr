import type {WorkKind} from '@playarr-tv/api-client';
import {NAV_GROUPS, visibleNavGroups} from './navGroups';

function kinds(...values: WorkKind[]): ReadonlySet<WorkKind> {
  return new Set(values);
}

describe('NAV_GROUPS', () => {
  it('drops the downloads item entirely -- design doc §7 explicitly excludes it (there is no "Downloads" RouteName at all for an item to reference, and NavIconName has no "downloads" member either)', () => {
    const allItems = NAV_GROUPS.flatMap((group) => group.items);
    expect(allItems).toHaveLength(7); // search(1) + library(5) + playlists(1)
    expect(allItems.some((item) => item.label.toLowerCase().includes('download'))).toBe(false);
  });

  it('has exactly the three groups design doc §7 names, in order', () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual(['search', 'library', 'playlists']);
  });
});

describe('visibleNavGroups', () => {
  it('renders nothing at all before availableWorkKinds resolves (null)', () => {
    expect(visibleNavGroups(null)).toEqual([]);
  });

  it('renders every group and every item once every work kind is available', () => {
    const groups = visibleNavGroups(kinds('series', 'movie', 'site', 'artist'));
    expect(groups.map((group) => group.id)).toEqual(['search', 'library', 'playlists']);
    const library = groups.find((group) => group.id === 'library');
    expect(library?.items.map((item) => item.route)).toEqual([
      'Home',
      'Series',
      'Movies',
      'Sites',
      'Music',
    ]);
  });

  it('hides library items whose work kind the server has nothing of, without touching unrelated groups', () => {
    const groups = visibleNavGroups(kinds('movie'));
    const library = groups.find((group) => group.id === 'library');
    // Home has no workKind gate, so it survives alongside Movies.
    expect(library?.items.map((item) => item.route)).toEqual(['Home', 'Movies']);
    expect(groups.some((group) => group.id === 'search')).toBe(true);
    expect(groups.some((group) => group.id === 'playlists')).toBe(true);
  });

  it('drops the library group entirely when the server has none of the gated kinds and Home would be the only survivor -- Home itself still shows since it is ungated', () => {
    const groups = visibleNavGroups(kinds());
    const library = groups.find((group) => group.id === 'library');
    expect(library?.items.map((item) => item.route)).toEqual(['Home']);
  });

  it('accepts an injected group list, so a future addition to NAV_GROUPS cannot silently break this test', () => {
    const custom = [
      {
        id: 'library' as const,
        items: [{route: 'Movies' as const, label: 'Movies', icon: 'movies' as const, workKind: 'movie' as const}],
      },
    ];
    expect(visibleNavGroups(kinds(), custom)).toEqual([]);
    expect(visibleNavGroups(kinds('movie'), custom)).toEqual(custom);
  });
});
