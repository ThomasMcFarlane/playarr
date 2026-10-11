import {LIBRARY_VIEW_DEFAULTS, parseLibraryView, rememberLibraryView, storedLibraryView} from './libraryView';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v)};
}

describe('library view', () => {
  it('starts from the web defaults', () => {
    expect(storedLibraryView('movie', memory())).toEqual(LIBRARY_VIEW_DEFAULTS);
  });

  it('remembers each choice per kind', () => {
    const storage = memory();
    rememberLibraryView('movie', {view: 'list', size: 'small'}, storage);
    rememberLibraryView('series', {sort: 'date_added', order: 'desc'}, storage);
    expect(storedLibraryView('movie', storage)).toEqual({...LIBRARY_VIEW_DEFAULTS, view: 'list', size: 'small'});
    expect(storedLibraryView('series', storage)).toEqual({...LIBRARY_VIEW_DEFAULTS, sort: 'date_added', order: 'desc'});
  });

  it('ignores stored values it does not know and keeps Cover Flow to artists', () => {
    const storage = memory({'playarr.libraryView.movie': 'cover-flow', 'playarr.artworkSize.movie': 'huge'});
    expect(storedLibraryView('movie', storage)).toEqual(LIBRARY_VIEW_DEFAULTS);
    expect(parseLibraryView(new URLSearchParams('view=cover-flow'), 'artist').view).toBe('cover-flow');
  });
});
