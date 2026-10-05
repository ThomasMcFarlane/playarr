import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const releaseScript = readFileSync(new URL('./release.sh', import.meta.url), 'utf8');

test('each platform invocation gets a distinct temporary signing keychain', () => {
  assert.match(
    releaseScript,
    /work="\$RUNNER_TEMP\/playarr-signing-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT-\$platform"/,
  );
  assert.match(releaseScript, /keychain="\$work\/playarr-signing\.keychain-db"/);
});

test('the temporary signing key allows codesign partition access', () => {
  assert.match(
    releaseScript,
    /security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "\$keychain_password" "\$keychain"/,
  );
});
