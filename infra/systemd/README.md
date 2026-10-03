# infra/systemd

A single-host (bare metal / VM) deployment path for Playarr Server, as an
alternative to the Kubernetes chart in `../kubernetes/`. Runs one
all-in-one `playarr` process (`PLAYARR_ROLE=all`) under systemd rather
than splitting API and worker into separate processes/Deployments.

## Files

| File | Purpose |
|------|---------|
| `playarr.service` | Main unit. `ExecStart=/usr/local/bin/playarr-server` with `PLAYARR_ROLE=all`, `Restart=on-failure`, runs as the unprivileged `playarr` user/group, loads `/etc/playarr/playarr.env`. |
| `playarr-update-check.service` | Oneshot, check-only version check. Logs to the journal; never installs, downloads, or restarts anything. |
| `playarr-update-check.timer` | Triggers the above daily. **Shipped present but disabled by default** - see the comment block at the top of the file. Operators opt in explicitly with `systemctl enable --now playarr-update-check.timer`. |
| `playarr.env.example` | Template for `/etc/playarr/playarr.env` (`DATABASE_URL`, `REDIS_URL`, plus the same optional config keys as the Kubernetes ConfigMap, for parity). Not loaded directly - `install.sh` copies it to `/etc/playarr/playarr.env` on first install only. |
| `install.sh` | Installs the binary + unit files + env template and runs `systemctl daemon-reload`. Does **not** enable or start anything - see below. |

## Installing

From a release tarball (`https://playarr.app/downloads/server/`), unpack it and run
`sudo ./systemd/install.sh`: it finds `../playarr-server` and installs `web/` (the Admin UI) to
`/var/lib/playarr/web`. The command below is the same script run from a source checkout.

```sh
sudo ./install.sh /path/to/playarr-server    # or place ./playarr-server next to this script and omit the arg
```

This creates the `playarr` system user, `/etc/playarr`,
`/var/lib/playarr`, `/var/log/playarr`, installs the binary to
`/usr/local/bin/playarr-server`, seeds `/etc/playarr/playarr.env` from the
example (only if it doesn't already exist - re-running `install.sh` never
clobbers a live env file), copies the three unit files into
`/etc/systemd/system/`, and runs `systemctl daemon-reload`.

It then prints, but does not run, the remaining steps:

```sh
sudoedit /etc/playarr/playarr.env      # fill in DATABASE_URL, REDIS_URL
sudo systemctl enable --now playarr.service
systemctl status playarr.service
journalctl -u playarr.service -f

# optional, opt-in:
sudo systemctl enable --now playarr-update-check.timer
```

## Config contract (verified against `backend/crates/playarr-config/src/lib.rs` and `backend/src/main.rs`)

These mirror the same real contract documented in `../docker/README.md` so
all three deployment paths configure the binary identically. Two real bugs
this drifted into (invalid role value, wrong update-check CLI invocation)
have been fixed:

- Binary name `playarr-server`, installed to `/usr/local/bin/playarr-server`.
- `PLAYARR_ROLE=all` is hardcoded into `playarr.service` itself (it
  comes after `EnvironmentFile=` so it always wins over anything set in
  `playarr.env` - see the comment in that file). `Role::parse` only
  accepts `all`/`api`/`worker` -- there is no CLI `--role` flag, `serve`
  takes no arguments at all.
- `playarr-server update --check` is the real binary's check-only invocation
  (`--check` is a flag on the `update` subcommand, confirmed against
  `backend/src/main.rs`'s `Command::Update`) -- there is no nested `check`
  subcommand and no `--log-only` flag. `check_for_update()` is currently a
  stub (always reports "up to date," no real release-feed network call
  yet), so this unit runs and exits 0 every time regardless, but the
  invocation itself is now correct for when that lands.
- Config/env var names in `playarr.env.example` (`PLAYARR_LOG`,
  `PLAYARR_HTTP_BIND_ADDR`, `PLAYARR_METRICS_BIND_ADDR`, the optional
  automatic ACME settings, and the optional static-asset paths) are the real
  ones the binary reads. The core config names match
  `helm/playarr/values.yaml`'s `config` block, so the two deployment paths
  configure the binary identically.
- `WorkingDirectory=/var/lib/playarr` is assumed to be an acceptable
  location for any local state (cache, temp media processing, etc.) the
  binary writes. `ReadWritePaths` in the unit's sandboxing section is
  scoped to that plus `/var/log/playarr` - widen it if the real binary
  needs to write elsewhere.
- `PLAYARR_WEB_ASSETS_DIR` serves Playarr Server Admin at `/`. Playarr remains a
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
systemd-analyze verify infra/systemd/playarr.service
systemd-analyze verify infra/systemd/playarr-update-check.service
systemd-analyze verify infra/systemd/playarr-update-check.timer
shellcheck infra/systemd/install.sh
```
