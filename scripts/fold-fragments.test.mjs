import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'fold-fragments.mjs');
const board = `# Tasks

## Active

| # | Task | Status | Picked up by | Notes |
|---|------|--------|--------------|-------|
| 1 | One | pending | - | a |
| 2 | Two | pending | - | b |
`;

const run = (fragments, extra = []) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board);
  for (const [name, body] of Object.entries(fragments)) fs.writeFileSync(path.join(root, 'tasks.d', name), body);
  const r = spawnSync('node', [script, ...extra, root], { encoding: 'utf8' });
  return { r, root, tasks: fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8') };
};

test('remove fragment deletes the row and the fragment', () => {
  const { r, root, tasks } = run({ '1.md': 'remove: 1\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/^\| 1 \|/m.test(tasks));
  assert.ok(/^\| 2 \|/m.test(tasks));
  assert.ok(!fs.existsSync(path.join(root, 'tasks.d', '1.md')));
});

test('removing an unknown row fails', () => {
  assert.notEqual(run({ '9.md': 'remove: 9\n' }).r.status, 0);
});

test('--check accepts remove lines and rejects junk', () => {
  assert.equal(run({ '1.md': 'remove: 1\n' }, ['--check']).r.status, 0);
  assert.notEqual(run({ '1.md': 'remove 1\n' }, ['--check']).r.status, 0);
});
