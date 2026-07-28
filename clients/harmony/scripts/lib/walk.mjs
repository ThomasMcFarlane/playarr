// Recursive, synchronous file walker with an explicit include/exclude
// allow-list. Used by the Tier-0 offline validator's checks/*.mjs modules
// to enumerate the shippable source tree without pulling in any npm
// dependency (e.g. glob).

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} WalkOptions
 * @property {RegExp[]} include - a file is kept if its absolute path
 *   matches at least one of these patterns.
 * @property {string[]} [exclude] - directory *basenames* to prune entirely
 *   (e.g. ["build", "node_modules", "oh_modules", ".hvigor"]). Matching is
 *   exact against the directory's own name, not a path/glob match.
 */

/**
 * Walk `rootDir` synchronously and return a sorted array of absolute file
 * paths matching at least one `opts.include` pattern, never descending into
 * a directory whose basename is listed in `opts.exclude`.
 *
 * @param {string} rootDir
 * @param {WalkOptions} opts
 * @returns {string[]}
 */
export function walkFiles(rootDir, opts) {
  if (!opts || !Array.isArray(opts.include) || opts.include.length === 0) {
    throw new TypeError('walkFiles: opts.include must be a non-empty array of RegExp');
  }
  const include = opts.include;
  const excludeSet = new Set(Array.isArray(opts.exclude) ? opts.exclude : []);
  const absoluteRoot = path.resolve(rootDir);

  const results = [];

  function matchesInclude(filePath) {
    for (const pattern of include) {
      // Guard against stateful global/sticky regexes leaking lastIndex
      // across calls, which would otherwise make matches depend on
      // traversal order.
      pattern.lastIndex = 0;
      if (pattern.test(filePath)) {
        return true;
      }
    }
    return false;
  }

  function visitFile(filePath) {
    if (matchesInclude(filePath)) {
      results.push(filePath);
    }
  }

  function visitDir(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`walkFiles: failed to read directory '${dir}': ${err.message}`);
    }
    // Deterministic traversal order regardless of filesystem/readdir order;
    // the caller-visible result is sorted again at the end regardless.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        let stat;
        try {
          stat = statSync(entryPath);
        } catch {
          continue; // broken symlink target: skip silently
        }
        if (stat.isDirectory()) {
          if (!excludeSet.has(entry.name)) {
            visitDir(entryPath);
          }
        } else if (stat.isFile()) {
          visitFile(entryPath);
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (excludeSet.has(entry.name)) {
          continue;
        }
        visitDir(entryPath);
        continue;
      }

      if (entry.isFile()) {
        visitFile(entryPath);
      }
    }
  }

  visitDir(absoluteRoot);
  results.sort();
  return results;
}
