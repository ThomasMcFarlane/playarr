// Check 6 -- source contract (brief section 7.1).
//
// Pins a short list of literal substrings and architectural facts into
// specific files, cross-referenced against the server contract research in
// brief section 4. Fragments are kept short and format-independent on
// purpose (see the brief) -- this is not a full parse of Endpoints.ts, just
// grep-shaped assertions that the load-bearing wire literals really are
// present, verbatim, somewhere in the pinned file.
//
// Because later slices of this client have not landed yet, a referenced
// file that does not exist AT ALL is a SKIP (recorded in `warnings`), never
// a failure -- this check only fails once a file exists but is missing one
// of its required substrings (or contains a forbidden one). That is what
// lets this validator keep passing incrementally as the client is built
// out slice by slice.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseJson5 } from '../lib/json5.mjs';

const ENDPOINT_PATH_LITERALS = [
  '/api/system/version',
  '/api/v1/oauth/device/code',
  '/api/v1/oauth/token',
  '/api/v1/auth/refresh',
  '/api/v1/auth/login',
  '/api/v1/users/profiles',
  '/api/v1/users/me/capabilities',
  '/api/v1/catalog',
  '/api/v1/catalog/search',
  '/api/v1/catalog/kinds',
  '/api/v1/artwork/work/',
  '/api/v1/playback/',
  '/api/v1/playback/sessions/',
  '/events',
  '/progress',
  '/api/v1/media/',
  '/chapters',
  '/subtitles/',
];

function toPosixRelative(harmonyDir, filePath) {
  return path.relative(harmonyDir, filePath).split(path.sep).join('/');
}

/**
 * Assert `requiredSubstrings` are all present, and none of
 * `forbiddenSubstrings` are present, in `relPath` under `harmonyDir`. If the
 * file does not exist at all, records a skip warning and does nothing else
 * -- see the module doc comment on why that is not a failure here.
 *
 * Returns the file's text (so callers needing extra structural checks past
 * plain substrings, e.g. checkArtworkOriginGuard below, don't re-read it),
 * or null when the file was skipped.
 */
function checkFileContract(harmonyDir, relPath, { requiredSubstrings = [], forbiddenSubstrings = [] }, errors, warnings) {
  const absPath = path.join(harmonyDir, relPath);
  if (!existsSync(absPath)) {
    warnings.push(`skipped contract check for '${relPath}' -- file does not exist yet (a later slice has not landed)`);
    return null;
  }
  const text = readFileSync(absPath, 'utf8');
  for (const needle of requiredSubstrings) {
    if (!text.includes(needle)) {
      errors.push(`${relPath}: missing required literal '${needle}'`);
    }
  }
  for (const needle of forbiddenSubstrings) {
    if (text.includes(needle)) {
      errors.push(`${relPath}: must not contain '${needle}'`);
    }
  }
  return text;
}

// data/ArtworkRepository.ets: brief section 4.9's security invariant --
// "the bearer token must only ever be attached when the request URL's
// origin equals the active server origin. Any other host gets no headers."
// There's no single fixed literal to grep for a real conditional, so this
// looks for the shape of that guard: some comparison against an "origin"
// concept, and a return of an empty header collection nearby (the
// documented behaviour for a foreign origin).
function checkArtworkOriginGuard(harmonyDir, errors, warnings) {
  const relPath = 'entry/src/main/ets/data/ArtworkRepository.ets';
  const text = checkFileContract(harmonyDir, relPath, {}, errors, warnings);
  if (text === null) return;

  const mentionsOriginCheck = /origin/i.test(text) && /(===|!==|==|!=)/.test(text);
  if (!mentionsOriginCheck) {
    errors.push(`${relPath}: expected an origin-comparison guard (brief 4.9 security invariant) but found none`);
  }
  const returnsEmptyHeaders = /return\s+(?:new\s+Map(?:<[^>]*>)?\(\)|\{\s*\})/.test(text);
  if (!returnsEmptyHeaders) {
    errors.push(`${relPath}: expected a 'return' of an empty header map/object for a foreign origin, but found none`);
  }
}

// AppConfig.clientVersion must equal app.json5's app.versionName, exactly.
function checkClientVersionPin(harmonyDir, errors, warnings) {
  const appConfigRelPath = 'entry/src/main/ets/core/AppConfig.ts';
  const appJsonRelPath = 'AppScope/app.json5';

  const appConfigAbsPath = path.join(harmonyDir, appConfigRelPath);
  const appJsonAbsPath = path.join(harmonyDir, appJsonRelPath);

  if (!existsSync(appConfigAbsPath)) {
    warnings.push(`skipped contract check for '${appConfigRelPath}' -- file does not exist yet (a later slice has not landed)`);
    return;
  }
  if (!existsSync(appJsonAbsPath)) {
    warnings.push(`skipped clientVersion pin -- '${appJsonRelPath}' does not exist`);
    return;
  }

  const appConfigText = readFileSync(appConfigAbsPath, 'utf8');
  const match = /clientVersion\s*:\s*string\s*=\s*["']([^"']+)["']/.exec(appConfigText);
  if (!match) {
    errors.push(`${appConfigRelPath}: could not find a 'clientVersion: string = "..."' literal to pin`);
    return;
  }

  let appJson;
  try {
    appJson = parseJson5(readFileSync(appJsonAbsPath, 'utf8'), appJsonAbsPath);
  } catch (err) {
    errors.push(`${appJsonRelPath}: failed to parse -- ${err.message}`);
    return;
  }
  const versionName = appJson && appJson.app && appJson.app.versionName;
  if (typeof versionName !== 'string') {
    errors.push(`${appJsonRelPath}: app.versionName is missing or not a string`);
    return;
  }
  if (match[1] !== versionName) {
    errors.push(
      `${appConfigRelPath}: clientVersion '${match[1]}' does not equal ${appJsonRelPath}'s app.versionName '${versionName}'`
    );
  }
}

export function checkContract(harmonyDir) {
  const errors = [];
  const warnings = [];

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/core/Endpoints.ts',
    { requiredSubstrings: ENDPOINT_PATH_LITERALS },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/core/AppConfig.ts',
    { requiredSubstrings: ['harmony-tv', 'harmony-mobile', 'Compatibility identity'] },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/core/DeviceCodePolicy.ts',
    {
      requiredSubstrings: [
        'urn:ietf:params:oauth:grant-type:device_code',
        'authorization_pending',
        'slow_down',
        'expired_token',
        'access_denied',
      ],
    },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/core/Jwt.ts',
    { requiredSubstrings: ['device_id'] },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/player/AvPlayerController.ets',
    {
      requiredSubstrings: ['XComponentType.SURFACE', 'onSurfaceCreated', 'getXComponentSurfaceId'],
      forbiddenSubstrings: ['onLoad('],
    },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/player/PlaybackSessionReporter.ets',
    { requiredSubstrings: ['"kind":"heartbeat"', 'user_stopped'] },
    errors,
    warnings
  );

  checkArtworkOriginGuard(harmonyDir, errors, warnings);

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/auth/SecretStore.ets',
    { requiredSubstrings: ['@kit.AssetStoreKit'] },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/auth/SettingsStore.ets',
    { forbiddenSubstrings: ['access_token', 'refresh_token'] },
    errors,
    warnings
  );

  checkClientVersionPin(harmonyDir, errors, warnings);

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/pages/Player.ets',
    { requiredSubstrings: ['getFocusController().activate('] },
    errors,
    warnings
  );

  checkFileContract(
    harmonyDir,
    'entry/src/main/ets/design/components/PosterCard.ets',
    { requiredSubstrings: ['.focusable(true)'] },
    errors,
    warnings
  );

  return { ok: errors.length === 0, errors, warnings };
}
