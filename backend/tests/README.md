# Integration tests

This directory is for integration tests that exercise the Streamarr
backend against real infrastructure — Postgres, Redis, and (where
relevant) fake/recorded *arr and Tdarr HTTP endpoints — brought up via the
repo's `docker-compose` dev stack, as opposed to the unit tests that live
alongside each crate's source under `crates/*/src/`.

Nothing here yet: this is scaffolding for work that depends on the
docker-compose stack existing and the crate implementations behind the
trait signatures in `crates/` being filled in. When adding tests here:

- Prefer one test binary per subsystem (e.g. `catalog_sync.rs`,
  `playback_transcode.rs`) over one giant `integration.rs`, so `cargo test
  --test <name>` can target a slow suite in isolation.
- Gate anything that needs the compose stack behind an explicit
  environment check (e.g. `DATABASE_URL` pointing at the compose
  Postgres) so `cargo test --workspace` from a plain checkout — no
  compose stack running — still passes rather than hanging or failing on
  a missing connection.
- These are allowed to be slower and more end-to-end than the crate-level
  unit tests; they should assert on cross-crate behavior (a webhook
  actually triggering a targeted re-fetch that updates the catalog, a
  playback session actually landing in `stats_daily` after rollup) that
  no single crate's own test suite can see.
