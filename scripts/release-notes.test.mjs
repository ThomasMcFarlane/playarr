import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseNotes, releaseSummary, unreleasedSections } from './release-notes.mjs';

const previous = `# Changelog

## [Unreleased]

### Added

- Old feature.

### Fixed

- Old fix
  spanning two lines.
`;

const current = `# Changelog

## [Unreleased]

### Added

- New feature.
- Old feature.

### Fixed

- Old fix
  spanning two lines.

## [0.0.1]

- Ancient entry.
`;

test('parses headings, entries and continuation lines', () => {
  assert.deepEqual(unreleasedSections(previous), [
    { heading: 'Added', entries: ['- Old feature.'] },
    { heading: 'Fixed', entries: ['- Old fix\n  spanning two lines.'] },
  ]);
});

test('lists only entries added since the previous release', () => {
  assert.equal(releaseNotes('1.2.3', current, previous), '## Playarr 1.2.3\n\n### Added\n\n- New feature.\n');
});

test('lists the whole Unreleased section for a first release', () => {
  const notes = releaseNotes('0.1.0', current);
  assert.match(notes, /- New feature\.\n- Old feature\./);
  assert.match(notes, /### Fixed\n\n- Old fix\n {2}spanning two lines\./);
  assert.doesNotMatch(notes, /Ancient entry/);
});

test('says so when nothing changed', () => {
  assert.equal(releaseNotes('1.0.1', previous, previous), '## Playarr 1.0.1\n\n- Maintenance release.\n');
});

test('summary keeps a few entries per category and counts the rest', () => {
  const many = `## [Unreleased]\n\n### Added\n\n${Array.from({ length: 5 }, (_, i) => `- Feature ${i}\n  more detail.`).join('\n')}\n`;
  assert.equal(
    releaseSummary('1.0.0', many, undefined, { perCategory: 2 }),
    '## Highlights\n\n### Added\n\n- Feature 0\n- Feature 1\n- …and 3 more\n',
  );
});

test('summary clips long entries on a word boundary and stays small', () => {
  const long = `## [Unreleased]\n\n### Fixed\n\n- ${'word '.repeat(100)}\n`;
  const summary = releaseSummary('1.0.0', long, undefined, { maxLength: 50 });
  assert.match(summary, /- word( word)+…\n$/);
  assert.ok(summary.length < 200);
  assert.equal(releaseSummary('1.0.1', previous, previous), '## Highlights\n\n- Maintenance release.\n');
});
