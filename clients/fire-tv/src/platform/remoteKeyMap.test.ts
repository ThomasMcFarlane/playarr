import {normalizeRemoteKey, type RemoteKey} from './remoteKeyMap';

describe('normalizeRemoteKey', () => {
  const directionalCases: ReadonlyArray<[string, RemoteKey]> = [
    ['up', 'up'],
    ['down', 'down'],
    ['left', 'left'],
    ['right', 'right'],
    ['select', 'select'],
    ['back', 'back'],
    ['menu', 'menu'],
  ];

  it.each(directionalCases)('maps raw event "%s" to RemoteKey "%s"', (raw, expected) => {
    expect(normalizeRemoteKey(raw)).toBe(expected);
  });

  it('maps the snake_case transport-control events to their camelCase RemoteKey', () => {
    expect(normalizeRemoteKey('playpause')).toBe('playPause');
    expect(normalizeRemoteKey('skip_backward')).toBe('skipBackward');
    expect(normalizeRemoteKey('skip_forward')).toBe('skipForward');
  });

  it('returns undefined for a raw event type this app does not act on', () => {
    expect(normalizeRemoteKey('long_press_select')).toBeUndefined();
    expect(normalizeRemoteKey('')).toBeUndefined();
    expect(normalizeRemoteKey('PLAYPAUSE')).toBeUndefined(); // case-sensitive: Kepler always reports lowercase
  });
});
