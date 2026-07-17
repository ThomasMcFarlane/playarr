# infra/systemd

A single-host (bare metal / VM) deployment path for Streamarr, as an
alternative to the Kubernetes chart in `../kubernetes/`. Runs one
all-in-one `streamarr` process (`STREAMARR_ROLE=all`) under systemd rather
than splitting API and worker into separate processes/Deployments.

## Files

| File | Purpose |
|------|---------|
| `streamarr.service` | Main unit. `ExecStart=/usr/local/bin/streamarr` with `STREAMARR_ROLE=all`, `Restart=on-failure`, runs as the unprivileged `streamarr` user/group, loads `/etc/streamarr/streamarr.env`. |
| `streamarr-update-check.service` | Oneshot, check-only version check. Logs to the journal; never installs, downloads, or restarts anything. |
| `streamarr-update-check.timer` | Triggers the above daily. **Shipped present but disabled by default** - see the comment block at the top of the file. Operators opt in explicitly with `systemctl enable --now streamarr-update-check.timer`. |
| `streamarr.env.example` | Template for `/etc/streamarr/streamarr.env` (`DATABASE_URL`, `REDIS_URL`, plus the same optional config keys as the Kubernetes ConfigMap, for parity). Not loaded directly - `install.sh` copies it to `/etc/streamarr/streamarr.env` on first install only. |
| `install.sh` | Installs the binary + unit files + env template and runs `systemctl daemon-reload`. Does **not** enable or start anything - see below. |

## Installing

```sh
sudo ./install.sh /path/to/streamarr    # or place ./streamarr next to this script and omit the arg
```

This creates the `streamarr` system user, `/etc/streamarr`,
`/var/lib/streamarr`, `/var/log/streamarr`, installs the binary to
`/usr/local/bin/streamarr`, seeds `/etc/streamarr/streamarr.env` from the
example (only if it doesn't already exist - re-running `install.sh` never
clobbers a live env file), copies the three unit files into
`/etc/systemd/system/`, and runs `systemctl daemon-reload`.

It then prints, but does not run, the remaining steps:

```sh
sudoedit /etc/streamarr/streamarr.env      # fill in DATABASE_URL, REDIS_URL
sudo systemctl enable --now streamarr.service
systemctl status streamarr.service
journalctl -u streamarr.service -f

# optional, opt-in:
sudo systemctl enable --now streamarr-update-check.timer
```

## Config contract (verified against `backend/crates/streamarr-config/src/lib.rs` and `backend/src/main.rs`)

These mirror the same real contract documented in `../docker/README.md` so
all three deployment paths configure the binary identically. Two real bugs
this drifted into (invalid role value, wrong update-check CLI invocation)
have been fixed:

- Binary name `streamarr`, installed to `/usr/local/bin/streamarr`.
- `STREAMARR_ROLE=all` is hardcoded into `streamarr.service` itself (it
  comes after `EnvironmentFile=` so it always wins over anything set in
  `streamarr.env` - see the comment in that file). `Role::parse` only
  accepts `all`/`api`/`worker` -- there is no CLI `--role` flag, `serve`
  takes no arguments at all.
- `streamarr update --check` is the real binary's check-only invocation
  (`--check` is a flag on the `update` subcommand, confirmed against
  `backend/src/main.rs`'s `Command::Update`) -- there is no nested `check`
  subcommand and no `--log-only` flag. `check_for_update()` is currently a
  stub (always reports "up to date," no real release-feed network call
  yet), so this unit runs and exits 0 every time regardless, but the
  invocation itself is now correct for when that lands.
- Config/env var names in `streamarr.env.example` (`STREAMARR_LOG`,
  `STREAMARR_HTTP_BIND_ADDR`, `STREAMARR_METRICS_BIND_ADDR`, and the optional
  static-asset paths) are the real ones the binary reads. The core config
  names match `helm/streamarr/values.yaml`'s `config` block, so the two
  deployment paths configure the binary identically.
- `WorkingDirectory=/var/lib/streamarr` is assumed to be an acceptable
  location for any local state (cache, temp media processing, etc.) the
  binary writes. `ReadWritePaths` in the unit's sandboxing section is
  scoped to that plus `/var/log/streamarr` - widen it if the real binary
  needs to write elsewhere.
- `STREAMARR_WEB_ASSETS_DIR` serves Streamarr Admin at `/`. Playarr remains a
  separate client hosted at `playarr.app` and is not installed by systemd.

## Validation gap: no systemd on this machine

This was scaffolded on macOS, which has no systemd. `systemd-analyze
verify` (the standard way to catch unit-file syntax errors, dangling
`After=`/`Wants=` targets, etc.) could not be run, and neither `install.sh`
nor any `systemctl`/`journalctl` command was executed against a real
instance.

What *was* checked locally:
- `bash -n install.sh` - shell syntax is valid.
- Manual review of `[Section]` header balance and key/value pairs in all
  three unit files.

Before trusting this in production, run on an actual Linux host with
systemd:

```sh
systemd-analyze verify infra/systemd/streamarr.service
systemd-analyze verify infra/systemd/streamarr-update-check.service
systemd-analyze verify infra/systemd/streamarr-update-check.timer
shellcheck infra/systemd/install.sh
```
