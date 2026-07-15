## Summary

<!-- What does this PR do, and why? Link any related issue(s). -->

## Affected component(s)

- [ ] Backend (Rust/Axum API)
- [ ] Playarr Android (mobile / TV / shared module)
- [ ] Playarr iOS
- [ ] Playarr Web
- [ ] Playarr TV Web (Tizen / webOS / VIDAA fallback)
- [ ] Docs
- [ ] Infra (Docker / Kubernetes / systemd)
- [ ] CI/CD / tooling

## QA gate checklist

Only tick what's actually true. The `ci-required` check (see `ci.yml`) is the
canonical, always-run gate that re-verifies most of this automatically --
this checklist is here for anything CI can't see (manual testing,
screenshots, migration steps, deliberate scope decisions).

- [ ] All CI checks are green. Per-platform jobs (`backend-check`,
      `android-check`, `ios-check`, `tv-web-check`,
      `openapi-contract-check`) only run when this PR touches their path,
      but `ci-required` must be green regardless.
- [ ] `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test`
      pass locally, if this PR touches `backend/`.
- [ ] `cargo deny check` passes (no new disallowed licenses/advisories/bans),
      if this PR touches `backend/`'s dependencies.
- [ ] **If this PR changes any `#[utoipa::path]`/schema annotation or other
      API-visible behaviour**, the OpenAPI contract was regenerated and
      `backend/openapi/streamarr.yaml` was committed with the diff.
      `openapi-contract-check` enforces this in CI, but please double-check
      the diff itself is intentional and reviewed, not just "made CI pass".
- [ ] `pnpm run lint` and `pnpm run typecheck` pass, if this PR touches
      `clients/tv-web/`.
- [ ] Relevant Android/iOS builds pass locally, if this PR touches those
      clients.
- [ ] New/changed behaviour has test coverage (unit/integration, as
      appropriate).
- [ ] Breaking changes are called out explicitly below, including any
      required `backend/config/client-compatibility.toml` version-floor
      bump (see `release-client-compat-bot.yml` for how that's normally
      automated from a client release tag).
- [ ] Docs (`docs/`) updated if user-facing or operator-facing behaviour
      changed.

## Breaking changes

<!-- API/contract, config, DB schema/migration, or client-compatibility breaks. "None" if not applicable. -->

## Screenshots / recordings

<!-- UI changes: before/after screenshots or a short screen recording. Delete this section if not applicable. -->

## How was this tested?

<!-- Commands run, environments used, manual test steps. -->
