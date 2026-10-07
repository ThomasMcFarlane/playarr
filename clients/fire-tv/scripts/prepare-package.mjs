/**
 * Pre-build gate, in the same spirit as
 * clients/tv-web/apps/tv-webos/scripts/prepare-package.mjs (design doc §2's
 * own cross-reference) -- catch a drifted version string or a malformed
 * icon before a slow SDK build fails on it, or worse, ships it. The webOS
 * version ALSO assembles its IPK's file tree by hand (it copies
 * appinfo.json/icons/dist output into place itself); this one does not,
 * because `react-native build-vega` already owns turning this project
 * into a `.vpkg` -- there is no equivalent manual packaging step for this
 * script to also perform, so it is pure validation, nothing more.
 *
 * manifest.toml is read with a few small, targeted regexes rather than a
 * real TOML parser: this project's dependency list (design doc §3) has no
 * TOML library in it, and adding one purely for a handful of known,
 * hand-written fields in a file this project itself authors would be a
 * disproportionate dependency for what it buys. This is the same
 * "harvest what a full parse would otherwise give you" discipline
 * `theme/tokens.ts`'s CSS-colour harvesting already uses -- see that
 * file's own comment.
 */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reads a PNG's width/height straight out of its IHDR chunk -- no image library needed for two integers. Same technique as the tv-webos script's own `readPngDimensions`. */
export function readPngDimensions(contents, fileName) {
  if (
    contents.length < 24 ||
    !contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    contents.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error(`${fileName} must be a PNG image`);
  }
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

/**
 * Extracts `key = "value"` from a named TOML table (`[package]`) or
 * array-of-tables (`[[components.interactive]]`) heading, up to the next
 * heading or end of file. `heading` is the PLAIN, unescaped heading text
 * (e.g. `'[package]'`, brackets and all, not `'\\[package\\]'`) -- this
 * function does its own regex-escaping internally, exactly once; passing
 * an already-escaped heading here would escape it a second time and match
 * nothing.
 *
 * The heading match is anchored to the START of a line (`^`, multiline
 * mode) and to the END of that same line (`\s*$`) rather than matched
 * anywhere in the text -- found the hard way, running this against this
 * project's OWN manifest.toml: its header comment block explains
 * manifest.toml's `[package]` version in prose, and an unanchored match
 * latched onto that mention instead of the real heading several lines
 * later, since a plain substring search has no way to prefer "this is TOML
 * syntax" over "this is inside a comment". A real TOML heading always
 * starts its own line with nothing else on it; a comment mentioning one in
 * passing usually doesn't, and anchoring both ends of the line is what
 * tells the two apart.
 *
 * The section body's END boundary is found with a plain `indexOf('\n[',
 * …)`, deliberately not folded into the same regex as the heading match --
 * also found the hard way: `$` inside a MULTILINE-flagged regex matches
 * the end of the CURRENT line, not the end of the string, so a lazy
 * `[\s\S]*?` followed by `(?:\n\[|$)` was matching zero characters and
 * stopping immediately at the end of the heading's own line every time,
 * long before reaching the next real heading.
 */
export function tomlStringField(tomlText, heading, key) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingMatch = tomlText.match(new RegExp(`^${escapedHeading}[ \\t]*$`, 'm'));
  if (!headingMatch || headingMatch.index === undefined) return undefined;

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingIndex = tomlText.indexOf('\n[', sectionStart);
  const sectionBody =
    nextHeadingIndex === -1 ? tomlText.slice(sectionStart) : tomlText.slice(sectionStart, nextHeadingIndex);

  const fieldMatch = sectionBody.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return fieldMatch?.[1];
}

function assertSquareIcon(fileName, {width, height}) {
  // Vega's actual required icon pixel dimensions are not documented
  // anywhere this design's research reached (design doc's own icon-size
  // web search came back empty-handed) -- this is deliberately a loose,
  // sanity-only check (square, not tiny) rather than a specific number
  // presented as verified fact it is not.
  if (width !== height) {
    throw new Error(`${fileName} must be square (received ${width}x${height}px)`);
  }
  if (width < 256) {
    throw new Error(`${fileName} is only ${width}x${height}px -- too small for a TV launcher icon`);
  }
}

function assertWidescreenIcon(fileName, {width, height}) {
  const aspect = width / height;
  const targetAspect = 16 / 9;
  if (Math.abs(aspect - targetAspect) > 0.02) {
    throw new Error(`${fileName} must be 16:9 (received ${width}x${height}px, aspect ${aspect.toFixed(3)})`);
  }
  if (width < 960) {
    throw new Error(`${fileName} is only ${width}x${height}px -- too small for a TV banner icon`);
  }
}

function assertSemver(value, fieldDescription) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) {
    throw new Error(`${fieldDescription} must be a plain "major.minor.patch" version (received ${JSON.stringify(value)})`);
  }
}

export async function preparePackage({sourceRoot = projectRoot} = {}) {
  const [manifestToml, packageJsonText] = await Promise.all([
    readFile(path.join(sourceRoot, 'manifest.toml'), 'utf8'),
    readFile(path.join(sourceRoot, 'package.json'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageJsonText);

  const manifestVersion = tomlStringField(manifestToml, '[package]', 'version');
  assertSemver(manifestVersion, 'manifest.toml\'s [package] version');
  assertSemver(packageJson.version, 'package.json\'s "version"');
  if (manifestVersion !== packageJson.version) {
    throw new Error(
      `manifest.toml's [package] version (${manifestVersion}) does not match package.json's "version" (${packageJson.version})`
    );
  }

  // Cheap, high-value correctness check beyond design doc's original
  // three-item list: index.js's AppRegistry.registerComponent name (from
  // app.json) MUST equal manifest.toml's [[components.interactive]] id --
  // that string is how the Vega runtime tells KeplerScript which
  // registered component to mount, and a silent mismatch here would be
  // "the app installs but the launcher tile does nothing", diagnosable
  // only on real hardware.
  const appJson = JSON.parse(await readFile(path.join(sourceRoot, 'app.json'), 'utf8'));
  const componentId = tomlStringField(manifestToml, '[[components.interactive]]', 'id');
  if (componentId !== appJson.name) {
    throw new Error(
      `manifest.toml's [[components.interactive]] id (${componentId}) does not match app.json's "name" (${appJson.name}) -- AppRegistry.registerComponent would register under a name the manifest never launches`
    );
  }

  const iconField = tomlStringField(manifestToml, '[package]', 'icon');
  if (!iconField?.startsWith('@image/')) {
    throw new Error(`manifest.toml's [package] icon must be an "@image/…" reference (received ${JSON.stringify(iconField)})`);
  }
  const iconFileName = iconField.slice('@image/'.length);
  const iconPath = path.join(sourceRoot, 'assets', 'image', iconFileName);
  const iconContents = await readFile(iconPath).catch(() => {
    throw new Error(`manifest.toml references assets/image/${iconFileName}, but that file does not exist`);
  });
  assertSquareIcon(iconFileName, readPngDimensions(iconContents, iconFileName));

  const largeIconPath = path.join(sourceRoot, 'assets', 'image', 'PlayarrLargeIcon.png');
  const largeIconContents = await readFile(largeIconPath).catch(() => {
    throw new Error('assets/image/PlayarrLargeIcon.png does not exist');
  });
  assertWidescreenIcon('PlayarrLargeIcon.png', readPngDimensions(largeIconContents, 'PlayarrLargeIcon.png'));

  // No leftover local-dev proxy config shipped in a release build (design
  // doc §2's own description of this script's job).
  const proxyConfigExists = await readFile(path.join(sourceRoot, 'proxy-config.json'))
    .then(() => true)
    .catch(() => false);
  if (proxyConfigExists) {
    throw new Error(
      'proxy-config.json exists at the project root -- this is local dev-only state and must never ship in a package; delete it (or add it to .gitignore if a real dev workflow needs it to exist locally)'
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await preparePackage();
    console.log('prepare-package: OK');
  } catch (error) {
    console.error(`prepare-package: ${error.message}`);
    process.exitCode = 1;
  }
}
