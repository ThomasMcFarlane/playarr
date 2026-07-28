#!/usr/bin/env node
/**
 * Copy compliance linter for the Streamarr marketing site.
 *
 * Why this exists: `docs/artifacts/streamarr-legal-release.html` concludes that
 * for projects of this shape the exposure surface is the *marketing*, not the
 * code — TickBox, Grokster and Filmspeler were each sunk primarily by their own
 * promotional conduct. This script mechanically enforces the resulting
 * copywriting rules so a stray sentence cannot reach production.
 *
 * Three severities:
 *   error   Hard fail. Acquisition-adjacent or adult-content-adjacent language,
 *           neither of which may appear anywhere on the site.
 *   claim   Fail unless the same file carries an explicit status qualifier
 *           (Planned / Preview / Not built yet / Experimental / Source-only),
 *           so unreleased capability is never presented as shipped.
 *   review  Ambiguous wording that is fine in the right sentence. Reported for
 *           a human to read; does not fail the build.
 *
 * Usage: node scripts/check-copy.mjs [--strict]
 *        --strict also fails on `review` hits.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN_DIRS = ['src', 'public']
const SCAN_EXT = new Set(['.astro', '.md', '.mdx', '.ts', '.tsx', '.js', '.mjs', '.html', '.json', '.svg', '.txt'])

/** This file necessarily contains every banned term; never scan it. */
const SELF = basename(fileURLToPath(import.meta.url))

/**
 * Acquisition-adjacent. Streamarr plays media the operator already holds; the
 * site must never imply it finds, fetches, indexes or obtains anything.
 */
const ACQUISITION = [
  'acquisition', 'acquire content', 'download client', 'downloader', 'grabber',
  'indexer', 'indexers', 'tracker', 'trackers',
  'torrent', 'torrents', 'torrenting', 'magnet link',
  'usenet', 'nzb', 'newsgroup', 'newsgroups', 'news server',
  'seedbox', 'seeding', 'seeders', 'leechers', 'swarm', 'peer-to-peer', 'p2p',
  'debrid', 'real-debrid', 'alldebrid', 'premiumize',
  'scene release', 'scene group', 'warez', '0day',
  'piracy', 'pirate', 'pirated', 'pirating', 'high seas', 'sail the seas',
  'free movies', 'free tv', 'free streaming', 'watch anything', 'watch everything',
  'get any movie', 'any movie you want', 'unlimited movies', 'unlimited content',
  'cancel netflix', 'cancel your subscription', 'cancel subscriptions',
  'no more subscriptions', 'replace netflix', 'ditch netflix', 'ditch your subscriptions',
  'stop paying for streaming',
  'strip drm', 'bypass drm', 'remove drm', 'keygen', 'cracked',
  'region unlock', 'geo-unblock', 'unblock',
  'linux isos', 'totally legal', 'definitely legal', '100% legal', 'legal grey area',
]

/**
 * Adult-content-adjacent. The integration exists in the backend but must not
 * appear on the site in any form, including screenshots and alt text.
 */
const ADULT = [
  'whisparr', 'tpdb', 'theporndb', 'stashapp',
  'adult content', 'adult media', 'adult site', 'adult sites', 'adult studio',
  'xxx', 'porn', 'pornography', 'nsfw', 'erotic', 'explicit content',
]

/**
 * Capability that is not generally available. Allowed only alongside a status
 * qualifier in the same file.
 */
const CLAIMS = [
  'app store', 'google play', 'lg content store', 'samsung apps', 'roku channel store',
  'widevine', 'fairplay', 'playready',
  'chromecast', 'airplay',
  'offline downloads', 'download for offline',
  'push notifications',
  'production-ready', 'production-tested', 'battle-tested', 'enterprise-grade',
  'guaranteed uptime',
]

const QUALIFIER = /\b(planned|preview|not built yet|not yet built|experimental|source-only|in progress|roadmap|coming later|beta)\b/i

/** Fine in the right sentence; a human should confirm each one. */
const REVIEW = [
  'download', 'search', 'source', 'scene', 'rip', 'remux', 'encode',
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toRe = (term) =>
  new RegExp(`(?<![\\w-])${escape(term).replace(/\s+/g, '[\\s\\u00a0-]+')}(?![\\w-])`, 'gi')

const RULES = [
  ...ACQUISITION.map((t) => ({ term: t, severity: 'error', reason: 'acquisition-adjacent' })),
  ...ADULT.map((t) => ({ term: t, severity: 'error', reason: 'adult-content-adjacent' })),
  ...CLAIMS.map((t) => ({ term: t, severity: 'claim', reason: 'unreleased capability' })),
  ...REVIEW.map((t) => ({ term: t, severity: 'review', reason: 'ambiguous — confirm the sentence' })),
].map((rule) => ({ ...rule, re: toRe(rule.term) }))

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.astro' || name === 'dist') continue
      yield* walk(full)
    } else if (SCAN_EXT.has(extname(name)) && name !== SELF) {
      yield full
    }
  }
}

const findings = []

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const text = readFileSync(file, 'utf8')
    const qualified = QUALIFIER.test(text)
    const lines = text.split('\n')

    for (const rule of RULES) {
      if (rule.severity === 'claim' && qualified) continue
      rule.re.lastIndex = 0
      let match
      while ((match = rule.re.exec(text)) !== null) {
        const before = text.slice(0, match.index)
        const line = before.split('\n').length
        findings.push({
          file: relative(ROOT, file),
          line,
          severity: rule.severity,
          term: match[0],
          reason: rule.reason,
          context: (lines[line - 1] ?? '').trim().slice(0, 140),
        })
      }
    }
  }
}

const strict = process.argv.includes('--strict')
const bySeverity = (s) => findings.filter((f) => f.severity === s)
const errors = [...bySeverity('error'), ...bySeverity('claim')]
const reviews = bySeverity('review')

const print = (list, label) => {
  if (list.length === 0) return
  console.log(`\n${label} (${list.length})`)
  for (const f of list) {
    console.log(`  ${f.file}:${f.line}  "${f.term}"  — ${f.reason}`)
    console.log(`      ${f.context}`)
  }
}

print(errors, 'BLOCKING')
if (strict || reviews.length > 0) print(reviews, 'REVIEW (non-blocking)')

if (errors.length > 0) {
  console.error(`\n✗ copy check failed: ${errors.length} blocking finding(s).`)
  process.exit(1)
}

if (strict && reviews.length > 0) {
  console.error(`\n✗ copy check failed in strict mode: ${reviews.length} review finding(s).`)
  process.exit(1)
}

console.log(`\n✓ copy check passed${reviews.length ? ` (${reviews.length} for human review)` : ''}.`)
