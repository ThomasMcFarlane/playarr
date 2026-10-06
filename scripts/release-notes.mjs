#!/usr/bin/env node
// Release notes for the single all-platform release (.github/workflows/release.yml).
//
// Usage: node scripts/release-notes.mjs [--summary] <version> [<previous-tag>] > notes.md
// (--summary prints the short highlights used as the GitHub Release body instead of the full notes.)
//
// Takes the `## [Unreleased]` section of CHANGELOG.md at HEAD (the merge train folds
// `changelog.d/` fragments into it as PRs land) and, when a previous release tag is given,
// drops every entry that was already in that tag's `## [Unreleased]` section, so each release
// lists only what changed since the last one. Category headings with no new entries are left out.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Splits the Unreleased section into [{ heading, entries: [text] }], an entry being a `- ` line plus
// its indented continuation lines.
export function unreleasedSections(changelog) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]/i.test(line));
  if (start < 0) return [];
  const sections = [];
  let current;
  let entry;
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    if (/^### /.test(line)) {
      current = { heading: line.slice(4).trim(), entries: [] };
      sections.push(current);
      entry = undefined;
    } else if (/^- /.test(line)) {
      if (!current) {
        current = { heading: 'Changes', entries: [] };
        sections.push(current);
      }
      entry = line;
      current.entries.push(entry);
    } else if (entry !== undefined && /^\s+\S/.test(line)) {
      current.entries[current.entries.length - 1] += `\n${line}`;
    } else if (line.trim() === '') {
      entry = undefined;
    }
  }
  return sections;
}

export function releaseNotes(version, changelog, previousChangelog) {
  const seen = new Set(unreleasedSections(previousChangelog ?? '').flatMap((section) => section.entries));
  const parts = [];
  for (const section of unreleasedSections(changelog)) {
    const entries = section.entries.filter((entry) => !seen.has(entry));
    if (entries.length > 0) parts.push(`### ${section.heading}\n\n${entries.join('\n')}`);
  }
  const body = parts.length > 0 ? parts.join('\n\n') : '- Maintenance release.';
  return `## Playarr ${version}\n\n${body}\n`;
}

// A short body for the GitHub Release page (which caps a body at 125,000 characters): per category,
// the first few entries cut to their first line, and a count of the rest. The full notes are attached
// to the release as a file, so nothing is lost by summarising here.
export function releaseSummary(version, changelog, previousChangelog, { perCategory = 3, maxLength = 200 } = {}) {
  const seen = new Set(unreleasedSections(previousChangelog ?? '').flatMap((section) => section.entries));
  const clip = (entry) => {
    const line = entry.split('\n')[0].trim();
    if (line.length <= maxLength) return line;
    const cut = line.slice(0, maxLength - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd()}…`;
  };
  const parts = [];
  for (const section of unreleasedSections(changelog)) {
    const entries = section.entries.filter((entry) => !seen.has(entry));
    if (entries.length === 0) continue;
    const lines = entries.slice(0, perCategory).map(clip);
    if (entries.length > perCategory) lines.push(`- …and ${entries.length - perCategory} more`);
    parts.push(`### ${section.heading}\n\n${lines.join('\n')}`);
  }
  const body = parts.length > 0 ? parts.join('\n\n') : '- Maintenance release.';
  return `## Highlights\n\n${body}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const summary = args.includes('--summary');
  const [version, previousTag] = args.filter((arg) => arg !== '--summary');
  if (!version) {
    console.error('usage: release-notes.mjs [--summary] <version> [<previous-tag>]');
    process.exit(2);
  }
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const previous = previousTag
    ? execFileSync('git', ['show', `${previousTag}:CHANGELOG.md`], { encoding: 'utf8' })
    : undefined;
  process.stdout.write((summary ? releaseSummary : releaseNotes)(version, changelog, previous));
}
