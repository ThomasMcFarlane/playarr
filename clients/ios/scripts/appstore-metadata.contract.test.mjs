import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) =>
  readFileSync(new URL(`../fastlane/metadata/en-GB/${name}`, import.meta.url), 'utf8').trim();

// Apple App Store Connect field limits.
const limits = {
  'name.txt': 30,
  'subtitle.txt': 30,
  'keywords.txt': 100,
  'promotional_text.txt': 170,
  'description.txt': 4000,
  'release_notes.txt': 4000,
  'review_information/notes.txt': 4000,
};

for (const [file, max] of Object.entries(limits)) {
  test(`${file} is non-empty and within ${max} characters`, () => {
    const text = read(file);
    assert.ok(text.length > 0);
    assert.ok(text.length <= max, `${file} has ${text.length} characters`);
  });
}

test('URLs are https and contact is the support address', () => {
  for (const f of ['marketing_url.txt', 'support_url.txt', 'privacy_url.txt']) {
    assert.match(read(f), /^https:\/\/playarr\.app(\/|$)/);
  }
  assert.equal(read('review_information/email_address.txt'), 'support@playarr.app');
});

test('review notes carry no credentials', () => {
  assert.doesNotMatch(read('review_information/notes.txt'), /password\s*[:=]/i);
});
