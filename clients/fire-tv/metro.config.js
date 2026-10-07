const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;

// The shared @playarr-tv/* logic packages live in the tv-web pnpm
// workspace, one directory up and over. We alias their TypeScript SOURCE
// (never their built dist/) so this project never has to build a sibling
// workspace before it can run, and so an edit to a shared package is picked
// up by Fast Refresh exactly like an edit to fire-tv's own src/ -- see
// design doc §4.1 for the full trade-off discussion (no build-order
// dependency, no pnpm/catalog version fight with Vega's pinned React 18.2.0
// / TypeScript ~4.9.5, at the cost of being outside the repo's usual pnpm
// convention).
const sharedRoot = path.resolve(projectRoot, '../tv-web/packages');
// LanguageProvider.tsx imports tv-web's plain-TypeScript i18n tables
// (languages.ts + translations/) straight from the web app's source tree;
// Metro only bundles files under a watched folder, so that directory must
// be listed too.
const i18nRoot = path.resolve(projectRoot, '../tv-web/web/src/lib/i18n');

module.exports = mergeConfig(getDefaultConfig(projectRoot), {
  watchFolders: [sharedRoot, i18nRoot],
  resolver: {
    // The shared packages' package.json files must be invisible to Metro.
    // Because sharedRoot is a watched folder, Metro's haste map registers
    // each package.json "name" (for example @playarr-tv/design-tokens) as a
    // haste package, and haste lookup runs BEFORE extraNodeModules. It then
    // follows that package.json's `main` (./dist/index.js), which is never
    // built here, and fails ("specifies a `main` module field that could
    // not be resolved"). Hiding the files leaves extraNodeModules below as
    // the only route, so the TypeScript source in src/ is what is bundled.
    blockList: exclusionList([
      /clients[\\/]tv-web[\\/]packages[\\/][^\\/]+[\\/]package\.json$/,
    ]),
    // Metro's own upward node_modules walk, unassisted, would never find
    // this project's node_modules while resolving a file that physically
    // lives under sharedRoot (clients/tv-web/packages/**) -- that walk
    // only ever climbs through clients/tv-web/, and fire-tv is a sibling
    // directory, not an ancestor of it. Listing this project's own
    // node_modules here is what makes the extraNodeModules entries below
    // (and every ordinary dependency fire-tv's OWN files import) resolve
    // regardless of which file is doing the importing.
    nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
    extraNodeModules: {
      // extraNodeModules matches on the PACKAGE name only (the first two
      // segments of a scoped specifier) and then appends the rest of the
      // specifier to the mapped directory, so "@playarr-tv/api-client/react"
      // would become <dir>/react, which does not exist in the real package
      // (its "./react" subpath export maps to hooks.ts). A tiny local shim
      // directory provides both entry points explicitly: index.ts and
      // react.ts, each re-exporting the shared TypeScript source.
      '@playarr-tv/api-client': path.join(projectRoot, 'metro-shims/api-client'),
      '@playarr-tv/device-auth': path.join(sharedRoot, 'device-auth/src'),
      '@playarr-tv/domain': path.join(sharedRoot, 'domain/src'),
      '@playarr-tv/player-core': path.join(sharedRoot, 'player-core/src'),
      '@playarr-tv/design-tokens': path.join(sharedRoot, 'design-tokens/src'),

      // Not part of the shared-package surface -- these entries exist
      // because files INSIDE the aliased source above have their own plain
      // bare-specifier imports (api-client/src/index.ts imports
      // "openapi-fetch", api-client/src/hooks.ts imports "react",
      // device-auth/src imports "qrcode"), and per the nodeModulesPaths
      // comment above, Metro's normal walk starting from those files'
      // real location under clients/tv-web/packages/ can never reach this
      // project's node_modules on its own. Forcing them here means a
      // fresh `npm ci` in clients/fire-tv is sufficient by itself --
      // nothing about resolving fire-tv depends on clients/tv-web ever
      // having had `pnpm install` run in it.
      'openapi-fetch': path.join(projectRoot, 'node_modules/openapi-fetch'),
      qrcode: path.join(projectRoot, 'node_modules/qrcode'),
      react: path.join(projectRoot, 'node_modules/react'),
      // Found the same way as the three above, but one step removed: this
      // one is not a bare specifier the shared source *writes* at all --
      // it is what Babel's own commonjs-interop transform generates
      // (`require("@babel/runtime/helpers/interopRequireDefault")`) when it
      // transpiles api-client/src/index.ts's ES-module `export`s, which a
      // real `npx jest` run against the aliased source surfaced directly
      // (jest hits this exact resolution gap the same way Metro's bundler
      // would, since both transpile that file with this project's own
      // babel.config.js). A single entry for the package root is enough --
      // unlike the "./react" subpath above, "@babel/runtime/helpers/*" is a
      // plain subpath into that package's real file layout, not a
      // package.json "exports" remap, so Metro's normal subpath resolution
      // inside the redirected directory already handles every helper.
      '@babel/runtime': path.join(projectRoot, 'node_modules/@babel/runtime'),
    },
  },
});
