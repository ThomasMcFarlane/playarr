# Streamarr TV & Web clients

A pnpm workspace covering every TV/web surface: shared TypeScript packages,
two packaged TV app shells (webOS and Tizen), a legacy experimental VIDAA
shell, and the standalone Web app that also serves as the current hosted VIDAA
client. Verified with `pnpm install` + a full recursive `pnpm -r run build`
(typecheck + Vite bundling for every app) on Node v23.10.0 / pnpm 11.13.0.

## Layout

```
clients/tv-web/
  pnpm-workspace.yaml   workspace package globs + shared version catalog
  tsconfig.base.json    shared compiler options, extended by every package
  packages/             platform-agnostic shared libraries
    api-client/            real typed client generated from backend/openapi/streamarr.yaml
                            (openapi-typescript + openapi-fetch), plus shared React
                            data-fetching hooks at the "./react" subpath export
    domain/                client-local config only now (API base URL resolution/storage)
                            -- wire types live in api-client, generated off the real spec
    device-auth/           RFC 8628 OAuth device-authorization-grant client, wired to the
                            real POST /api/v1/oauth/device/code + /api/v1/oauth/token
    design-tokens/         color/spacing/type-scale constants (pre-Style-Dictionary)
    spatial-nav/            platform-agnostic d-pad/remote focus engine
    player-core/             PlaybackEngine interface + DRM config shape
    player-shaka/            Shaka Player adapter (real shaka-player dependency)
    player-avplay/           Tizen webapis.avplay adapter (local .d.ts, no Tizen SDK here)
    ui-tv/                  Browse/Detail/Player/Pairing screens + data-wired containers
                            (BrowseScreenContainer/DetailScreenContainer/
                            PlayerScreenContainer/PairingScreenContainer) and the
                            top-level TvApp screen router, all consumed by the 3 TV shells
  apps/                  thin per-platform TV shells
    tv-webos/               webOS app shell (TvApp + player-shaka)
    tv-tizen/                Tizen app shell (TvApp + player-avplay)
    tv-vidaa-fallback/       legacy experimental VIDAA PWA shell
  web/                    standalone Vite + React app (Home/Library/WorkDetail/Player/
                          Settings/Admin), also installed directly as the current
                          hosted VIDAA Web App
```

## Package naming & versioning

Every package is scoped `@streamarr-tv/*` and `"private": true` (not
published). Shared external dependency versions (`typescript`, `react`,
`react-dom`, their `@types`, `vite`, `@vitejs/plugin-react`) are pinned once
in `pnpm-workspace.yaml`'s `catalog:` and referenced from each `package.json`
as `"catalog:"`, so there is exactly one resolved version of each across the
whole workspace.

## Commands

```sh
pnpm install              # install everything (workspace + catalog resolution)
pnpm -r run build         # typecheck + build every package/app, in dependency order
pnpm -r run typecheck     # tsc --noEmit everywhere
pnpm -r --if-present run test   # vitest suites (api-client, device-auth) against mocked HTTP
pnpm --filter @streamarr-tv/api-client run generate   # regenerate src/generated/schema.ts
                                                        # from backend/openapi/streamarr.yaml
pnpm --filter @streamarr-tv/web run dev     # Vite dev server for the standalone web app
pnpm --filter @streamarr-tv/web run deploy:cloudflare   # build and deploy playarr.app
pnpm --filter @streamarr-tv/app-webos run dev   # etc., per app
```

Production deployment, GitHub Actions secrets, and the manual local workflow
are documented in [Deploy Playarr Web to Cloudflare](../../docs/deployment/playarr-cloudflare.md).

`pnpm -r run build` builds `packages/*` to `dist/` (declaration + source-mapped
JS) first, then `apps/*` and `web/` typecheck against those `dist/` outputs
and produce a static Vite bundle. This all ran clean (no TypeScript errors,
no dependency resolution errors) as part of scaffolding this workspace.

## Design decisions worth knowing about

- **No TS project references / build orchestration.** Packages resolve each
  other purely through normal pnpm workspace symlinks + each package's
  `main`/`types` fields pointing at its own `dist/`. `pnpm -r` already builds
  in dependency-topological order, so this is simpler than wiring up
  `tsc -b` composite projects for a scaffold this size. Revisit if the
  package count grows enough that redundant full rebuilds become slow.
- **`moduleResolution: "Bundler"`** everywhere (in `tsconfig.base.json`).
  Every package here is ultimately consumed by Vite (the three TV apps and
  the web app); nothing in this workspace is executed directly by Node, so
  bundler-style resolution (no required file extensions on relative
  imports) is the right default. If a package ever needs to run standalone
  under plain Node ESM, its `tsconfig.json` should override to
  `"moduleResolution": "NodeNext"` and its relative imports will need
  explicit `.js` extensions.
- **`player-core` exposes `BasePlaybackEngine`**, an abstract class handling
  state storage + listener fan-out, so `player-shaka` and `player-avplay`
  only implement the actual device/DOM calls. Both re-export `player-core`'s
  types (`PlaybackEngine`, `PlaybackEngineState`, `PlaybackSource`,
  `DrmConfig`) so consumers (apps, the web app) don't need a second direct
  dependency on `player-core` just for types -- though the apps also
  declare it directly since they reference `PlaybackEngine` more broadly.
- **`shaka-player` ships real TypeScript declarations** (`dist/shaka-player.compiled.d.ts`,
  generated from Shaka's Closure Compiler externs, resolved via its own
  `package.json` `types` field) -- `player-shaka` is typed against the
  actual `shaka.Player` API, not a hand-rolled stand-in.
- **`player-avplay` is typed against a hand-written `tizen-avplay.d.ts`**
  (global ambient declarations, no Tizen SDK available in this environment)
  covering only the AVPlay surface the adapter actually calls. Extend it if
  a real Tizen build needs more of the API.

## Known gaps

- **webOS CLI and Tizen Studio are not installed in this environment.** Each
  packaged `apps/*` target produces a real
  static Vite `dist/` bundle; turning that into an installable `.ipk`
  (webOS) or `.wgt` (Tizen) requires those platform SDKs. VIDAA can open the
  co-hosted `web/` build in its Browser, but a launcher tile requires VIDAA
  distribution or device-specific developer access. See the
  [VIDAA installation guide](../../docs/clients/vidaa.md).
- **No backend is running anywhere in this workspace.** `packages/api-client`
  and `web/src/pages/Library.tsx` point at `http://localhost:8080/v1` as a
  placeholder and will fail requests until a real API exists -- that failure
  is surfaced in the UI rather than mocked away, deliberately.
- **`packages/api-client` is fully hand-written.** Per the task brief, it's
  a placeholder for the future `openapi-typescript` + `openapi-fetch`
  generated client; the `ApiClient`/`ApiClientConfig`/`ApiError` shapes were
  chosen to make that swap low-churn (a typed `request<T>()` primitive plus
  verb helpers), but there's no OpenAPI schema to generate against yet.
- **`packages/design-tokens` is hand-authored**, not generated. Per the task
  brief, Style Dictionary will eventually consume a canonical token source
  and generate per-platform output; until then this file *is* the source of
  truth and should be edited directly.
- **Icons/splash images are not included.** `apps/tv-webos/appinfo.json`,
  `apps/tv-tizen/tizen-manifest.xml`, and `apps/tv-vidaa-fallback/manifest.json`
  all reference icon/splash assets (`icon.png`, `splash.png`,
  `icons/icon-192.png`, `icons/icon-512.png`) that don't exist in this
  scaffold yet.
- **No test suite yet.** Nothing in this workspace has unit tests; the
  validation done here was `pnpm install` + a full `pnpm -r run build`
  (typecheck + bundle) rather than behavioral testing.
- **Vite's "chunk larger than 500kB" warning** shows up on the web app and
  the two Shaka-based TV shells (`shaka-player` is a large dependency,
  bundled whole). Not an error, but worth revisiting with
  `build.rollupOptions.output.manualChunks` or dynamic `import()` once
  there's real app code to split around.
- **`react-router-dom` is not pinned via the shared catalog** (only `react`/
  `react-dom` are) since it's only used by `web/`; if a TV app ever needs
  client-side routing, consider adding it to the catalog at that point for
  consistency.
