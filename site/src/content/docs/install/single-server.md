---
title: Single server (systemd)
summary: Install Playarr as a single systemd service backed by SQLite on one always-on Linux box, a Raspberry Pi, a NAS, a mini-PC or a home server.
group: Install
order: 2
badge: Preview
---

This is the smallest way to run Playarr: one compiled binary, one SQLite file, one machine. It suits a Raspberry Pi 4/5, a Synology or QNAP NAS, a mini-PC or any always-on Linux box you administer directly. There are no external services to stand up, no Postgres, no Redis, no message broker, and the whole thing survives an unattended reboot because systemd owns it.

Playarr never picks a deployment tier from a flag. It derives one from the scheme of `DATABASE_URL`: a `sqlite:` URL means single-node, so the coordinator is a no-op and the cache is in-process. Pointing the same binary at `postgres://` later is all it takes to graduate to a bigger tier.

> Playarr reads a library you already have on disk and reconciles metadata from *arr apps you already run. It plays what is there; it does not put anything there.

## Before you start

| Requirement | Detail |
| --- | --- |
| Operating system | 64-bit Linux with systemd. `install.sh` refuses to run if `uname -s` is not `Linux` or `systemctl` is not on `PATH`. |
| Privileges | `root`/`sudo`, once, to run the installer. The service itself runs as an unprivileged `playarr` system user. |
| CPU architecture | The release tooling targets `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`. A 32-bit `armv7` board is not a CI target and needs a local build. |
| `ffmpeg` and `ffprobe` | Required on `PATH`. See [FFmpeg](#ffmpeg-is-a-hard-runtime-requirement) below. |
| Disk | Your media, plus a data directory for Playarr's own state under `/var/lib/playarr`. |
| Network | One free TCP port for the app (`8484` by default) and one for metrics (`9090` by default). |

### FFmpeg is a hard runtime requirement

Playarr shells out to `ffprobe` to read container durations and stream layouts, and to `ffmpeg` to extract subtitles into WebVTT and to produce on-demand HLS renditions. Neither binary is bundled with the server binary, and a bare-metal install must supply both.

```bash
# Debian, Ubuntu, Raspberry Pi OS
sudo apt-get update && sudo apt-get install -y ffmpeg

# Fedora (RPM Fusion enabled)
sudo dnf install -y ffmpeg
```

Confirm both are visible on `PATH` before continuing:

```bash
ffmpeg -version
ffprobe -version
```

If your distribution installs them somewhere unusual, point Playarr at them explicitly with `PLAYARR_FFMPEG_BINARY` and `PLAYARR_FFPROBE_BINARY` (both default to a bare `ffmpeg` / `ffprobe` resolved on `PATH`).

> **Hardware acceleration: not built yet.** There is no VAAPI, NVENC, QSV, CUDA or VideoToolbox path anywhere in the server. The on-demand transcode command is built with `-c:v libx264`, a software encoder, and no unit file, container or manifest in the repository passes through `/dev/dri` or an NVIDIA runtime. Size your machine for software transcoding, or keep files your devices can already play directly.

## 1. Obtain the `playarr` binary

Each Playarr release (a `v<version>` GitHub Release) carries `playarr-server-<version>-linux-amd64.tar.gz` and `playarr-server-<version>-linux-arm64.tar.gz`, each with a `.sha256` sidecar. The newest is always at `https://playarr.app/downloads/server/playarr-server-linux-amd64.tar.gz` (or `-arm64`), and the container image is `ghcr.io/thomasmcfarlane/playarr:<version>`. There is no hosted one-line installer script; building from source also works.

### Build from source

You need a Rust toolchain and a working C linker (`build-essential` on Debian/Ubuntu, `gcc` elsewhere). The repository pins the `stable` channel via `rust-toolchain.toml` at the repository root, so `rustup` selects it automatically for any `cargo` command run inside the tree.

```bash
git clone https://github.com/playarr/playarr.git
cd playarr/backend
cargo build --release --bin playarr
```

`backend/Cargo.toml` is both the Cargo workspace root and the `playarr-bin` package, so the binary lands at `backend/target/release/playarr`. Both the SQLite and Postgres database drivers are compiled into every build, the backend is a runtime configuration value, never a build feature, so this one artefact serves every tier.

### Or unpack a release tarball, once one exists

The `.sha256` sidecar is generated inside the workflow's own `dist/` directory, so the path it records is `dist/playarr-…tar.gz` and a bare `sha256sum -c` against it will not find the file. Compare the digests instead:

```bash
sha256sum playarr-aarch64-unknown-linux-gnu.tar.gz
cat playarr-aarch64-unknown-linux-gnu.tar.gz.sha256   # same digest, path prefixed with dist/

tar -xzf playarr-aarch64-unknown-linux-gnu.tar.gz    # yields ./playarr
```

The tarball contains the bare executable. `install.sh` refuses a source path that is not a regular, executable file, so keep the extracted permission bits (do not, for example, copy it through a filesystem that drops them).

## 2. Run the installer

`infra/systemd/install.sh` creates the service user, the directory layout, and installs the unit files. It deliberately does **not** enable or start anything, that is a separate, explicit decision you make after reviewing the configuration.

```bash
sudo ./infra/systemd/install.sh /path/to/playarr
```

If you place the binary next to `install.sh` as `./playarr`, you can omit the argument.

Re-running the installer is safe: it never overwrites an existing `/etc/playarr/playarr.env`.

### What it creates

| Path | Owner : group | Mode | Purpose |
| --- | --- | --- | --- |
| `playarr` system user and group |, |, | `useradd --system --user-group --home-dir /var/lib/playarr --no-create-home --shell /usr/sbin/nologin` |
| `/etc/playarr` | `root:playarr` | `0750` | Configuration directory |
| `/etc/playarr/playarr.env` | `root:playarr` | `0640` | Seeded from `playarr.env.example` only if absent |
| `/var/lib/playarr` | `playarr:playarr` | `0750` | `WorkingDirectory`; the SQLite database and all caches live here |
| `/var/log/playarr` | `playarr:playarr` | `0750` | Writable log directory |
| `/usr/local/bin/playarr` | `root:root` | `0755` | The binary |
| `/etc/systemd/system/playarr.service` | `root:root` | `0644` | The main unit |
| `/etc/systemd/system/playarr-update-check.service` | `root:root` | `0644` | Check-only oneshot |
| `/etc/systemd/system/playarr-update-check.timer` | `root:root` | `0644` | Installed **disabled** |

It finishes with `systemctl daemon-reload` and prints the remaining steps.

> **Ignore one line of the installer's own output.** Its printed summary says "at minimum DATABASE_URL and REDIS_URL are required". `REDIS_URL` is not required, and is ignored outright on this tier, see [the corrections below](#three-corrections-to-the-shipped-example-file).

> Playarr's logging layer writes JSON to stdout, so in practice everything goes to the journal rather than to `/var/log/playarr`. The directory exists and is writable because the sandbox allowlists it.

## 3. Configure `/etc/playarr/playarr.env`

Playarr has **no configuration file format at all**. There is no `config.toml`, no YAML, no `--config` flag. Every setting is an environment variable, read once by `playarr-config::Config::from_env` at process startup and loaded here via the unit's `EnvironmentFile=`.

```bash
sudoedit /etc/playarr/playarr.env
```

### The genuine minimum

One line is enough to boot:

```bash
DATABASE_URL=sqlite:///var/lib/playarr/playarr.db
```

For any deployment you intend to keep, add a stable signing secret:

```bash
DATABASE_URL=sqlite:///var/lib/playarr/playarr.db
PLAYARR_JWT_SECRET=<64 random hex characters, generate with: openssl rand -hex 32>
PLAYARR_LOG=info
PLAYARR_HTTP_BIND_ADDR=0.0.0.0:8484
PLAYARR_METRICS_BIND_ADDR=0.0.0.0:9090
```

`PLAYARR_JWT_SECRET` must be at least 32 bytes; anything shorter is ignored with a warning. If it is unset, Playarr mints a random secret for the lifetime of that boot, which means every restart signs out every signed-in device.

### Three corrections to the shipped example file

The seeded `/etc/playarr/playarr.env` is a copy of `infra/systemd/playarr.env.example`, which was written against a Postgres deployment. Fix these before you start the service.

> **`DATABASE_URL` is blank and commented for Postgres.** Replace it with the `sqlite:` URL above. SQLite is the single-server default.

> **`REDIS_URL` is listed under a `# --- Required ---` heading. It is not required.** The code models it as an `Option`, an empty value is treated as unset, and it is ignored entirely when `DATABASE_URL` is a `sqlite:` URL. Leave it blank.

> **`GOOGLE_APPLICATION_CREDENTIALS` and `PLAYARR_FIREBASE_WEB_CONFIG` are uncommented and will stop the service booting.** The first points at `/etc/playarr/firebase-service-account.json`, a file the installer does not create; the server reads it eagerly and fails startup if it is missing. The second is set to an empty string, which is parsed as JSON and fails. **Comment out both lines** unless you are actually configuring Firebase messaging, which is entirely optional and not needed for a first install.

### Configuration reference

These are the variables that matter on a single server. Every one is read at startup only, there is no hot reload.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | *(none, startup fails)* | `sqlite:///var/lib/playarr/playarr.db` for this tier. |
| `PLAYARR_ROLE` | `all` | Pinned to `all` by the unit file; anything you set here is overridden. |
| `PLAYARR_JWT_SECRET` | random per boot | Minimum 32 bytes. Set it. |
| `PLAYARR_LOG` | `info` | A `tracing` `EnvFilter` directive, e.g. `info,playarr_api=debug`. |
| `PLAYARR_HTTP_BIND_ADDR` | `0.0.0.0:8484` | A full socket address, **not** a bare port. |
| `PLAYARR_METRICS_BIND_ADDR` | `0.0.0.0:9090` | Prometheus `/metrics`. Do not expose this publicly. |
| `PLAYARR_AUTH_MODE` | `full-account` | Or `trusted-network`, which auto-signs-in requests from an allowlisted IP range as the default admin. |
| `PLAYARR_TRUSTED_NETWORK_CIDR` | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1/32`, `::1/128` | A **single** CIDR, which **replaces** rather than extends that default list. An unparseable value warns and falls back to the default. |
| `PLAYARR_BOOTSTRAP_ADMIN_USERNAME` | `admin` | Username of the auto-provisioned first admin. |
| `PLAYARR_BOOTSTRAP_ADMIN_PASSWORD` | random 64 hex chars | If unset, a real random password is generated and logged once. |
| `PLAYARR_WEB_ASSETS_DIR` | `web/` next to the binary | Directory holding Playarr Admin's built `index.html` and `assets/`. |
| `PLAYARR_ARTWORK_CACHE_DIR` | derived from the SQLite path | See [caches](#where-state-lives-on-disk). |
| `PLAYARR_FFMPEG_BINARY` | `ffmpeg` | Override the executable used for transcoding and subtitle extraction. |
| `PLAYARR_FFPROBE_BINARY` | `ffprobe` | Override the executable used for container probing. |
| `PLAYARR_MEDIA_REMOTE_ROOT` | unset | Path prefix as an *arr app reports it. Must be set together with the next one. |
| `PLAYARR_MEDIA_LOCAL_ROOT` | unset | Where that same root is mounted on this host. If only one is set, the substitution is skipped. |
| `PLAYARR_TLS_CERT_PATH` / `PLAYARR_TLS_KEY_PATH` | unset | Set both or neither; see [HTTPS](#optional-https). |
| `PLAYARR_ACME_DOMAIN` | unset | Automatic Let's Encrypt HTTPS; see [HTTPS](#optional-https). |

### Where state lives on disk

Everything Playarr owns sits under `/var/lib/playarr`, which is the unit's `WorkingDirectory` and one of only two paths the sandbox permits it to write to.

| What | Path |
| --- | --- |
| SQLite database | `/var/lib/playarr/playarr.db` (plus `-wal` and `-shm` companions) |
| Artwork cache | `/var/lib/playarr/cache/artwork` |
| Episode thumbnails | `/var/lib/playarr/artwork-cache/episode-thumbnails` |
| Subtitle cache (WebVTT) | `/var/lib/playarr/subtitle-cache` |
| ACME account and certificate | `/var/lib/playarr/acme` (only when automatic HTTPS is on) |
| On-demand transcode output | `<tmpdir>/playarr-transcode` inside the unit's private `/tmp` |

The database file is created on first connect, `?mode=rwc` is appended automatically to any `sqlite:` URL that does not already specify a mode. The pool then sets `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 30000`. Schema migrations are embedded in the binary and applied automatically at every startup.

The artwork cache path is derived from the database file's parent directory when `DATABASE_URL` begins `sqlite://`. If you move the database elsewhere, set `PLAYARR_ARTWORK_CACHE_DIR` explicitly so the cache follows it.

> The transcode output root is **not** configurable by any environment variable. Because the unit sets `PrivateTmp=true`, it lands in a private `/tmp`; on distributions where `/tmp` is a tmpfs, that space is RAM-backed. Keep an eye on it if you expect several concurrent transcode sessions.

## 4. The unit file

This is `/etc/systemd/system/playarr.service`, installed verbatim from `infra/systemd/playarr.service`. Long explanatory comments have been abridged here; the installed file keeps them.

```ini
[Unit]
Description=Playarr media automation service
Documentation=https://github.com/playarr/playarr
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=playarr
Group=playarr

EnvironmentFile=-/etc/playarr/playarr.env

Environment=PLAYARR_ROLE=all

ExecStart=/usr/local/bin/playarr
WorkingDirectory=/var/lib/playarr

Restart=on-failure
RestartSec=5

TimeoutStopSec=30

# --- Sandboxing / hardening ---
NoNewPrivileges=true
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/playarr /var/log/playarr
UMask=0027

[Install]
WantedBy=multi-user.target
```

What each of the load-bearing directives is doing:

| Directive | Why |
| --- | --- |
| `ExecStart=/usr/local/bin/playarr` | No subcommand. Running the binary with no subcommand *is* `serve`. There is no `--role` or `--config` flag; `serve` takes zero arguments. |
| `Environment=PLAYARR_ROLE=all` | Appears **after** `EnvironmentFile=`, and systemd lets the later directive win for duplicate keys, so this always beats anything in `playarr.env`. A single server runs the API and the background worker loops in one process, which is also the only configuration where a live transcode can be promoted into a durable rendition, because that hand-off is an in-process channel. |
| `EnvironmentFile=-/etc/playarr/playarr.env` | The `-` prefix means a missing file does not block startup, but the process will then fail its own validation for the missing `DATABASE_URL` and restart-loop until you fix it. |
| `Restart=on-failure` + `StartLimitIntervalSec=300` / `StartLimitBurst=5` | Restart on crash, but give up after five failures in five minutes rather than hammering a broken configuration forever. |
| `TimeoutStopSec=30` | Time to drain in-flight requests and jobs on `SIGTERM` before systemd escalates to `SIGKILL`. |
| `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `UMask=0027` | A conservative sandbox: the filesystem is read-only apart from `ReadWritePaths=`, home directories are hidden, `/tmp` is private, and privileges cannot be escalated. |
| `ReadWritePaths=/var/lib/playarr /var/log/playarr` | The only two writable paths. If you relocate the database, artwork cache or ACME directory outside these, add the new path here or the service cannot write to it. |
| `AmbientCapabilities=CAP_NET_BIND_SERVICE` | The single privilege granted, needed only if you enable the optional ACME listener on port 80 or the optional DNS listener on port 53. Nothing binds a low port by default. |

The unit's header also carries a commented-out `After=postgresql.service redis.service` pair. Leave it commented for a SQLite install.

> The commit that added these units notes they were authored on a machine without systemd and have not been checked with `systemd-analyze verify`. Run `systemd-analyze verify playarr.service` after installing if you want that confirmation on your own host.

## 5. Enable and start

```bash
sudo systemctl enable --now playarr.service
```

`enable` wires it to `multi-user.target` so it comes back after a reboot; `--now` starts it immediately.

## 6. Retrieve the bootstrap admin credentials

On the very first boot against an empty database, Playarr provisions exactly one administrator before it serves any traffic. If you did not set `PLAYARR_BOOTSTRAP_ADMIN_PASSWORD`, a random 64-character password is generated, hashed with Argon2id for storage, and written to the journal **once**, at `WARN`:

```bash
journalctl -u playarr.service | grep 'bootstrap admin'
```

Save it now, it is not shown again. If any user already exists, this step is a no-op.

> The bootstrap admin is granted `is_admin` but deliberately **not** `can_stream`. It exists to operate Playarr's admin surface, not to watch things. Create a separate account for yourself as a viewer.

Authentication defaults to `full-account`, meaning every sign-in needs a real username and password. The `trusted-network` mode is opt-in and auto-signs-in any request from an allowlisted private range as the default admin, convenient on a trusted LAN, unsuitable anywhere else.

## 7. Check it is healthy

```bash
systemctl status playarr.service
```

Then hit the endpoints directly. `/healthz` is liveness, `/readyz` flips to 200 only once migrations have applied and the listener is genuinely serving, and the version envelope needs no authentication:

```bash
curl -fsS http://127.0.0.1:8484/healthz
curl -fsS http://127.0.0.1:8484/readyz
curl -fsS http://127.0.0.1:8484/api/system/version
```

Metrics are served on their own port, by every role, unconditionally:

```bash
curl -fsS http://127.0.0.1:9090/metrics | head
```

A healthy first boot emits, roughly in this order: `starting playarr` carrying the resolved `role` and derived `deployment_tier`; `metrics listener listening` on the metrics address; the bootstrap admin `WARN` (first boot only); and finally `http server listening`, or `https server listening with static certificate`, on the application address. Migrations, and the creation of the two default library views ("Newly Added" and "Newly Released"), are both silent when they succeed and only log if they fail, so their absence from the journal is the expected case rather than a problem.

## Logs

Playarr logs structured JSON to stdout, so systemd captures everything in the journal.

```bash
journalctl -u playarr.service -f            # follow
journalctl -u playarr.service -n 200        # last 200 lines
journalctl -u playarr.service --since today
```

Raise verbosity per module with `PLAYARR_LOG`, then restart:

```bash
PLAYARR_LOG=info,playarr_api=debug,playarr_arr_sync=debug
```

Configuration is read once at startup, so every change to `/etc/playarr/playarr.env` needs:

```bash
sudo systemctl restart playarr.service
```

## Optional: HTTPS

Three transport modes are mutually exclusive and chosen at startup.

| Mode | How | When |
| --- | --- | --- |
| Plain HTTP | Set neither TLS nor ACME variables. | The default. Fine behind your own reverse proxy, or on a trusted LAN. |
| Static certificate | Set both `PLAYARR_TLS_CERT_PATH` and `PLAYARR_TLS_KEY_PATH`. | You already have a certificate. Playarr terminates TLS in-process on `PLAYARR_HTTP_BIND_ADDR`; no proxy needed. |
| Automatic Let's Encrypt | Set `PLAYARR_ACME_DOMAIN`, `PLAYARR_ACME_ENVIRONMENT` and `PLAYARR_ACME_ACCEPT_TERMS=true`. | The hostname already resolves publicly to this machine and inbound port 80 is reachable. |

Setting both a static certificate and an ACME domain is a hard startup error, as is setting only one of the two TLS paths.

```bash
# Static certificate. The key must be readable by the playarr group.
PLAYARR_TLS_CERT_PATH=/etc/playarr/tls/fullchain.pem
PLAYARR_TLS_KEY_PATH=/etc/playarr/tls/privkey.pem
```

```bash
# Automatic HTTPS. PLAYARR_ACME_ENVIRONMENT is mandatory and must be
# exactly "production" or "staging", so a staging certificate can never be
# mistaken for a browser-trusted one. ACCEPT_TERMS must be the literal "true".
PLAYARR_ACME_DOMAIN=<YOUR-PUBLIC-HOSTNAME>
PLAYARR_ACME_ENVIRONMENT=production
PLAYARR_ACME_ACCEPT_TERMS=true
PLAYARR_ACME_CONTACT=<YOU>@example.com
PLAYARR_ACME_CACHE_DIR=/var/lib/playarr/acme
PLAYARR_ACME_HTTP01_BIND_ADDR=0.0.0.0:80
```

In ACME mode Playarr runs its own HTTP-01 challenge listener, 308-redirects plain HTTP arriving there to the HTTPS origin, persists account and certificate state under the cache directory, and renews without a restart. If no certificate is issued within 120 seconds of startup the process exits with an error.

If you prefer your own proxy, leave both sets unset and reverse-proxy to `127.0.0.1:8484`. Never proxy port 9090 to the public edge.

## Optional: co-host Playarr Admin

Playarr Admin is the operator-facing React UI, served by the same binary at `/` on the same origin and port as the API, the same pattern the *arr apps use. If no `index.html` is found at the resolved path, the server serves the API only and logs an informational line saying so. Nothing is installed for you: `install.sh` copies the binary and the units and nothing else.

Building it needs Node 20 or newer and pnpm 9 or newer; the workspace pins pnpm through Corepack. From a checkout of the repository:

```bash
corepack enable && corepack prepare pnpm@11.13.0 --activate
cd /path/to/playarr/clients/tv-web
pnpm install --frozen-lockfile
pnpm --filter @playarr-tv/admin... run build
```

The trailing `...` on the filter matters. `@playarr-tv/admin` imports three workspace packages (`@playarr-tv/api-client`, `@playarr-tv/device-auth`, `@playarr-tv/domain`) whose `main`/`exports` point at their own `dist/` output, so the build fails on a fresh checkout without it. Do not substitute `pnpm -r run build`, that also drives the TV app shells' packaging steps, which need `ares-package` and the Tizen Studio CLI.

Copy the result into a directory the sandbox can read, then point the server at it:

```bash
sudo install -d -o playarr -g playarr -m 0750 /var/lib/playarr/web
sudo cp -r admin/dist/. /var/lib/playarr/web/
sudo chown -R playarr:playarr /var/lib/playarr/web
```

```bash
# in /etc/playarr/playarr.env, the shipped example file already sets
# this exact line, so on a seeded install there is usually nothing to add.
PLAYARR_WEB_ASSETS_DIR=/var/lib/playarr/web
```

```bash
sudo systemctl restart playarr.service
```

Playarr, the viewing client, is a separate application, and `install.sh` never installs or serves it. The official container image also reserves this slot for Playarr Admin; Playarr Web is hosted independently at its public origins.

## Updating and backing up

**Upgrading is manual.** Replace the binary and restart; the embedded migrations run on the next start.

```bash
sudo install -o root -g root -m 0755 /path/to/new/playarr /usr/local/bin/playarr
sudo systemctl restart playarr.service
```

> **Self-update is not built yet.** `playarr-update-check.timer` ships installed but disabled, and enabling it is one explicit `systemctl enable --now playarr-update-check.timer`. Even then, `playarr update --check` makes no network call today and unconditionally reports the running binary as current, and `playarr update --yes` returns "not implemented yet" and touches no files. The signed-download-and-atomic-swap sequence exists only as a doc comment describing intended future work. Treat both as inert.

**Backups.** The repository ships no backup script, restore procedure or snapshot tooling. On this tier the state that matters is a single directory:

```bash
sudo systemctl stop playarr.service
sudo tar -czf playarr-backup-$(date +%F).tar.gz -C /var/lib playarr
sudo systemctl start playarr.service
```

Stopping the service first is the simple way to get a consistent copy of a WAL-mode SQLite database along with its `-wal` and `-shm` companions. Keep `/etc/playarr/playarr.env` somewhere safe too, losing `PLAYARR_JWT_SECRET` signs out every device.

**Growing to a bigger tier.** Point `DATABASE_URL` at a Postgres instance and the binary switches coordinator and cache backends by itself. There is no built-in tool to move existing SQLite data into Postgres; that is on you today.

## Next

The service is running, the database exists, and you have admin credentials. Continue to [First run](/docs/first-run) to sign in, register the *arr instances Playarr should reconcile metadata from, and connect your first Playarr client.
