# Deploying Streamarr: systemd (Tier 1 — single node)

This is the default, recommended way to run Streamarr on a NAS, a
Raspberry Pi, a mini-PC, or any always-on Linux box you administer
directly. It runs one `streamarr` process with the `STANDALONE` role set
(API, worker, and coordinator all in-process — see
[`../overview.md`](../overview.md#the-single-role-gated-binary-principle)),
backed by SQLite, with no external services required (see
[ADR 0001](../adr/0001-storage-engine.md) for why SQLite is the Tier 1
default).

## What you need

- A 64-bit Linux system with systemd (this covers the large majority of
  NAS vendors' DSMs, Raspberry Pi OS, Debian/Ubuntu-based mini-PCs).
  `aarch64` and `x86_64` builds are published; an `armv7` build is
  published for older Raspberry Pi boards.
- Enough local disk for your media library plus a data directory for
  Streamarr's SQLite database, config, and artwork cache. The on-demand
  transcode segment cache (see
  [`../distributed-design.md`](../distributed-design.md)) also lives on
  local disk under the data directory — do not point the data directory at
  a network share; see the ADR's discussion of fsync/WAL behaviour on NAS
  filesystems and network mounts.
- Root (or sudo) access once, to install the unit file and create the
  service user. Streamarr itself runs unprivileged.

## Installing

The infra tier ships an installer script and unit files under
`infra/systemd/`:

- `infra/systemd/install.sh` — fetches the correct binary for the host's
  architecture, creates a dedicated `streamarr` system user, lays out the
  data directory (default `/var/lib/streamarr`) and config file (default
  `/etc/streamarr/config.toml`), and installs the unit files below.
- `infra/systemd/streamarr.service` — the main service unit, running
  `streamarr serve --role standalone --config /etc/streamarr/config.toml`
  as the `streamarr` user, with `Restart=on-failure`,
  `ProtectSystem=strict`, and an explicit `ReadWritePaths=` limited to the
  data directory and configured media library paths.
- `infra/systemd/streamarr-update.service` and
  `infra/systemd/streamarr-update.timer` — the opt-in self-update path,
  described below.

```bash
curl -fsSL https://get.streamarr.dev/systemd/install.sh | sudo bash
sudo systemctl enable --now streamarr.service
sudo systemctl status streamarr.service
```

A minimal starting config (`/etc/streamarr/config.toml`):

```toml
[server]
role = "standalone"
listen_addr = "0.0.0.0:8443"
data_dir = "/var/lib/streamarr"

[database]
backend = "sqlite"
path = "/var/lib/streamarr/streamarr.db"

[library]
roots = ["/mnt/media/movies", "/mnt/media/tv"]

[auth]
# Open Household by default for a fresh single-node install.
trust_tier = "open"
allow_remote_access = false

[update]
auto_update = false
channel = "stable"
```

Bringing a reverse proxy (Caddy, nginx, Traefik) in front of
`listen_addr` for TLS termination and remote access is the operator's
choice and outside the unit file's concern; `streamarr.service` binds
locally and does not manage certificates itself.

## Operating

- Logs: `journalctl -u streamarr -f`.
- Config changes: edit `/etc/streamarr/config.toml`, then
  `sudo systemctl restart streamarr`. There is no hot-reload for most
  settings at this tier (`Policy` fields that are read per-request from the
  database, per [`../auth-modes.md`](../auth-modes.md), *are* effectively
  live; process-level config like `listen_addr` and `database.backend`
  requires a restart).
- Data lives entirely under `data_dir`; back that directory up (it contains
  the SQLite database, artwork cache, and any local transcode segment
  cache — the latter is safely excludable from backups, it's regenerated
  on demand).
- Growing beyond one node: exporting a Tier 1 SQLite database to Postgres
  and moving to [`docker-compose.md`](docker-compose.md) or
  [`kubernetes.md`](kubernetes.md) is a supported, deliberate migration
  path (`streamarr admin export --to postgres://...`), not an automatic
  one — see the "accepted costs" section of
  [ADR 0001](../adr/0001-storage-engine.md).

## Self-update story: opt-in `streamarr update`

systemd installs do **not** update themselves by default. `auto_update` in
config defaults to `false`, matching the general principle that unattended
consumer hardware should never change its own running software without an
explicit decision by the person operating it.

Instead, the binary ships an `update` subcommand:

```bash
sudo streamarr update --check   # reports the latest available release, does nothing
sudo streamarr update           # downloads, verifies, and installs
```

`streamarr update`:

1. Queries the release manifest for the configured `update.channel`
   (`stable` by default; `beta` available).
2. Downloads the release binary for the host's architecture and verifies
   it against a published checksum and release signature before doing
   anything else.
3. Performs an **atomic binary swap**: writes the new binary to a temp path
   alongside the current one, `chmod`s it executable, then `rename(2)`s it
   over the live binary path — a rename on the same filesystem is atomic,
   so there is never a window where `streamarr.service` would exec a
   partially-written binary.
4. Restarts `streamarr.service` via `systemctl restart` to pick up the new
   binary, and runs pending database migrations for the configured backend
   as part of that restart's normal startup sequence (migrations are
   already idempotent/run-on-boot at every tier, not update-specific
   behaviour).
5. On any failure in steps 2–3, leaves the currently-running binary and
   service untouched and exits non-zero — a failed update never leaves the
   host without a working `streamarr.service`.

For operators who *do* want unattended updates, `infra/systemd/streamarr-update.timer`
is provided as an opt-in overlay: enabling it
(`sudo systemctl enable --now streamarr-update.timer`) runs
`streamarr update` on a schedule (default weekly) via
`streamarr-update.service`. This is never enabled by the base installer;
turning it on is a separate, explicit step, and it only runs on the
`channel` the operator has configured — there is no forced-upgrade path.
