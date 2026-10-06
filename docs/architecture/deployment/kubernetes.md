# Deploying Playarr Server: Kubernetes

Kubernetes hosts Playarr Server as one or more **independent SQLite nodes**.
Playarr is SQLite-only ([ADR 0002](../adr/0002-sqlite-only-storage.md),
superseding [ADR 0001](../adr/0001-storage-engine.md)): each Playarr
workload owns one SQLite database file on a persistent volume and runs as a
single replica (`PLAYARR_ROLE=all`). Several nodes, for example one per
region or cluster, cooperate through peer sync, each keeping its own database
([`../peer-groups.md`](../peer-groups.md),
[`../distributed-design.md`](../distributed-design.md)). The earlier
role-split tier, with autoscaled API and worker pools sharing one Postgres
database, was removed; there is no Postgres or Redis dependency, no
HorizontalPodAutoscaler and no worker pool.

## Two deployment paths

`infra/kubernetes/` ships two independent ways to deploy, meant to be
picked one per cluster/environment rather than layered:

1. **`helm/playarr/`** — a Helm chart: one `playarr` workload, a
   PersistentVolumeClaim for the data directory, a `ClusterIP` Service, and
   an optional Prometheus `ServiceMonitor`.
2. **`base/` + `overlays/{dev,staging,prod}/`** — a plain kustomize
   skeleton for teams that don't want a Helm release object in-cluster.

Both deploy the same image (`ghcr.io/playarr/playarr`, built from
`infra/docker/backend.Dockerfile`). The workload does not override the
container's command or args: the image's default
`CMD ["/app/playarr-server", "serve"]` runs unchanged, and `serve` takes no
flags; configuration is environment variables only. Because SQLite permits
one writer at a time, keep the workload at **one replica** with a
`Recreate` rollout (or a StatefulSet), and never mount the same volume into
two pods.

The container exposes:

| Port | Purpose |
|------|---------|
| `8484` (`http`) | Application traffic |
| `9090` (`metrics`) | Prometheus `/metrics` |

and two probe paths, both real routes in `playarr-api`
(`backend/crates/playarr-api/src/lib.rs`): `/healthz` (liveness) and
`/readyz` (readiness).

There is **no Ingress or Gateway API resource** in the chart or the
kustomize skeleton — fronting the Service with an ingress controller or
gateway is left to the cluster operator.

## Configuration

`DATABASE_URL` is a `sqlite:` URL pointing at the file on the mounted
volume (for example `sqlite:///data/playarr.db?mode=rwc`); anything else,
including `postgres://`, fails startup. It is not a credential, so it lives
with the other non-secret settings. The non-secret settings
(`PLAYARR_LOG`, `PLAYARR_HTTP_BIND_ADDR`, `PLAYARR_METRICS_BIND_ADDR`) are
real names read by `playarr-config::Config::from_env`
(`backend/crates/playarr-config`). Secrets such as `PLAYARR_JWT_SECRET`
belong in a Kubernetes Secret provisioned out of band. Container and
Service port fields need plain integers, so the chart carries `metricsPort`
and `probes.port` values that must be kept in sync by hand with the port
numbers in the bind-address variables.

Database migrations run automatically at pod startup (`sqlx::migrate!`).
`terminationGracePeriodSeconds` plus a `preStop` sleep give in-flight
requests time to drain before SIGTERM, which matters for a single replica
holding the database file.

Back the volume up with the server's own backup feature
([`../server-backups.md`](../server-backups.md)) and, where your storage
supports it, volume snapshots.

## Installing

```bash
helm install playarr infra/kubernetes/helm/playarr \
  --namespace playarr --create-namespace \
  -f my-values.yaml
```

There is no published chart repository yet — install directly from a
checkout of this repository. `values.yaml`'s `image.tag` is pinned to
`Chart.yaml`'s `appVersion` by convention, and the templates render
`image.tag | default .Chart.AppVersion`, so an empty tag falls back to a
real pinned version, never `latest`. Set the persistence size and storage
class for your cluster in `my-values.yaml`.

## Self-update story: GitOps/Flux only — never self-updating

Kubernetes is the one deployment where Playarr Server **never** updates itself, by
design — there is no opt-in escape hatch equivalent to the
`playarr update` subcommand or the Compose Watchtower overlay (and, per
[`systemd.md`](systemd.md#self-update-story-opt-in-check-only-and-today-largely-stubbed),
that subcommand's real update logic is still a stub everywhere it exists
today, so this isn't giving up much by not having it). No component
in this repository reaches out to the registry, calls the Kubernetes API
to patch its own workload, or otherwise self-updates from inside the
cluster.

`infra/kubernetes/flux-image-automation.example.yaml` documents the
sanctioned path — **an example file, not wired into any live Flux
Kustomization/HelmRelease in this repository**:

- An `ImageRepository` watching `ghcr.io/playarr/playarr` for new
  tags (5 minute interval).
- An `ImagePolicy` selecting the highest tag matching a semver range
  (`>=0.1.0` in the example — narrow this per environment, e.g. dev
  tracking pre-releases and prod not).
- An `ImageUpdateAutomation` that commits the resulting tag bump back into
  *this git repository* (recommended to a side branch,
  `flux-image-updates`, behind a PR — not straight to `main`) at whatever
  file carries a `# {"$imagepolicy": "flux-system:playarr:tag"}` marker
  comment next to an image reference. For the Helm chart, that's
  `values.yaml`'s `image.tag` field; for the kustomize skeleton, it's
  `base/kustomization.yaml`'s `images[].newTag`. **Neither file in this
  repo carries that marker comment by default** — adding it is a
  deliberate, per-environment opt-in, since it changes who/what is
  allowed to author commits against that file.

None of this is wired into a running Flux `Kustomization`/`HelmRelease` in
this repository — a Flux bootstrap, plus a reconciling `Kustomization`/
`HelmRelease` pointing at `infra/kubernetes/overlays/<env>` (or the Helm
release's values), are prerequisites this example file assumes but
doesn't provide. The result, once wired up, is that every version change
to a Kubernetes deployment exists as a Git commit before it ever exists as a
running pod — reviewable and revertable with `git revert`, rather than
cluster state that could differ from what's declared in Git.
