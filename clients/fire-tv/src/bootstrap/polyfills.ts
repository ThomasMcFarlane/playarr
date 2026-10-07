/**
 * Installs every global Hermes does not provide but the code this app
 * depends on assumes exists -- see design doc assumption A5. This file has
 * no exports on purpose: every fix here is a side effect (either a
 * side-effect import that patches `globalThis` itself, or a guarded direct
 * assignment), and the *only* contract that matters is "this module having
 * been imported once, before anything else runs". `src/App.tsx` enforces
 * that by making `import './bootstrap/polyfills';` its first line, and
 * `jest.setup.ts` imports this same file (rather than re-declaring its own,
 * possibly-drifting set of test-only globals) so a unit test never
 * observes an environment production doesn't also have.
 *
 * Every assignment below is guarded (`typeof x === 'undefined'`) rather
 * than unconditional, for two independent reasons: Jest runs this exact
 * file under Node, which already provides several of these natively, and a
 * guard means importing this module twice (however that happens) is always
 * safe.
 *
 * Deliberately no `declare global { var … }` blocks here: `@types/node`
 * (a devDependency, needed for the theme colour-lock test's `fs` read) and
 * Node itself already ambiently declare `atob`/`btoa`/`crypto` at these
 * TypeScript/Node versions, and a second, differently-shaped declaration of
 * the same global name is a compiler error, not a merge -- so every
 * assignment below goes through a small locally-cast view of `globalThis`
 * instead of widening the ambient type.
 */

// URL / URLSearchParams: @playarr-tv/domain's normaliseApiBaseUrl and
// resolveApiBaseUrl, and @playarr-tv/device-auth's serverAddressBundle
// helpers, all construct a real `new URL(...)`. Hermes has no URL
// implementation at all. Explicitly on Amazon's own tested-compatible
// package list (design doc §3.2). The "/auto" entry point does the
// `typeof URL === 'undefined'` guard internally, so it is safe even though
// Node (under Jest) already has a native URL.
import 'react-native-url-polyfill/auto';

// TextEncoder / TextDecoder: required by the Vega build of Shaka Player
// (design doc §3.2) and, more immediately, by anything that touches UTF-8
// byte lengths for multipart/streaming bodies. Side-effect import; installs
// the globals only if they are missing.
import 'fastestsmallesttextencoderdecoder';

import {decode, encode} from 'base-64';
import uuid from 'react-native-uuid';

// tsconfig.json's `lib` includes "dom" so the ALIASED @playarr-tv/*
// source (written for tv-web's browser tsconfig) typechecks -- see that
// file's comment. One consequence lands here: `globalThis.crypto` and
// `globalThis.window` are now ambiently typed as the FULL spec interfaces
// (`Crypto` needs `subtle`/`getRandomValues`/etc; `Window` needs
// essentially the entire DOM), which this file only ever installs a sliver
// of. Rather than assign an object that satisfies neither interface (a
// real compile error) or pretend to implement the rest (dishonest, and a
// maintenance trap), every read/write below goes through `patchable`, an
// explicit `unknown`-valued escape hatch -- the polyfill is deliberately
// partial, so the types say so too, instead of quietly overclaiming
// completeness.
const patchable = globalThis as unknown as Record<string, unknown>;

// atob/btoa: @playarr-tv/device-auth's decodeAccessTokenDeviceId (and the
// device-linking flow's own JWT-claim reads) need to base64-decode a JWT
// payload segment. `base-64` is the same package tv-web's own jwt.ts
// assumes is available as a last-resort fallback -- see design doc §3.2 and
// §5.4.
if (typeof patchable.atob === 'undefined') {
  patchable.atob = decode;
}
if (typeof patchable.btoa === 'undefined') {
  patchable.btoa = encode;
}

// crypto.randomUUID: several call sites across the shared packages
// generate a device/session id via the standard Web Crypto API rather than
// a package of their own. Hermes has no `crypto` global whatsoever, so
// this installs just enough of it -- `randomUUID` alone, not a full
// SubtleCrypto shim -- backed by `react-native-uuid`, which Amazon lists as
// tested-compatible (design doc §3.2) specifically because it needs no
// native module of its own (pure JS Math.random/Date entropy), unlike
// `react-native-get-random-values`-based alternatives that would need a
// Vega-specific native binding nobody has verified exists.
const randomUUID = (): string => uuid.v4() as string;
if (typeof patchable.crypto === 'undefined') {
  patchable.crypto = {randomUUID};
} else {
  const existingCrypto = patchable.crypto as {randomUUID?: () => string};
  if (typeof existingCrypto.randomUUID === 'undefined') {
    existingCrypto.randomUUID = randomUUID;
  }
}

// window.fetch: Shaka Player is written against the browser DOM and reads
// `window.fetch` (not bare `fetch`) in several places internally. RN has no
// `window` at all -- `global` is the only global object. This does not
// change fetch's behaviour (RN's `fetch` already exists on `globalThis`);
// it only makes it reachable under the name Shaka's Vega build expects. A
// full `window` shim is deliberately NOT attempted here -- this app renders
// no DOM and the moment something reaches for `window.document` or similar
// is the moment that call site has the wrong assumption, not this file.
if (typeof patchable.window === 'undefined') {
  patchable.window = {fetch: patchable.fetch};
} else {
  const existingWindow = patchable.window as {fetch?: typeof fetch};
  if (typeof existingWindow.fetch === 'undefined') {
    existingWindow.fetch = patchable.fetch as typeof fetch;
  }
}

// DOMException: Hermes has none, and the abort paths in the hosted-link
// poller reject with `new DOMException('Aborted', 'AbortError')`. Without
// this, cancelling a pending link request (leaving the Link screen) throws
// a ReferenceError instead of an AbortError.
if (typeof patchable.DOMException === 'undefined') {
  class PolyfilledDomException extends Error {
    constructor(message = '', name = 'Error') {
      super(message);
      this.name = name;
    }
  }
  patchable.DOMException = PolyfilledDomException;
}

// navigator: React Native's `navigator` has only `product`. Shaka Player's platform detection reads `platform`,
// `vendor`, `language` and `userAgent` and calls `.includes()` on them, so an undefined field is a fatal TypeError.
{
  const target = patchable as {navigator?: Record<string, unknown>};
  const nav = (target.navigator ??= {});
  nav.platform ??= 'Linux';
  nav.vendor ??= '';
  nav.language ??= 'en';
  nav.userAgent ??= 'AFTCA001';
}
