import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'board-sync.mjs');
const fold = path.join(path.dirname(new URL(import.meta.url).pathname), 'fold-fragments.mjs');
const H = '| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |\n|---|---|---|---|---|---|---|---|';
const board = `# Tasks

## Active

${H}
| 1 | One | in_review | a | | | 2099-01-01 00:00 ICT | Lands in #50. |
| 2 | Two | in_review | a | | | 2099-01-01 00:00 ICT | Uses PR 50 and #51. |
| 3 | Three | in_progress | a | | | 2099-01-01 00:00 ICT | PR open: #50 and #51 open. |
| 4 | Four | in_progress | a | | | 2099-01-01 00:00 ICT | PR open: #60. |
| 5 | Five | done | a | | | | PR #40 merged 2026-10-01; mentions #50 |
| 6 | Six | in_progress | a | | | 2099-01-01 00:00 ICT | Folded into #50. |
| 7 | Seven | in_progress | a | | | 2099-01-01 00:00 ICT | Web done; names #50 in passing. |
| 8 | Eight | in_review | a | | | 2099-01-01 00:00 ICT | Names nothing relevant (#99). |
`;

const sync = (args, fragments = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsync-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board);
  for (const [name, body] of Object.entries(fragments)) fs.writeFileSync(path.join(root, 'tasks.d', name), body);
  const r = spawnSync('node', [script, '--pr', '50', '--date', '2026-10-09', ...args, root], { encoding: 'utf8' });
  const folded = spawnSync('node', [fold, root], { encoding: 'utf8' });
  return { r, rows: r.stdout.split('\n').filter(Boolean), folded, board: fs.readFileSync(path.join(root, 'TASKS.md'), 'utf8'), root };
};
const status = (b, n) => new RegExp(`^\\| ${n} \\| [^|]* \\| ([^|]*) \\|`, 'm').exec(b)?.[1];
const notes = (b, n) => new RegExp(`^\\| ${n} \\|.*\\| ([^|]*) \\|$`, 'm').exec(b)?.[1];

test('flips rows that name the merged PR and leaves the rest', () => {
  const { r, rows, folded, board: b } = sync(['--open', '51,60']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(folded.status, 0, folded.stderr);
  assert.deepEqual(rows.sort(), ['1', '2', '3', '6']);
  assert.equal(status(b, 1), 'done');
  assert.match(notes(b, 1), /PR #50 merged 2026-10-09\.$/);
  assert.equal(status(b, 2), 'in_progress');
  assert.match(notes(b, 2), /PR #50 merged; #51 open\.$/);
  assert.equal(status(b, 3), 'in_progress');
  assert.match(notes(b, 3), /PR #50 merged; #51 open\.$/);
  assert.equal(status(b, 4), 'in_progress');
  assert.equal(notes(b, 4), 'PR open: #60.');
  assert.equal(status(b, 5), 'done');
  assert.equal(status(b, 6), 'done');
  assert.equal(status(b, 7), 'in_progress');
  assert.equal(status(b, 8), 'in_review');
});

test('a PR named as merged does not keep the row in progress', () => {
  const { board: out } = sync(['--open', '', '--merged', '51']);
  assert.equal(status(out, 3), 'done');
});

test('the pending fragment wins over the board row and keeps its section line', () => {
  const frag = 'section: Active\n| 9 | Nine | in_review | a | | | | PR open: #50 |\n';
  const { rows, folded, board: b } = sync([], { '9.md': frag });
  assert.ok(rows.includes('9'));
  assert.equal(folded.status, 0, folded.stderr);
  assert.equal(status(b, 9), 'done');
});

test('a pending five-column fragment is converted by the fold', () => {
  const frag = 'section: Active\n| 9 | Nine | in progress: PR open: #50 | a | n |\n';
  const { rows, folded, board: b } = sync([], { '9.md': frag });
  assert.ok(rows.includes('9'));
  assert.equal(folded.status, 0, folded.stderr);
  assert.equal(status(b, 9), 'done');
});

test('writes nothing and exits 0 when no row matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsync-'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board);
  const r = spawnSync('node', [script, '--pr', '777', '--date', '2026-10-09', root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(!fs.existsSync(path.join(root, 'tasks.d')));
});

test('rejects a missing PR number or date', () => {
  assert.equal(spawnSync('node', [script, '--pr', '1'], { encoding: 'utf8' }).status, 2);
});

test('--check rejects an in_review fragment that names no PR, a new row without a section, and bad cells', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsync-'));
  fs.mkdirSync(path.join(root, 'tasks.d'));
  fs.writeFileSync(path.join(root, 'TASKS.md'), board);
  const check = (name, body) => {
    fs.writeFileSync(path.join(root, 'tasks.d', name), body);
    const r = spawnSync('node', [fold, '--check', root], { encoding: 'utf8' });
    fs.rmSync(path.join(root, 'tasks.d', name));
    return r;
  };
  assert.notEqual(check('1.md', '| 1 | One | in_review | a | | | 2099-01-01 00:00 ICT | n |\n').status, 0);
  assert.equal(check('1.md', '| 1 | One | in_review | a | | | 2099-01-01 00:00 ICT | PR open: #50 |\n').status, 0);
  assert.notEqual(check('1.md', '| 1 | One | doing | a | | | | n |\n').status, 0);
  assert.notEqual(check('1.md', '| 1 | One | todo | a | | | tomorrow | n |\n').status, 0);
  assert.equal(check('1.md', '| 1 | One | todo | a | | | 2026-10-10 14:00 ICT | n |\n').status, 0);
  assert.notEqual(check('20.md', '| 20 | New | todo | a | | | | n |\n').status, 0);
  assert.equal(check('20.md', 'section: Active\n| 20 | New | todo | a | | | | n |\n').status, 0);
});
