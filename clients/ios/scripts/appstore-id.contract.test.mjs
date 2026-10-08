import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The update deep link (itms-apps://itunes.apple.com/app/id<appStoreID>) must point at the real
// App Store record shared by iOS and tvOS, never the all-zero placeholder (row 288).
const source = readFileSync(
  new URL('../Sources/PlayarrApp/InstalledAppVersion.swift', import.meta.url),
  'utf8',
);

test('InstalledAppVersion.appStoreID is a real numeric App Store id', () => {
  const match = source.match(/static let appStoreID = "(\d+)"/);
  assert.ok(match, 'appStoreID constant not found');
  assert.match(match[1], /^[1-9]\d{8,10}$/);
  assert.ok(!/^0+$/.test(match[1]), 'appStoreID is still the placeholder');
});
