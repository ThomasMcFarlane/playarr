---
title: Kubernetes
summary: Host Playarr nodes on a Kubernetes cluster with the bundled Helm chart or the Kustomize overlays, one single-replica SQLite node per Deployment.
group: Install
order: 4
badge: Preview
---

Kubernetes suits operators who already run a cluster and want to host Playarr on it. Playarr is SQLite-only, so a Playarr node is one pod that owns one SQLite database file on a persistent volume. There is no database to provision and no shared-database scale-out: you do not run several replicas against one database. Everything lives in `infra/kubernetes/` in the repository: a Helm chart at `infra/kubernetes/helm/playarr/`, and a plain Kustomize skeleton at `infra/kubernetes/base/` with `dev`, `staging` and `prod` overlays. Pick one per cluster; they are not designed to be layered on each other.

> **Status: Preview.** The chart and overlays have only been validated by local rendering (`helm lint`, `helm template`, `kustomize build`). Nobody has run `helm install` against a live cluster, and there is no published chart repository or backend image release yet, so you install from a repository checkout and supply your own image. The chart's `values.yaml` and README are the authority for the exact keys.

## What you need before you start

| Requirement | Notes |
| --- | --- |
| A Kubernetes cluster and `kubectl` | Any conformant cluster. |
| Helm 3 | Only for the chart route. The Kustomize route needs `kustomize` (or `kubectl apply -k`). |
| A checkout of the repository | There is no chart repository to `helm repo add`. |
| A container image the cluster can pull | Build and push your own, see below. |
| A persistent volume for the database | One `ReadWriteOnce` volume per node, mounted where `DATABASE_URL` points. |
| Storage the pod can read your media from | Not provided by either path. You supply the volumes. |
| Optional: Prometheus Operator CRDs | Only if you enable the chart's `ServiceMonitor`. |

## One node per Deployment

Each node is a single-replica Deployment running the image with `PLAYARR_ROLE=all` and `DATABASE_URL=sqlite:///data/playarr.db`, with a persistent volume mounted at `/data`. Use the `Recreate` strategy (or keep one replica with no surge): two pods must never open the same SQLite file at once.

To run more than one node, deploy more than one release, each with its own volume, and connect them with peer sync. Each node keeps its own database and exchanges state with its peers; they do not share storage.

Both ports are the same as everywhere else:

| Port | Name | Purpose |
| --- | --- | --- |
| `8484` | `http` | Application traffic and Playarr Admin at `/`. |
| `9090` | `metrics` | Prometheus `/metrics`. Never expose it publicly. |

`/healthz` is the liveness probe and `/readyz` the readiness probe.

## Step 1, Build and push an image

The chart's default `image.repository` is a placeholder. Build one from the repository root (the Dockerfile's build context must be the root, because it also builds the web assets):

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr

docker build \
  -f infra/docker/backend.Dockerfile \
  -t <YOUR-REGISTRY>/playarr:<YOUR-TAG> \
  .

docker push <YOUR-REGISTRY>/playarr:<YOUR-TAG>
```

The image runs as uid/gid `10001`, exposes `8484` and `9090`, bundles `ffmpeg` and `ffprobe`, and works with a read-only root filesystem.

## Step 2, Create the namespace and, optionally, a Secret

Schema migrations are embedded in the binary and run automatically at pod startup, so there is nothing to prepare in a database.

```bash
kubectl create namespace playarr

kubectl create secret generic playarr-secrets \
  --namespace playarr \
  --from-literal=PLAYARR_JWT_SECRET="$(openssl rand -hex 32)"
```

Set `PLAYARR_JWT_SECRET` to at least 32 bytes. If it is unset or shorter, the process derives a stable secret from its persisted node identity instead, but setting it explicitly remains the recommended configuration. In production, prefer managing that Secret with External Secrets Operator, Sealed Secrets or Vault.

## Step 3, Write a values file

Anything under `config:` in the chart's values is rendered into a ConfigMap and read by the pod as environment variables, so any variable the binary reads can go there. Check `infra/kubernetes/helm/playarr/values.yaml` for the current keys.

```yaml
# my-values.yaml
image:
  repository: <YOUR-REGISTRY>/playarr
  tag: "<YOUR-TAG>"

config:
  DATABASE_URL: "sqlite:///data/playarr.db"
  PLAYARR_LOG: "info"
  PLAYARR_ARTWORK_CACHE_DIR: "/data/playarr-cache/artwork"
  PLAYARR_SUBTITLE_CACHE_DIR: "/data/playarr-cache/subtitles"
```

Mount a persistent volume at `/data` (it holds the database and the caches) and your media read-only at the path your *arr apps report. The root filesystem is read-only, so every writable path must be a volume mount or the `/tmp` emptyDir. `DATABASE_URL` must be a `sqlite:` URL: a `postgres://` URL makes the pod exit at startup with an error.

## Step 4, Install

```bash
helm install playarr infra/kubernetes/helm/playarr \
  --namespace playarr \
  --values my-values.yaml
```

Wait for the pod to become Ready, then follow the logs for the one-time bootstrap admin password:

```bash
kubectl -n playarr rollout status deploy/playarr
kubectl -n playarr logs deploy/playarr | grep 'bootstrap admin'
```

The password is written once, at WARN level, and only when the database has no users. Continue to [First run](/docs/first-run).

Ingress is yours to supply: terminate TLS at your ingress controller and route to the Service on port 8484.

## Backups

The pod's database is a SQLite file on a persistent volume. Use Playarr's built-in backup service for consistent snapshots (see [Upgrade and backup](/docs/upgrade-and-backup)); do not copy the live file out from under a running server.

## Updating

Build and push a new image tag, then `helm upgrade` with the new `image.tag`. Migrations run automatically on the next start. Because the node has one replica and one volume, expect a short outage while the pod restarts.

## Uninstalling

```bash
helm uninstall playarr --namespace playarr
```

The persistent volume claim you provisioned, and the Secret you created out of band, are not removed by Helm. Delete them yourself if you want the data gone.
