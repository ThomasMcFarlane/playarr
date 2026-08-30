import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findReleaseLifecycle,
  findInReviewVersionCodes,
  formatReleaseLifecycleEvidence,
  waitForReleaseLifecycle,
} from './release-lifecycle.mjs';

test('finds every version code currently in review', () => {
  assert.deepEqual(
    findInReviewVersionCodes([
      {
        activeArtifacts: [{ versionCode: 2017 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
      },
      {
        activeArtifacts: [{ versionCode: 21800704 }, { versionCode: 21800001 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ]),
    ['21800704', '21800001'],
  );
});

test('finds lifecycle state by active artifact version code', () => {
  const lifecycle = findReleaseLifecycle(
    [
      {
        activeArtifacts: [{ versionCode: 2017 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
      },
      {
        activeArtifacts: [{ versionCode: 21800704 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ],
    '21800704',
  );

  assert.equal(lifecycle, 'RELEASE_LIFECYCLE_STATE_IN_REVIEW');
});

test('claims track availability only for a published release', () => {
  assert.match(
    formatReleaseLifecycleEvidence(
      'alpha',
      '21800704',
      'RELEASE_LIFECYCLE_STATE_PUBLISHED',
    ),
    /available to users on the track/,
  );
  assert.match(
    formatReleaseLifecycleEvidence(
      'alpha',
      '21800704',
      'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
    ),
    /lifecycle=IN_REVIEW; this does not prove tester availability/,
  );
  assert.match(
    formatReleaseLifecycleEvidence(
      'alpha',
      '21800704',
      'RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW',
    ),
    /this does not prove tester availability/,
  );
});

test('waits for the committed version to appear in lifecycle results', async () => {
  const responses = [
    [],
    [
      {
        activeArtifacts: [{ versionCode: 21800704 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ],
  ];
  let sleeps = 0;

  const lifecycle = await waitForReleaseLifecycle(
    async () => responses.shift(),
    '21800704',
    {
      attempts: 2,
      delayMs: 0,
      sleep: async () => {
        sleeps += 1;
      },
    },
  );

  assert.equal(lifecycle, 'RELEASE_LIFECYCLE_STATE_IN_REVIEW');
  assert.equal(sleeps, 1);
});
