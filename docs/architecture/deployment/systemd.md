# Deploying Playarr Server: systemd (Tier 1 — single node)

This is the default, recommended way to run Playarr Server on a NAS, a
Raspberry Pi, a mini-PC, or any always-on Linux box you administer
directly. It runs one `playarr` process with `PLAYARR_ROLE=all` (API
and worker loops in the same process — see
[`../overview.md`](../overview.md#the-single-role-gated-binary-principle)),
typically backed by SQLite (see [ADR 0001](../adr/0001-storage-engine.md)
for why SQLite is the Tier 1 default). Nothing about the binary itself
forces that choice, though: `playarr` derives its deployment tier from
`DATABASE_URL`'s URL scheme, not a separate flag, so a Tier 1 host can
just as validly point at a Postgres instance it already runs.

## What you need

- A 64-bit Linux system with systemd (`systemctl` on `PATH`).
- Enough local disk for your media library plus a data directory for
  Playarr Server's state. `install.sh` creates `/var/lib/playarr` (the
  service's `WorkingDirectory`) and `/var/log/playarr` for this.
- Root (or sudo) access once, to run the installer, which creates a
  dedicated, unprivileged `playarr` system user/group that the service
  actually runs as.
- A pre-built `playarr` binary for the host's architecture. There is no
  hosted one-line installer script in this repository — see "Installing"
  below for the real invocation.

## Installing

The infra tier ships an installer script and three unit files under
`infra/systemd/`:

- `infra/systemd/install.sh` — creates the `playarr` system user/group;
  lays out `/etc/playarr`, `/var/lib/playarr`, `/var/log/playarr`
  with correct ownership; installs the binary to
  `/usr/local/bin/playarr-server`; seeds `/etc/playarr/playarr.env` from
  `playarr.env.example` (only if it doesn't already exist — re-running
  the script never clobbers a live env file); copies the three unit files
  below into `/etc/systemd/system/`; and runs `systemctl daemon-reload`.
  It deliberately does **not** enable or start anything.
- `infra/systemd/playarr.service` — the main unit. Runs
  `/usr/local/bin/playarr-server` with no subcommand (`serve` is what running
  with no subcommand does) as the `playarr` user/group, with
  `Environment=PLAYARR_ROLE=all` hardcoded directly into the unit (it
  comes after `EnvironmentFile=`, so it always wins over anything set in
  `playarr.env`), `Restart=on-failure`, `TimeoutStopSec=30` to let
  in-flight work drain before SIGKILL, and a conservative sandbox
  (`NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`,
  `PrivateTmp=true`, `ReadWritePaths=/var/lib/playarr /var/log/playarr`,
  `UMask=0027`).
- `infra/systemd/playarr-update-check.service` and
  `infra/systemd/playarr-update-check.timer` — an opt-in, check-only
  update-check timer, **shipped installed but disabled**. See "Self-update
  story" below for both what it's meant to do and a real gap between its
  `ExecStart=` and the CLI actually implemented today.

```bash
sudo ./infra/systemd/install.sh /path/to/playarr    # or place ./playarr next to install.sh and omit the arg
sudoedit /etc/playarr/playarr.env                 # fill in DATABASE_URL (and REDIS_URL if you use one)
sudo systemctl enable --now playarr.service
systemctl status playarr.service
journalctl -u playarr.service -f
```

There is no `config.toml` or any file-based configuration format —
`playarr` takes all of its configuration from environment variables
(`playarr-config::Config::from_env`, loaded via
`EnvironmentFile=-/etc/playarr/playarr.env`). The values
`playarr.env.example` actually ships are:

```bash
# --- Required ---
DATABASE_URL=            # postgres://<user>:<password>@<host>:5432/<db>
REDIS_URL=                # redis://<host>:6379/0

# --- Optional (defaults shown match values.yaml's Kubernetes ConfigMap;
#     these are the real names playarr-config::Config::from_env reads) ---
PLAYARR_LOG=info
PLAYARR_HTTP_BIND_ADDR=0.0.0.0:8484
PLAYARR_METRICS_BIND_ADDR=0.0.0.0:9090
# Set both to serve native HTTPS on PLAYARR_HTTP_BIND_ADDR:
# PLAYARR_TLS_CERT_PATH=/etc/playarr/tls/fullchain.pem
# PLAYARR_TLS_KEY_PATH=/etc/playarr/tls/privkey.pem
# Or enable automatic Let's Encrypt HTTPS inside Playarr Server (HTTP-01 on port 80):
# PLAYARR_ACME_DOMAIN=v4-203-0-113-10.relay.playarr.app
# PLAYARR_ACME_ENVIRONMENT=production
# PLAYARR_ACME_ACCEPT_TERMS=true
# PLAYARR_ACME_CONTACT=admin@example.com
# PLAYARR_ACME_CACHE_DIR=/var/lib/playarr/acme
# PLAYARR_ACME_HTTP01_BIND_ADDR=0.0.0.0:80
# Optional authoritative DNS in this same Playarr Server process:
# PLAYARR_RELAY_DNS_BIND_ADDR=0.0.0.0:53
# PLAYARR_RELAY_DNS_ACME_CHALLENGE=_acme-challenge.v4-203-0-113-10.relay.playarr.app=VALIDATION
PLAYARR_WEB_ASSETS_DIR=/var/lib/playarr/web
```

The Admin build is served at `/`. Playarr is hosted separately at
`playarr.app`; the systemd deployment never installs or serves it.

The instance's display name is not an environment variable. It is a
persisted system setting managed in Playarr Server Admin under **System >
Settings**. Playarr reads that setting when labelling a connected server and
when presenting the server attached to an invitation link.

One thing worth knowing before copying that file verbatim:

- **`playarr.env.example` documents a Postgres `DATABASE_URL`, not a
  SQLite one**, even though SQLite is Tier 1's zero-dependency default per
  ADR 0001. Use a `sqlite:` URL (e.g.
  `sqlite:///var/lib/playarr/playarr.db`) if that's the deployment you
  actually want. `REDIS_URL` is genuinely optional in the code
  (`playarr-config::Config::redis_url: Option<String>`) despite being
  listed under "Required" in the example file — it only changes anything
  when `DATABASE_URL` is already a Postgres URL (see
  `DeploymentTier::resolve`); it's ignored under a `sqlite:` URL.

(An earlier pass of this file and `playarr.env.example` used
`APP_ENV`/`LOG_LEVEL`/`LOG_FORMAT`/`METRICS_ENABLED`/`METRICS_PORT`/
`HTTP_PORT` instead — none of which `Config::from_env` reads. Fixed to the
real `PLAYARR_*` names above.)

`PLAYARR_ROLE` is intentionally **not** set in `playarr.env` —
`playarr.service` pins it to `all` directly (see above), and there is no
`--role` (or any other) command-line flag on `serve` at this or any tier:
`backend/src/main.rs`'s `Command::Serve` takes zero arguments. Role
selection happens purely through the `PLAYARR_ROLE` environment
variable, which accepts `all`, `api`, or `worker` (case-insensitively) and
fails the process at startup on anything else.

Playarr Server serves native HTTPS when both `PLAYARR_TLS_CERT_PATH` and
`PLAYARR_TLS_KEY_PATH` are configured. It reads the PEM certificate chain
and private key at startup and terminates TLS inside the Playarr Server process;
no reverse proxy is required. Leave both unset for a private HTTP deployment.

Alternatively, set `PLAYARR_ACME_DOMAIN` and explicitly choose
`PLAYARR_ACME_ENVIRONMENT=production` or `staging`. Playarr Server then uses
Let's Encrypt ACME HTTP-01 itself: it listens on
`PLAYARR_ACME_HTTP01_BIND_ADDR` (port 80 by default), persists the account
and certificate under `PLAYARR_ACME_CACHE_DIR`, serves HTTPS on
`PLAYARR_HTTP_BIND_ADDR`, and hot-renews the certificate without restarting.
The hostname must already resolve publicly to this server and inbound port 80
must be reachable. `PLAYARR_ACME_CONTACT` is optional and accepts either an
email address or a `mailto:` URI. Automatic ACME and the static
`PLAYARR_TLS_*` paths are mutually exclusive. Setting
`PLAYARR_ACME_ACCEPT_TERMS=true` explicitly accepts Let's Encrypt's current
subscriber agreement; automatic HTTPS will not start without that setting.

Setting `PLAYARR_RELAY_DNS_BIND_ADDR` also serves the authoritative
`relay.playarr.app` DNS zone from this same Playarr Server process over UDP and
TCP. For a node whose provider filters HTTP-01 port 80, temporarily set
`PLAYARR_RELAY_DNS_ACME_CHALLENGE` on the authoritative DNS instance to the
exact `_acme-challenge` hostname and unpadded base64url validation joined by
`=`. It serves only that TXT record; remove the setting immediately after
certificate issuance. The systemd unit grants only the low-port bind capability needed for
ports 53 and 80; DNS and automatic ACME remain disabled unless their variables
are set.

## Operating

- Logs: `journalctl -u playarr.service -f`.
- Config changes: edit `/etc/playarr/playarr.env`, then
  `sudo systemctl restart playarr.service`. There is no hot-reload —
  everything `Config::from_env` resolves is read once, at process startup.
- Data lives under `/var/lib/playarr` (the unit's `WorkingDirectory`,
  and — together with `/var/log/playarr` — the only path the sandboxed
  unit's `ReadWritePaths=` allows it to write to). Back that up if you're
  running SQLite; the database is a single file there.
- Growing beyond one node: point `DATABASE_URL` at a real Postgres
  instance. That alone flips `playarr-config::DeploymentTier` from
  `SingleNode` to a multi-node tier and switches coordination from the
  no-op `SingleNodeCoordinator` to `PostgresCoordinator` — then move to
  [`docker-compose.md`](docker-compose.md) or
  [`kubernetes.md`](kubernetes.md) for the multi-process orchestration
  around it. There is no built-in data-migration tool in the current CLI
  (`playarr`'s only subcommands are `serve` and `update`) — copying a
  SQLite database's contents into Postgres is on the operator today.

## Self-update story: opt-in, check-only, and today largely stubbed

systemd installs do **not** update themselves by default —
`playarr-update-check.timer` ships installed but **disabled**;
`install.sh` never runs `systemctl enable` on it. Opting in is one
explicit step:

```bash
sudo systemctl enable --now playarr-update-check.timer
```

That's as far as the shipped automation goes: the timer only ever
triggers `playarr-update-check.service`, a **read-only, check-only**
oneshot — the unit's own comments are explicit that it never downloads,
installs, restarts, or otherwise mutates the running deployment. It fires
daily (`RandomizedDelaySec=1h`, `Persistent=true` to catch up after a host
was off) and logs its result to
`journalctl -u playarr-update-check.service`.

One thing worth knowing before relying on this, found by reading
`backend/src/main.rs` against the shipped unit files rather than assuming
either is finished (and since fixed):

1. **The check itself is a stub even when invoked correctly.**
   (`playarr-update-check.service`'s `ExecStart=` now correctly runs
   `/usr/local/bin/playarr-server update --check` — the `update` subcommand
   takes `--check`/`--yes`/`--channel <stable|beta|nightly>` **flags**,
   not a `check` sub-subcommand; an earlier pass had
   `update check --log-only`, which `clap` would have rejected outright as
   an unparseable argument every time the unit ran, now fixed.)
   `check_for_update` in `backend/src/main.rs` makes no network call
   today — the HTTP request against a release feed exists only as a
   comment, not live code — and unconditionally reports the running
   binary as up to date against its own compiled-in `CARGO_PKG_VERSION`.
   Applying an update (`playarr update --yes`) is equally
   unimplemented: `apply_update` always returns an error ("not
   implemented yet") and makes no filesystem changes. The
   atomic-binary-swap-with-signature-verification sequence (download,
   `cosign verify-blob`, staged atomic `rename(2)`, drain, restart) exists
   only as a doc comment on `apply_update` describing the intended future
   implementation — none of those steps run today.

Until `check_for_update`/`apply_update` are actually filled in, both
manual (`sudo playarr-server update --check`) and timer-driven update checks
are inert: they will always claim the current build is current, and there
is no working path — opt-in or otherwise — for `playarr` to update its
own binary yet. Upgrading a systemd install currently means an operator
manually replacing `/usr/local/bin/playarr-server` and running
`sudo systemctl restart playarr.service` themselves.
