# Deploying Streamarr: Kubernetes (Tier 3 — scaled cluster)

Tier 3 is for operators running Streamarr as real shared infrastructure:
autoscaled API capacity, a dedicated worker pool for background transcode
work, and a Postgres instance that is expected to already exist as
cluster-managed or externally managed infrastructure rather than something
the chart provisions ad hoc. It uses `PostgresCoordinator` for cluster
coordination, with gossip membership available as an opt-in for large
clusters (see [`../distributed-design.md`](../distributed-design.md)).

## The Helm chart

The infra tier ships a Helm chart at `deploy/helm/streamarr/`:

- `deploy/helm/streamarr/Chart.yaml` — chart metadata, `appVersion` pinned
  to the Streamarr release the chart's default `values.yaml` targets.
- `deploy/helm/streamarr/values.yaml` — the configurable surface: image
  tag, replica counts per role, Postgres connection (either a `postgresql`
  subchart dependency for clusters that want the chart to provision
  Postgres, or `postgresql.external.connectionString` to point at an
  already-managed instance), ingress host/TLS config, resource
  requests/limits per role, and the `library.roots` persistent-volume
  claims media is mounted from.
- `deploy/helm/streamarr/templates/` — templates rendering, per role, a
  `Deployment` (`api-deployment.yaml`, `worker-deployment.yaml`,
  `coordinator-deployment.yaml` — though `coordinator` is frequently just
  the `api` role set with `COORDINATOR` included rather than a fourth pool;
  see the role-set discussion in [`../overview.md`](../overview.md)), a
  `Service` and `Ingress` for the `api` role, an `HorizontalPodAutoscaler`
  for the `api` and `worker` `Deployments`, a `ConfigMap` for
  non-secret config, and a `Secret` template consuming
  externally-supplied database credentials (never generating or storing
  secrets in the chart itself).

Representative shape of the `api` `Deployment` template:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "streamarr.fullname" . }}-api
spec:
  replicas: {{ .Values.api.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/component: api
  template:
    spec:
      containers:
        - name: streamarr
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          args: ["serve", "--role", "api"]
          env:
            - name: STREAMARR_DATABASE_BACKEND
              value: postgres
            - name: STREAMARR_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{ include "streamarr.fullname" . }}-db
                  key: connectionString
          readinessProbe:
            httpGet: { path: /api/system/health, port: 8443 }
          livenessProbe:
            httpGet: { path: /api/system/health, port: 8443 }
```

The `worker` `Deployment` template is identical apart from
`args: ["serve", "--role", "worker"]` and its own `HorizontalPodAutoscaler`
tuned against queue depth (background Tdarr job backlog) rather than the
`api` pool's CPU/request-rate-based scaling — background work and on-demand
API traffic are deliberately scaled on different signals, matching the
split described in
[`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split).

## Installing

```bash
helm repo add streamarr https://charts.streamarr.dev
helm install streamarr streamarr/streamarr \
  --namespace streamarr --create-namespace \
  -f my-values.yaml
```

or, from a checkout of this repository, directly against the chart path:

```bash
helm install streamarr deploy/helm/streamarr \
  --namespace streamarr --create-namespace \
  -f my-values.yaml
```

`my-values.yaml` at minimum sets `postgresql.external.connectionString` (or
`postgresql.enabled: true` to use the bundled subchart for smaller
clusters), `ingress.host`, and `library.roots` persistent volume claims.
Database migrations run automatically as part of the `api` pods' startup
sequence on first rollout, identically to Tiers 1 and 2 (same
`sqlx::migrate!` mechanism from [ADR 0001](../adr/0001-storage-engine.md)).

## Coordination and session affinity at this tier

`PostgresCoordinator` handles leader election (scheduler, migration runner)
across however many `api`/`worker` pods are running, via the shared
Postgres instance every Tier 3 deployment already has, per
[`../distributed-design.md`](../distributed-design.md). Clusters large
enough that per-node Postgres heartbeat writes become a meaningful load can
opt into gossip-based membership (`cluster.membership: gossip` in
`values.yaml`, translated to the `streamarr` config's
`cluster.membership` field) without changing how leadership itself is
elected.

On-demand transcode session affinity uses the signed-redirect mechanism by
default (works with any ingress controller unmodified). Where the cluster's
ingress controller supports session-affinity cookies (e.g. NGINX Ingress's
`nginx.ingress.kubernetes.io/affinity: cookie` annotation), the chart's
`ingress.sessionAffinity: true` value adds that annotation as an
optimisation on top — both mechanisms are described in full in
[`../distributed-design.md`](../distributed-design.md).

## Self-update story: GitOps/Flux only — never self-updating

Kubernetes is the one tier where Streamarr **never** updates itself, by
design, with no opt-in escape hatch equivalent to Tier 1's `streamarr
update` or Tier 2's Watchtower overlay. A running pod does not check for,
download, or apply a new version of itself under any configuration — the
only way a Tier 3 deployment's image tag changes is through the cluster's
own GitOps reconciliation.

The chart is designed to be driven by FluxCD (ArgoCD works equivalently;
Flux is the reference path documented here):

- `deploy/gitops/streamarr-helmrelease.yaml` — a Flux `HelmRelease`
  pointing at the chart with a `values.yaml` override checked into the
  cluster's Git repository (the source of truth for what's actually
  running), reconciled by `helm-controller` whenever that file changes in
  Git.
- `deploy/gitops/streamarr-imagepolicy.yaml` — a Flux `ImageRepository` +
  `ImagePolicy` pair, watching the `streamarr/streamarr` registry and
  selecting new tags matching a configured policy (e.g. semver range,
  respecting the release/apiVersion contract in
  [`../../versioning-policy.md`](../../versioning-policy.md)).
- `deploy/gitops/streamarr-imageupdate.yaml` — an `ImageUpdateAutomation`
  that, when new tags matching the policy appear, opens a commit against
  the `HelmRelease`'s `image.tag` value in Git — **not** against the live
  cluster directly.

The result is that every version change to a Tier 3 deployment exists as a
Git commit before it ever exists as a running pod: reviewable, revertable
with `git revert`, and auditable through normal Git history rather than
through cluster state that could differ from what's declared. This is
treated as a hard requirement rather than a preference, because Tier 3 is
explicitly the tier for shared, higher-stakes infrastructure where an
unreviewed, unattended version change is the failure mode GitOps exists to
prevent — the opposite tradeoff from Tier 1, where the entire point is
minimising the operational burden on a single unattended box with nobody
watching a Git history for it.

Operators who want automatic-but-reviewed rollout can configure Flux's
`ImageUpdateAutomation` to auto-commit and auto-merge tag bumps matching a
narrow policy (e.g. patch releases only); anything wider than that is a
cluster-operator policy decision made in their own Flux configuration, not
something `deploy/helm/streamarr` or the `streamarr` binary itself decides
on their behalf.
