import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'fold-fragments.mjs');
const board = `# Tasks

## Active

| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |
|---|---|---|---|---|---|---|---|
| 1 | One | todo | | | | | a |
| 2 | Two | todo | | | | | b |
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

const H = '| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |';

test('a canonical fragment replaces its row in place and a new row creates an epic table', () => {
  const { r, tasks } = run({
    '1.md': '| 1 | One | in_progress | agent | feat/one | | 2026-10-10 14:00 ICT | a |\n',
    '3.md': 'section: Fresh epic\n| 3 | Three | todo | | | 1 | | c |\n',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(tasks, /^\| 1 \| One \| in_progress \| agent \| feat\/one \| \| 2026-10-10 14:00 ICT \| a \|$/m);
  assert.match(tasks, new RegExp(`## Fresh epic\\nETA: not set \\(1 open\\)\\n\\n${H.replace(/[|]/g, '\\$&')}\\n\\|---\\|---\\|---\\|---\\|---\\|---\\|---\\|---\\|\\n\\| 3 \\| Three \\| todo \\| \\| \\| 1 \\| \\| c \\|`));
});

test('a five-column fragment is converted, keeping the old status in Notes', () => {
  const { r, tasks } = run({ '1.md': '| 1 | One | on hold (native) | - | a |\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(tasks, /^\| 1 \| One \| blocked \| - \| \| \| \| a Previous status: on hold \(native\)\. \|$/m);
});

test('--check validates the board itself', () => {
  const bad = (text) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
    fs.writeFileSync(path.join(root, 'TASKS.md'), text);
    return spawnSync('node', [script, '--check', root], { encoding: 'utf8' });
  };
  assert.equal(bad(board).status, 0);
  assert.notEqual(bad(board.replace('| ID | Task', '| # | Task')).status, 0);
  assert.notEqual(bad(board.replace('| todo |', '| pending |')).status, 0);
  assert.notEqual(bad(board.replace('| One | todo |', '|  One  | todo |')).status, 0);
  assert.notEqual(bad(`${board}| 2 | Dup | todo | | | | | x |\n`).status, 0);
});

test('epic ETA line: latest open-row ETA in ICT with UK time, recomputed on every fold', () => {
  const rows = (...r) => `# Tasks\n\n## Active\n\n${H}\n|---|---|---|---|---|---|---|---|\n${r.join('\n')}\n\n## Closed\n\n${H}\n|---|---|---|---|---|---|---|---|\n| 8 | Eight | done | | | | 2026-10-10 09:00 ICT | x |\n`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), rows(
    '| 1 | One | todo | | | | | a |',
    '| 2 | Two | in_progress | | | | 2026-10-10 04:30 ICT | b |',
    '| 4 | Four | done | | | | 2026-10-12 04:30 ICT | d |',
  ).replace('## Active\n', '## Active\nETA: stale hand edit\n'));
  fs.writeFileSync(path.join(root, 'tasks.d', '3.md'), '| 2 | Two | in_progress | | | | 2026-10-10 05:00 ICT | b |\n');
  assert.equal(spawnSync('node', [script, root], { encoding: 'utf8' }).status, 0);
  let t = fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8');
  assert.match(t, /## Active\nETA: 2026-10-10 05:00 ICT \(2026-10-09 23:00 BST\) \(2 open\)\n\n\| ID/);
  assert.ok(!/## Closed\nETA/.test(t), 'epic with no open rows gets no line');
  // winter: BST ends, UK shows GMT; no ETA set: "not set"
  fs.writeFileSync(path.join(root, 'tasks.d', '2.md'), '| 2 | Two | in_progress | | | | 2026-12-10 05:00 ICT | b |\n');
  fs.writeFileSync(path.join(root, 'tasks.d', '9.md'), 'section: Fresh\n| 9 | Nine | todo | | | | | n |\n');
  assert.equal(spawnSync('node', [script, root], { encoding: 'utf8' }).status, 0);
  t = fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8');
  assert.match(t, /## Active\nETA: 2026-12-10 05:00 ICT \(2026-12-09 22:00 GMT\) \(2 open\)\n/);
  assert.match(t, /## Fresh\nETA: not set \(1 open\)\n/);
  assert.equal((t.match(/^ETA: /gm) ?? []).length, 2);
});
