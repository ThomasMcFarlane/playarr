import {playableLeaves} from './ActionsDrawer';

jest.mock('../navigation/PlayerHandleContext', () => ({PlayerHandleContext: require('react').createContext(null)}));

test('a film has its one file; a series has every episode that has a file', () => {
  expect(playableLeaves({media_file_id: 'f1', runtime_ms: 5000, children: null} as never)).toEqual([{mediaFileId: 'f1', runtimeMs: 5000}]);
  expect(playableLeaves({media_file_id: null, runtime_ms: null, children: null} as never)).toEqual([]);
  const series = {
    media_file_id: null,
    runtime_ms: null,
    children: {Series: [{episodes: [{media_file_id: 'e1', runtime_ms: 100}, {media_file_id: null}]}, {episodes: [{media_file_id: 'e3', runtime_ms: null}]}]},
  };
  expect(playableLeaves(series as never)).toEqual([
    {mediaFileId: 'e1', runtimeMs: 100},
    {mediaFileId: 'e3', runtimeMs: 0},
  ]);
});
