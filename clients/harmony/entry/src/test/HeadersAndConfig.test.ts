// entry/src/test/HeadersAndConfig.test.ts
//
// core/Headers.ts: buildHeaders/buildJsonBodyHeaders produce exactly
// Accept, X-Playarr-Client-Platform, X-Playarr-Client-Version, and
// Authorization only when the token is non-empty -- with the Bearer prefix
// having exactly one space and correct case (brief section 4.1).
//
// core/AppConfig.ts: resolveClientPlatform maps device types to the two
// ClientPlatform wire names correctly (brief section 1 / 6.1).
//
// Plain node:test / node:assert. No ArkUI, no @kit./@ohos. imports.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIENT_PLATFORM_HEADER,
  CLIENT_VERSION_HEADER,
  buildHeaders,
  buildJsonBodyHeaders
} from '../main/ets/core/Headers';

import {
  HARMONY_MOBILE_PLATFORM,
  HARMONY_TV_PLATFORM,
  resolveClientPlatform
} from '../main/ets/core/AppConfig';

const PLATFORM = HARMONY_MOBILE_PLATFORM;
const VERSION = '0.1.0';
const TOKEN = 'header.payload.signature';

function sortedKeys(headers: Map<string, string>): string[] {
  const keys: string[] = Array.from(headers.keys());
  return keys.slice().sort();
}

describe('Headers - header name constants', () => {
  it('CLIENT_PLATFORM_HEADER is exactly the contract literal', () => {
    assert.equal(CLIENT_PLATFORM_HEADER, 'x-playarr-client-platform');
  });

  it('CLIENT_VERSION_HEADER is exactly the contract literal', () => {
    assert.equal(CLIENT_VERSION_HEADER, 'x-playarr-client-version');
  });
});

describe('Headers - buildHeaders with a non-empty access token', () => {
  const headers: Map<string, string> = buildHeaders(PLATFORM, VERSION, TOKEN);

  it('carries exactly four keys: Accept, platform, version, Authorization', () => {
    assert.deepEqual(
      sortedKeys(headers),
      ['Accept', 'Authorization', CLIENT_PLATFORM_HEADER, CLIENT_VERSION_HEADER].slice().sort()
    );
  });

  it('Accept is application/json', () => {
    assert.equal(headers.get('Accept'), 'application/json');
  });

  it('does not carry a Content-Type (JSON body headers are a separate builder)', () => {
    assert.equal(headers.has('Content-Type'), false);
  });

  it('X-Playarr-Client-Platform carries the resolved platform wire name', () => {
    assert.equal(headers.get(CLIENT_PLATFORM_HEADER), PLATFORM);
  });

  it('X-Playarr-Client-Version carries clientVersion verbatim', () => {
    assert.equal(headers.get(CLIENT_VERSION_HEADER), VERSION);
  });

  it('Authorization is present with the Bearer scheme', () => {
    assert.equal(headers.has('Authorization'), true);
  });

  it('Authorization value is exactly "Bearer " + token, one space, capital B', () => {
    const value: string = headers.get('Authorization') as string;
    assert.equal(value, 'Bearer ' + TOKEN);
  });

  it('Authorization prefix has exactly one space between scheme and token', () => {
    const value: string = headers.get('Authorization') as string;
    assert.equal(value.charAt(6), ' ');
    assert.notEqual(value.charAt(7), ' ');
    assert.equal(value.indexOf('Bearer  '), -1);
  });

  it('Authorization prefix case is exactly "Bearer", never "bearer" or "BEARER"', () => {
    const value: string = headers.get('Authorization') as string;
    assert.equal(value.indexOf('Bearer '), 0);
    assert.equal(value.indexOf('bearer '), -1);
    assert.equal(value.indexOf('BEARER '), -1);
  });

  it('header keys use the documented case exactly (Map keys are case-sensitive)', () => {
    assert.equal(headers.has('accept'), false);
    assert.equal(headers.has('authorization'), false);
  });
});

describe('Headers - buildHeaders omits Authorization for a null token', () => {
  const headers: Map<string, string> = buildHeaders(PLATFORM, VERSION, null);

  it('carries exactly three keys: Accept, platform, version', () => {
    assert.deepEqual(
      sortedKeys(headers),
      ['Accept', CLIENT_PLATFORM_HEADER, CLIENT_VERSION_HEADER].slice().sort()
    );
  });

  it('has no Authorization key at all', () => {
    assert.equal(headers.has('Authorization'), false);
  });
});

describe('Headers - buildHeaders omits Authorization for an empty-string token', () => {
  const headers: Map<string, string> = buildHeaders(PLATFORM, VERSION, '');

  it('carries exactly three keys: Accept, platform, version', () => {
    assert.deepEqual(
      sortedKeys(headers),
      ['Accept', CLIENT_PLATFORM_HEADER, CLIENT_VERSION_HEADER].slice().sort()
    );
  });

  it('has no Authorization key -- an empty bearer token is treated as absent', () => {
    assert.equal(headers.has('Authorization'), false);
  });
});

describe('Headers - buildHeaders falls back to "unknown" for an empty clientVersion', () => {
  it('records the literal "unknown" when clientVersion is empty', () => {
    const headers: Map<string, string> = buildHeaders(PLATFORM, '', TOKEN);
    assert.equal(headers.get(CLIENT_VERSION_HEADER), 'unknown');
  });

  it('does not fall back when clientVersion is a real, non-empty value', () => {
    const headers: Map<string, string> = buildHeaders(PLATFORM, VERSION, TOKEN);
    assert.equal(headers.get(CLIENT_VERSION_HEADER), VERSION);
  });
});

describe('Headers - buildHeaders always sends the platform header, even for an unrecognised value', () => {
  it('an unknown platform string is still sent verbatim (server falls back to Web itself)', () => {
    const headers: Map<string, string> = buildHeaders('totally-unknown-platform', VERSION, null);
    assert.equal(headers.get(CLIENT_PLATFORM_HEADER), 'totally-unknown-platform');
  });
});

describe('Headers - buildJsonBodyHeaders', () => {
  it('adds Content-Type: application/json on top of buildHeaders, with a token', () => {
    const plain: Map<string, string> = buildHeaders(PLATFORM, VERSION, TOKEN);
    const withBody: Map<string, string> = buildJsonBodyHeaders(PLATFORM, VERSION, TOKEN);

    assert.equal(withBody.get('Content-Type'), 'application/json');
    assert.equal(sortedKeys(withBody).length, sortedKeys(plain).length + 1);
    assert.equal(withBody.get('Accept'), plain.get('Accept'));
    assert.equal(withBody.get(CLIENT_PLATFORM_HEADER), plain.get(CLIENT_PLATFORM_HEADER));
    assert.equal(withBody.get(CLIENT_VERSION_HEADER), plain.get(CLIENT_VERSION_HEADER));
    assert.equal(withBody.get('Authorization'), plain.get('Authorization'));
  });

  it('adds Content-Type: application/json on top of buildHeaders, without a token', () => {
    const withBody: Map<string, string> = buildJsonBodyHeaders(PLATFORM, VERSION, null);
    assert.deepEqual(
      sortedKeys(withBody),
      ['Accept', 'Content-Type', CLIENT_PLATFORM_HEADER, CLIENT_VERSION_HEADER].slice().sort()
    );
    assert.equal(withBody.has('Authorization'), false);
  });
});

describe('AppConfig - platform wire name constants', () => {
  it('HARMONY_MOBILE_PLATFORM is the exact contract literal', () => {
    assert.equal(HARMONY_MOBILE_PLATFORM, 'harmony-mobile');
  });

  it('HARMONY_TV_PLATFORM is the exact contract literal', () => {
    assert.equal(HARMONY_TV_PLATFORM, 'harmony-tv');
  });
});

describe('AppConfig - resolveClientPlatform', () => {
  it('deviceType "tv" resolves to HARMONY_TV_PLATFORM', () => {
    assert.equal(resolveClientPlatform('tv'), HARMONY_TV_PLATFORM);
  });

  const mobileDeviceTypes: string[] = ['phone', 'tablet', '2in1', 'default', 'wearable', 'car'];
  for (const deviceType of mobileDeviceTypes) {
    it('deviceType "' + deviceType + '" resolves to HARMONY_MOBILE_PLATFORM', () => {
      assert.equal(resolveClientPlatform(deviceType), HARMONY_MOBILE_PLATFORM);
    });
  }

  it('an unrecognised deviceType degrades safely to HARMONY_MOBILE_PLATFORM, never HARMONY_TV_PLATFORM', () => {
    assert.equal(resolveClientPlatform('some-future-device-type'), HARMONY_MOBILE_PLATFORM);
  });

  it('an empty deviceType string also degrades to HARMONY_MOBILE_PLATFORM', () => {
    assert.equal(resolveClientPlatform(''), HARMONY_MOBILE_PLATFORM);
  });

  it('deviceType matching is exact and case-sensitive -- "TV" is not "tv"', () => {
    assert.equal(resolveClientPlatform('TV'), HARMONY_MOBILE_PLATFORM);
  });
});
