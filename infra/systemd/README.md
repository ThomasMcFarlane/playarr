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

## Design assumptions made while scaffolding

These mirror the assumptions documented in `../kubernetes/README.md` so the
two deployment paths stay consistent:

- Binary name `streamarr`, installed to `/usr/local/bin/streamarr`.
- `STREAMARR_ROLE=all` is hardcoded into `streamarr.service` itself (it
  comes after `EnvironmentFile=` so it always wins over anything set in
  `streamarr.env` - see the comment in that file). If the real binary uses
  a different env var name or accepts different role values, update both
  `streamarr.service` and `streamarr.env.example` together.
- `streamarr update check --log-only` is assumed to be the real binary's
  check-only update subcommand/flag. If the actual CLI surface differs,
  update `streamarr-update-check.service`'s `ExecStart=` - it is the only
  line that assumes this.
- Config/env var names in `streamarr.env.example` (`APP_ENV`, `LOG_LEVEL`,
  `LOG_FORMAT`, `METRICS_ENABLED`, `METRICS_PORT`, `HTTP_PORT`) match
  `helm/streamarr/values.yaml`'s `config` block exactly, so the two
  deployment paths configure the binary identically.
- `WorkingDirectory=/var/lib/streamarr` is assumed to be an acceptable
  location for any local state (cache, temp media processing, etc.) the
  binary writes. `ReadWritePaths` in the unit's sandboxing section is
  scoped to that plus `/var/log/streamarr` - widen it if the real binary
  needs to write elsewhere.

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
