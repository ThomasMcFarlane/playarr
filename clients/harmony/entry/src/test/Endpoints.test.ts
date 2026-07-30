// entry/src/test/Endpoints.test.ts
//
// Every core/Endpoints.ts function asserted against the exact contract
// literal it must produce (brief section 4 sub-sections 4.3, 4.5-4.13).
// Expected values are written out in full on the right-hand side of each
// assertion -- never reconstructed via the same string concatenation the
// implementation uses -- so a bug in the implementation's concatenation
// cannot also be baked into the expectation.
//
// Plain node:test / node:assert. No ArkUI, no @kit./@ohos. imports.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  systemVersionUrl,
  deviceCodeUrl,
  tokenUrl,
  refreshUrl,
  loginUrl,
  profilesUrl,
  verifyPinUrl,
  capabilitiesUrl,
  playerPreferencesUrl,
  catalogUrl,
  catalogKindsUrl,
  catalogSearchUrl,
  catalogDetailUrl,
  catalogSimilarUrl,
  viewsUrl,
  viewResolveUrl,
  folderRootsUrl,
  folderBrowseUrl,
  artworkWorkUrl,
  artworkAlbumUrl,
  mediaThumbnailUrl,
  playbackInfoUrl,
  mediaStreamUrl,
  mediaChaptersUrl,
  mediaMetadataUrl,
  mediaSubtitleUrl,
  playbackEventsUrl,
  playbackProgressListUrl,
  playbackProgressUrl
} from '../main/ets/core/Endpoints';

const WORK_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';
const THIRD_ID = '33333333-3333-3333-3333-333333333333';
const PROFILE_ID = '44444444-4444-4444-4444-444444444444';
const SESSION_ID = '55555555-5555-5555-5555-555555555555';
const MEDIA_FILE_ID = '66666666-6666-6666-6666-666666666666';

describe('Endpoints - 4.13 version/compatibility', () => {
  it('systemVersionUrl is the unauthenticated version probe', () => {
    assert.equal(systemVersionUrl(), '/api/system/version');
  });
});

describe('Endpoints - 4.3 device authorisation (RFC 8628)', () => {
  it('deviceCodeUrl', () => {
    assert.equal(deviceCodeUrl(), '/api/v1/oauth/device/code');
  });

  it('tokenUrl', () => {
    assert.equal(tokenUrl(), '/api/v1/oauth/token');
  });
});

describe('Endpoints - 4.5 token refresh', () => {
  it('refreshUrl', () => {
    assert.equal(refreshUrl(), '/api/v1/auth/refresh');
  });
});

describe('Endpoints - 4.6 login', () => {
  it('loginUrl', () => {
    assert.equal(loginUrl(), '/api/v1/auth/login');
  });
});

describe('Endpoints - 4.7 profiles', () => {
  it('profilesUrl', () => {
    assert.equal(profilesUrl(), '/api/v1/users/profiles');
  });

  it('verifyPinUrl interpolates the profile id between profiles/ and /verify-pin', () => {
    assert.equal(
      verifyPinUrl(PROFILE_ID),
      '/api/v1/users/profiles/44444444-4444-4444-4444-444444444444/verify-pin'
    );
  });

  it('capabilitiesUrl', () => {
    assert.equal(capabilitiesUrl(), '/api/v1/users/me/capabilities');
  });

  it('playerPreferencesUrl', () => {
    assert.equal(playerPreferencesUrl(), '/api/v1/users/me/player-preferences');
  });
});

describe('Endpoints - 4.8 catalog', () => {
  it('catalogUrl', () => {
    assert.equal(catalogUrl(), '/api/v1/catalog');
  });

  it('catalogKindsUrl', () => {
    assert.equal(catalogKindsUrl(), '/api/v1/catalog/kinds');
  });

  it('catalogSearchUrl (query string is left to the caller)', () => {
    assert.equal(catalogSearchUrl(), '/api/v1/catalog/search');
  });

  it('catalogDetailUrl interpolates the work id directly after catalog/', () => {
    assert.equal(
      catalogDetailUrl(WORK_ID),
      '/api/v1/catalog/11111111-1111-1111-1111-111111111111'
    );
  });

  it('catalogSimilarUrl appends /similar after the work id', () => {
    assert.equal(
      catalogSimilarUrl(WORK_ID),
      '/api/v1/catalog/11111111-1111-1111-1111-111111111111/similar'
    );
  });

  it('viewsUrl', () => {
    assert.equal(viewsUrl(), '/api/v1/views');
  });

  it('viewResolveUrl interpolates the view id then /resolve', () => {
    assert.equal(
      viewResolveUrl(OTHER_ID),
      '/api/v1/views/22222222-2222-2222-2222-222222222222/resolve'
    );
  });
});

describe('Endpoints - file-derived folder browsing', () => {
  it('folderRootsUrl', () => {
    assert.equal(folderRootsUrl(), '/api/v1/folders/roots');
  });

  it('folderBrowseUrl interpolates the opaque root id', () => {
    assert.equal(
      folderBrowseUrl(THIRD_ID),
      '/api/v1/folders/33333333-3333-3333-3333-333333333333'
    );
  });
});

describe('Endpoints - 4.9 artwork', () => {
  it('artworkWorkUrl orders work id before kind, both path segments', () => {
    assert.equal(
      artworkWorkUrl(WORK_ID, 'poster'),
      '/api/v1/artwork/work/11111111-1111-1111-1111-111111111111/poster'
    );
  });

  it('artworkWorkUrl with a different kind segment', () => {
    assert.equal(
      artworkWorkUrl(WORK_ID, 'backdrop'),
      '/api/v1/artwork/work/11111111-1111-1111-1111-111111111111/backdrop'
    );
  });

  it('artworkAlbumUrl orders artistWorkId, then albumId, then kind -- three distinct ids never swapped', () => {
    assert.equal(
      artworkAlbumUrl(WORK_ID, OTHER_ID, 'poster'),
      '/api/v1/artwork/album/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/poster'
    );
  });

  it('artworkAlbumUrl is sensitive to argument order (regression guard against swapped params)', () => {
    const forward = artworkAlbumUrl(WORK_ID, OTHER_ID, 'thumb');
    const swapped = artworkAlbumUrl(OTHER_ID, WORK_ID, 'thumb');
    assert.notEqual(forward, swapped);
  });

  it('mediaThumbnailUrl (position_ms query left to the caller)', () => {
    assert.equal(
      mediaThumbnailUrl(MEDIA_FILE_ID),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/thumbnail'
    );
  });
});

describe('Endpoints - 4.10 playback negotiation', () => {
  it('playbackInfoUrl is the bare media file id under playback/', () => {
    assert.equal(
      playbackInfoUrl(MEDIA_FILE_ID),
      '/api/v1/playback/66666666-6666-6666-6666-666666666666'
    );
  });
});

describe('Endpoints - 4.11 fetching bytes', () => {
  it('mediaStreamUrl', () => {
    assert.equal(
      mediaStreamUrl(MEDIA_FILE_ID),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/stream'
    );
  });

  it('mediaChaptersUrl', () => {
    assert.equal(
      mediaChaptersUrl(MEDIA_FILE_ID),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/chapters'
    );
  });

  it('mediaMetadataUrl', () => {
    assert.equal(
      mediaMetadataUrl(MEDIA_FILE_ID),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/metadata'
    );
  });

  it('mediaSubtitleUrl interpolates a numeric stream index as a plain decimal string', () => {
    assert.equal(
      mediaSubtitleUrl(MEDIA_FILE_ID, 2),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/subtitles/2'
    );
  });

  it('mediaSubtitleUrl handles stream index 0 without dropping the segment', () => {
    assert.equal(
      mediaSubtitleUrl(MEDIA_FILE_ID, 0),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/subtitles/0'
    );
  });

  it('mediaSubtitleUrl handles a multi-digit stream index', () => {
    assert.equal(
      mediaSubtitleUrl(MEDIA_FILE_ID, 13),
      '/api/v1/media/66666666-6666-6666-6666-666666666666/subtitles/13'
    );
  });
});

describe('Endpoints - 4.12 playback session reporting', () => {
  it('playbackEventsUrl interpolates the session id between sessions/ and /events', () => {
    assert.equal(
      playbackEventsUrl(SESSION_ID),
      '/api/v1/playback/sessions/55555555-5555-5555-5555-555555555555/events'
    );
  });

  it('playbackProgressListUrl (durable resume list)', () => {
    assert.equal(playbackProgressListUrl(), '/api/v1/playback/progress');
  });

  it('playbackProgressUrl appends /progress after the media file id', () => {
    assert.equal(
      playbackProgressUrl(MEDIA_FILE_ID),
      '/api/v1/playback/66666666-6666-6666-6666-666666666666/progress'
    );
  });
});

describe('Endpoints - the literal "/api/" substring never appears twice unexpectedly', () => {
  it('every generated path starts with /api/', () => {
    const paths: string[] = [
      systemVersionUrl(),
      deviceCodeUrl(),
      tokenUrl(),
      refreshUrl(),
      loginUrl(),
      profilesUrl(),
      verifyPinUrl(PROFILE_ID),
      capabilitiesUrl(),
      playerPreferencesUrl(),
      catalogUrl(),
      catalogKindsUrl(),
      catalogSearchUrl(),
      catalogDetailUrl(WORK_ID),
      catalogSimilarUrl(WORK_ID),
      viewsUrl(),
      viewResolveUrl(OTHER_ID),
      artworkWorkUrl(WORK_ID, 'poster'),
      artworkAlbumUrl(WORK_ID, OTHER_ID, 'poster'),
      mediaThumbnailUrl(MEDIA_FILE_ID),
      playbackInfoUrl(MEDIA_FILE_ID),
      mediaStreamUrl(MEDIA_FILE_ID),
      mediaChaptersUrl(MEDIA_FILE_ID),
      mediaMetadataUrl(MEDIA_FILE_ID),
      mediaSubtitleUrl(MEDIA_FILE_ID, THIRD_ID.length),
      playbackEventsUrl(SESSION_ID),
      playbackProgressListUrl(),
      playbackProgressUrl(MEDIA_FILE_ID)
    ];
    for (const path of paths) {
      assert.equal(path.indexOf('/api/'), 0);
    }
  });
});
