import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const podfile = readFileSync(new URL('../Podfile', import.meta.url), 'utf8');

function targetBlock(name) {
  const lines = podfile.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `target '${name}' do`);
  assert.notEqual(start, -1, `missing CocoaPods target ${name}`);

  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*target\s+['"].+['"]\s+do\s*$/.test(line)) depth += 1;
    if (/^\s*end\s*$/.test(line)) depth -= 1;
    if (depth === 0) return lines.slice(start, index + 1).join('\n');
  }

  assert.fail(`unterminated CocoaPods target ${name}`);
}

test('hosted iOS app tests inherit the pinned Google Cast search paths', () => {
  const appTarget = targetBlock('PlayarrApp');
  const appTestsTarget = targetBlock('PlayarrAppTests');

  assert.match(appTarget, /pod 'google-cast-sdk', '= 4\.8\.6'/);
  assert.ok(appTarget.includes(appTestsTarget), 'PlayarrAppTests must be nested in PlayarrApp');
  assert.match(appTestsTarget, /inherit! :search_paths/);
});
