import type {ImageKind} from '@playarr-tv/api-client';
import {albumArtworkUrl, artworkAuthHeaders, preferredArtworkKind, workArtworkUrl} from './artworkUrl';

describe('artwork URLs and a trailing-slash base', () => {
  it('never produces a double slash when the base ends in one (the Fire TV grey-box bug)', () => {
    expect(workArtworkUrl('http://192.0.2.10:8484/', 'work-1', 'poster')).toBe(
      'http://192.0.2.10:8484/api/v1/artwork/work/work-1/poster'
    );
    expect(albumArtworkUrl('http://192.0.2.10:8484//', 'artist-1', 'album-1', 'thumb')).toBe(
      'http://192.0.2.10:8484/api/v1/artwork/album/artist-1/album-1/thumb'
    );
  });
});

describe('workArtworkUrl', () => {
  it('builds the exact path api-client/src/index.ts\'s getWorkArtwork uses', () => {
    expect(workArtworkUrl('http://192.168.1.20:8484', 'work-1', 'poster')).toBe(
      'http://192.168.1.20:8484/api/v1/artwork/work/work-1/poster'
    );
  });

  it('percent-encodes path segments', () => {
    expect(workArtworkUrl('http://192.168.1.20:8484', 'work/1 with spaces', 'poster')).toBe(
      'http://192.168.1.20:8484/api/v1/artwork/work/work%2F1%20with%20spaces/poster'
    );
  });
});

describe('albumArtworkUrl', () => {
  it('builds the exact path api-client/src/index.ts\'s getAlbumArtwork uses', () => {
    expect(albumArtworkUrl('http://192.168.1.20:8484', 'artist-1', 'album-1', 'thumb')).toBe(
      'http://192.168.1.20:8484/api/v1/artwork/album/artist-1/album-1/thumb'
    );
  });
});

describe('artworkAuthHeaders', () => {
  it('returns a Bearer Authorization header when a token is available', () => {
    expect(artworkAuthHeaders('token-123')).toEqual({Authorization: 'Bearer token-123'});
  });

  it('returns undefined (no header at all) when no token is available', () => {
    expect(artworkAuthHeaders(undefined)).toBeUndefined();
  });
});

describe('preferredArtworkKind', () => {
  // ImageAsset (generated/schema.ts) requires `kind` and `url`; `height`/
  // `width` are optional and irrelevant to this function, so omitted. An
  // explicit annotation (rather than `as const`) is used so `images` stays
  // a plain mutable array and `kind` stays narrowed to ImageKind -- Work's
  // real `images` field is `ImageAsset[]`, not a readonly tuple.
  const workLike: {images: Array<{kind: ImageKind; url: string}>} = {
    images: [
      {kind: 'backdrop', url: 'https://example.invalid/backdrop.jpg'},
      {kind: 'poster', url: 'https://example.invalid/poster.jpg'},
    ],
  };

  it('returns the first requested kind the work actually has, in preference order', () => {
    expect(preferredArtworkKind(workLike, ['poster', 'backdrop'])).toBe('poster');
    expect(preferredArtworkKind(workLike, ['backdrop', 'poster'])).toBe('backdrop');
  });

  it('returns null when none of the requested kinds are available', () => {
    expect(preferredArtworkKind(workLike, ['banner'])).toBeNull();
  });
});
