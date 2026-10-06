import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseNotes, unreleasedSections } from './release-notes.mjs';

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
