# Deploying Streamarr: systemd (Tier 1 — single node)

This is the default, recommended way to run Streamarr on a NAS, a
Raspberry Pi, a mini-PC, or any always-on Linux box you administer
directly. It runs one `streamarr` process with `STREAMARR_ROLE=all` (API
and worker loops in the same process — see
[`../overview.md`](../overview.md#the-single-role-gated-binary-principle)),
typically backed by SQLite (see [ADR 0001](../adr/0001-storage-engine.md)
for why SQLite is the Tier 1 default). Nothing about the binary itself
forces that choice, though: `streamarr` derives its deployment tier from
`DATABASE_URL`'s URL scheme, not a separate flag, so a Tier 1 host can
just as validly point at a Postgres instance it already runs.

## What you need

- A 64-bit Linux system with systemd (`systemctl` on `PATH`).
- Enough local disk for your media library plus a data directory for
  Streamarr's state. `install.sh` creates `/var/lib/streamarr` (the
  service's `WorkingDirectory`) and `/var/log/streamarr` for this.
- Root (or sudo) access once, to run the installer, which creates a
  dedicated, unprivileged `streamarr` system user/group that the service
  actually runs as.
- A pre-built `streamarr` binary for the host's architecture. There is no
  hosted one-line installer script in this repository — see "Installing"
  below for the real invocation.

## Installing

The infra tier ships an installer script and three unit files under
`infra/systemd/`:

- `infra/systemd/install.sh` — creates the `streamarr` system user/group;
  lays out `/etc/streamarr`, `/var/lib/streamarr`, `/var/log/streamarr`
  with correct ownership; installs the binary to
  `/usr/local/bin/streamarr`; seeds `/etc/streamarr/streamarr.env` from
  `streamarr.env.example` (only if it doesn't already exist — re-running
  the script never clobbers a live env file); copies the three unit files
  below into `/etc/systemd/system/`; and runs `systemctl daemon-reload`.
  It deliberately does **not** enable or start anything.
- `infra/systemd/streamarr.service` — the main unit. Runs
  `/usr/local/bin/streamarr` with no subcommand (`serve` is what running
  with no subcommand does) as the `streamarr` user/group, with
  `Environment=STREAMARR_ROLE=all` hardcoded directly into the unit (it
  comes after `EnvironmentFile=`, so it always wins over anything set in
  `streamarr.env`), `Restart=on-failure`, `TimeoutStopSec=30` to let
  in-flight work drain before SIGKILL, and a conservative sandbox
  (`NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`,
  `PrivateTmp=true`, `ReadWritePaths=/var/lib/streamarr /var/log/streamarr`,
  `UMask=0027`).
- `infra/systemd/streamarr-update-check.service` and
  `infra/systemd/streamarr-update-check.timer` — an opt-in, check-only
  update-check timer, **shipped installed but disabled**. See "Self-update
  story" below for both what it's meant to do and a real gap between its
  `ExecStart=` and the CLI actually implemented today.

```bash
sudo ./infra/systemd/install.sh /path/to/streamarr    # or place ./streamarr next to install.sh and omit the arg
sudoedit /etc/streamarr/streamarr.env                 # fill in DATABASE_URL (and REDIS_URL if you use one)
sudo systemctl enable --now streamarr.service
systemctl status streamarr.service
journalctl -u streamarr.service -f
```

There is no `config.toml` or any file-based configuration format —
`streamarr` takes all of its configuration from environment variables
(`streamarr-config::Config::from_env`, loaded via
`EnvironmentFile=-/etc/streamarr/streamarr.env`). The values
`streamarr.env.example` actually ships are:

```bash
# --- Required ---
DATABASE_URL=            # postgres://<user>:<password>@<host>:5432/<db>
REDIS_URL=                # redis://<host>:6379/0

# --- Optional (defaults shown match values.yaml's Kubernetes ConfigMap;
#     these are the real names streamarr-config::Config::from_env reads) ---
STREAMARR_LOG=info
STREAMARR_HTTP_BIND_ADDR=0.0.0.0:8080
STREAMARR_METRICS_BIND_ADDR=0.0.0.0:9090
STREAMARR_WEB_ASSETS_DIR=/var/lib/streamarr/web
```

The Admin build is served at `/`. Playarr is hosted separately at
`playarr.app`; the systemd deployment never installs or serves it.

One thing worth knowing before copying that file verbatim:

- **`streamarr.env.example` documents a Postgres `DATABASE_URL`, not a
  SQLite one**, even though SQLite is Tier 1's zero-dependency default per
  ADR 0001. Use a `sqlite:` URL (e.g.
  `sqlite:///var/lib/streamarr/streamarr.db`) if that's the deployment you
  actually want. `REDIS_URL` is genuinely optional in the code
  (`streamarr-config::Config::redis_url: Option<String>`) despite being
  listed under "Required" in the example file — it only changes anything
  when `DATABASE_URL` is already a Postgres URL (see
  `DeploymentTier::resolve`); it's ignored under a `sqlite:` URL.

(An earlier pass of this file and `streamarr.env.example` used
`APP_ENV`/`LOG_LEVEL`/`LOG_FORMAT`/`METRICS_ENABLED`/`METRICS_PORT`/
`HTTP_PORT` instead — none of which `Config::from_env` reads. Fixed to the
real `STREAMARR_*` names above.)

`STREAMARR_ROLE` is intentionally **not** set in `streamarr.env` —
`streamarr.service` pins it to `all` directly (see above), and there is no
`--role` (or any other) command-line flag on `serve` at this or any tier:
`backend/src/main.rs`'s `Command::Serve` takes zero arguments. Role
selection happens purely through the `STREAMARR_ROLE` environment
variable, which accepts `all`, `api`, or `worker` (case-insensitively) and
fails the process at startup on anything else.

Bringing a reverse proxy (Caddy, nginx, Traefik) in front of
`STREAMARR_HTTP_BIND_ADDR` for TLS termination and remote access is the
operator's own choice — `streamarr.service` binds locally and does not
manage certificates itself.

## Operating

- Logs: `journalctl -u streamarr.service -f`.
- Config changes: edit `/etc/streamarr/streamarr.env`, then
  `sudo systemctl restart streamarr.service`. There is no hot-reload —
  everything `Config::from_env` resolves is read once, at process startup.
- Data lives under `/var/lib/streamarr` (the unit's `WorkingDirectory`,
  and — together with `/var/log/streamarr` — the only path the sandboxed
  unit's `ReadWritePaths=` allows it to write to). Back that up if you're
  running SQLite; the database is a single file there.
- Growing beyond one node: point `DATABASE_URL` at a real Postgres
  instance. That alone flips `streamarr-config::DeploymentTier` from
  `SingleNode` to a multi-node tier and switches coordination from the
  no-op `SingleNodeCoordinator` to `PostgresCoordinator` — then move to
  [`docker-compose.md`](docker-compose.md) or
  [`kubernetes.md`](kubernetes.md) for the multi-process orchestration
  around it. There is no built-in data-migration tool in the current CLI
  (`streamarr`'s only subcommands are `serve` and `update`) — copying a
  SQLite database's contents into Postgres is on the operator today.

## Self-update story: opt-in, check-only, and today largely stubbed

systemd installs do **not** update themselves by default —
`streamarr-update-check.timer` ships installed but **disabled**;
`install.sh` never runs `systemctl enable` on it. Opting in is one
explicit step:

```bash
sudo systemctl enable --now streamarr-update-check.timer
```

That's as far as the shipped automation goes: the timer only ever
triggers `streamarr-update-check.service`, a **read-only, check-only**
oneshot — the unit's own comments are explicit that it never downloads,
installs, restarts, or otherwise mutates the running deployment. It fires
daily (`RandomizedDelaySec=1h`, `Persistent=true` to catch up after a host
was off) and logs its result to
`journalctl -u streamarr-update-check.service`.

One thing worth knowing before relying on this, found by reading
`backend/src/main.rs` against the shipped unit files rather than assuming
either is finished (and since fixed):

1. **The check itself is a stub even when invoked correctly.**
   (`streamarr-update-check.service`'s `ExecStart=` now correctly runs
   `/usr/local/bin/streamarr update --check` — the `update` subcommand
   takes `--check`/`--yes`/`--channel <stable|beta|nightly>` **flags**,
   not a `check` sub-subcommand; an earlier pass had
   `update check --log-only`, which `clap` would have rejected outright as
   an unparseable argument every time the unit ran, now fixed.)
   `check_for_update` in `backend/src/main.rs` makes no network call
   today — the HTTP request against a release feed exists only as a
   comment, not live code — and unconditionally reports the running
   binary as up to date against its own compiled-in `CARGO_PKG_VERSION`.
   Applying an update (`streamarr update --yes`) is equally
   unimplemented: `apply_update` always returns an error ("not
   implemented yet") and makes no filesystem changes. The
   atomic-binary-swap-with-signature-verification sequence (download,
   `cosign verify-blob`, staged atomic `rename(2)`, drain, restart) exists
   only as a doc comment on `apply_update` describing the intended future
   implementation — none of those steps run today.

Until `check_for_update`/`apply_update` are actually filled in, both
manual (`sudo streamarr update --check`) and timer-driven update checks
are inert: they will always claim the current build is current, and there
is no working path — opt-in or otherwise — for `streamarr` to update its
own binary yet. Upgrading a systemd install currently means an operator
manually replacing `/usr/local/bin/streamarr` and running
`sudo systemctl restart streamarr.service` themselves.
