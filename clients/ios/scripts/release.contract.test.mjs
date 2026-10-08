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

test('the version preparation step runs after the upload and is skipped on dry runs', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ios-release.yml', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: Prepare App Store draft version and attach build'));
  assert.ok(workflow.indexOf('Sign, export IPA and upload once') < workflow.indexOf('Prepare App Store draft version'));
  assert.match(step, /if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(step, /asc_prepare_version\.py/);
});

test('the marketing version falls back to version.properties, not a hard-coded default', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ios-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /PLAYARR_VERSION_NAME=/);
  assert.match(workflow, /clients\/android\/version\.properties/);
  assert.doesNotMatch(workflow, /:-1\.0\.0/);
  assert.doesNotMatch(workflow, /tag version or 1\.0\.0/);
});

test('the external TestFlight group step runs after the draft step, reads the variable and never fails the upload', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ios-release.yml', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: Add the build to the external TestFlight groups'));
  assert.ok(workflow.indexOf('Prepare App Store draft version') < workflow.indexOf('Add the build to the external TestFlight groups'));
  assert.match(step, /TESTFLIGHT_EXTERNAL_GROUP_IDS: \$\{\{ vars\.TESTFLIGHT_EXTERNAL_GROUP_IDS \}\}/);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /--plan/);
  assert.doesNotMatch(step, /0c41229a/);
});
