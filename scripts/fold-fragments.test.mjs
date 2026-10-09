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
  assert.match(tasks, new RegExp(`## Fresh epic\\n\\n${H.replace(/[|]/g, '\\$&')}\\n\\|---\\|---\\|---\\|---\\|---\\|---\\|---\\|---\\|\\n\\| 3 \\| Three \\| todo \\| \\| \\| 1 \\| \\| c \\|`));
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

test('fold does not write epic ETA lines under headings', () => {
  const { r, tasks } = run({ '1.md': '| 1 | One | in_progress | agent | | | 2026-10-10 14:00 ICT | a |\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/^ETA: /m.test(tasks));
  assert.match(tasks, /## Active\n\n\| ID/);
});

test('fold drops legacy epic ETA lines left under headings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board.replace('## Active\n', '## Active\nETA: 2026-10-10 05:00 ICT (2026-10-09 23:00 BST) (2 open)\n'));
  fs.writeFileSync(path.join(root, 'tasks.d', '1.md'), '| 1 | One | todo | | | | | a |\n');
  assert.equal(spawnSync('node', [script, root], { encoding: 'utf8' }).status, 0);
  assert.ok(!/^ETA: /m.test(fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8')));
});

test('--check: open rows need a valid ETA; a past ETA only warns', () => {
  const frag = (status, eta, notes = 'a') => ({ '1.md': `| 1 | One | ${status} | agent | | | ${eta} | ${notes} |\n` });
  const chk = (f, now = '2026-10-10T00:00:00Z') => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
    fs.mkdirSync(path.join(root, 'tasks.d'));
    fs.writeFileSync(path.join(root, 'TASKS.md'), board);
    for (const [n, b] of Object.entries(f)) fs.writeFileSync(path.join(root, 'tasks.d', n), b);
    return spawnSync('node', [script, '--check', root], { encoding: 'utf8', env: { ...process.env, FOLD_NOW: now } });
  };
  // missing ETA fails
  assert.notEqual(chk(frag('in_progress', ' ')).status, 0);
  assert.notEqual(chk(frag('in_review', ' ', 'PR open: #5')).status, 0);
  // valid future ETA passes without warning
  let r = chk(frag('in_progress', '2026-10-10 14:00 ICT'));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/warning/.test(r.stderr));
  // past ETA warns, exit 0
  r = chk(frag('in_progress', '2026-10-09 14:00 ICT'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /warning: .*row 1: ETA 2026-10-09 14:00 ICT is in the past/);
  // other statuses need no ETA
  assert.equal(chk(frag('todo', ' ')).status, 0);
  assert.equal(chk(frag('done', ' ')).status, 0);
  assert.equal(chk(frag('parked', ' ', 'Parked by owner 2026-10-09: hold; resumes when web is done')).status, 0);
});

test('--check applies the ETA rule to the board itself', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  const check = (text) => {
    fs.writeFileSync(path.join(root, 'TASKS.md'), text);
    return spawnSync('node', [script, '--check', root], { encoding: 'utf8', env: { ...process.env, FOLD_NOW: '2026-10-10T00:00:00Z' } });
  };
  assert.notEqual(check(board.replace('| 1 | One | todo |', '| 1 | One | in_progress |')).status, 0);
  const past = check(board.replace('| 1 | One | todo | | | | |', '| 1 | One | in_progress | a | | | 2026-10-09 01:00 ICT |'));
  assert.equal(past.status, 0, past.stderr);
  assert.match(past.stderr, /warning: TASKS\.md line \d+: row 1: ETA .* in the past/);
});

test('--check judges the board as it will be after the fragments fold', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board.replace('| 1 | One | todo |', '| 1 | One | in_progress |'));
  const check = () => spawnSync('node', [script, '--check', root], { encoding: 'utf8', env: { ...process.env, FOLD_NOW: '2026-10-10T00:00:00Z' } });
  assert.notEqual(check().status, 0);
  fs.writeFileSync(path.join(root, 'tasks.d', '1.md'), '| 1 | One | todo | | | | | a |\n');
  assert.equal(check().status, 0, check().stderr);
});
