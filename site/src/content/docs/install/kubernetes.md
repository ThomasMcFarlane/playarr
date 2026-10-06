---
title: Kubernetes
summary: Host Playarr nodes on a Kubernetes cluster with the bundled Helm chart or the Kustomize overlays, one single-replica SQLite node per StatefulSet.
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
| A storage class for the database volume | The chart's StatefulSet requests one `ReadWriteOnce` volume per node through a `volumeClaimTemplate`, from the default storage class unless you set `persistence.storageClassName`. |
| Storage the pod can read your media from | Not provided by either path. You supply the volumes. |
| Optional: Prometheus Operator CRDs | Only if you enable the chart's `ServiceMonitor`. |

## One node per StatefulSet

Each node is a StatefulSet fixed at one replica (the chart hard-codes `replicas: 1`; the Kustomize base does the same) running the image with `PLAYARR_ROLE=all` and `DATABASE_URL=sqlite:///data/playarr.db`. Its `volumeClaimTemplate` creates a `ReadWriteOnce` volume (10Gi by default, `persistence.size`) mounted at `/data`. Do not raise the replica count: two pods must never open the same SQLite file at once.

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

## Step 2, Create the namespace

Schema migrations are embedded in the binary and run automatically at pod startup, so there is nothing to prepare in a database.

```bash
kubectl create namespace playarr
```

The chart does not read a Kubernetes Secret: it has no `secretRef` or `extraEnv` hook. If `PLAYARR_JWT_SECRET` is unset or shorter than 32 bytes, the process derives a stable secret from its persisted node identity, which is the default for this chart. Setting your own secret means adding it yourself, for example through the `config:` map (which is a ConfigMap, so it is not secret storage) or by patching the rendered StatefulSet with a `secretKeyRef`.

## Step 3, Write a values file

Anything under `config:` in the chart's values is rendered into a ConfigMap and loaded into the pod with `envFrom`. The StatefulSet sets `PLAYARR_ROLE`, `DATABASE_URL` and `PLAYARR_ARTWORK_CACHE_DIR` itself as plain `env` entries, and those take precedence over `envFrom`, so setting them under `config:` has no effect. Check `infra/kubernetes/helm/playarr/values.yaml` for the current keys.

```yaml
# my-values.yaml
image:
  repository: <YOUR-REGISTRY>/playarr
  tag: "<YOUR-TAG>"

persistence:
  size: 20Gi
  storageClassName: ""   # empty: the cluster's default storage class

config:
  PLAYARR_LOG: "info"
```

The chart already mounts the database volume at `/data`, which holds `playarr.db` and the artwork cache (`/data/cache/artwork`). It mounts no media: add your library volumes yourself, read-only, at the path your *arr apps report. The root filesystem is read-only, so every writable path must be a volume mount or the `/tmp` emptyDir. `DATABASE_URL` must be a `sqlite:` URL: a `postgres://` URL makes the pod exit at startup with an error.

## Step 4, Install

```bash
helm install playarr infra/kubernetes/helm/playarr \
  --namespace playarr \
  --values my-values.yaml
```

Wait for the pod to become Ready, then follow the logs for the one-time bootstrap admin password:

```bash
kubectl -n playarr rollout status statefulset/playarr
kubectl -n playarr logs statefulset/playarr | grep 'bootstrap admin'
```

The password is written once, at WARN level, and only when the database has no users. Continue to [First run](/docs/first-run).

Ingress is yours to supply: terminate TLS at your ingress controller and route to the Service on port 8484.

## Backups

The pod's database is a SQLite file on a persistent volume. Playarr has a built-in backup feature that writes age-encrypted archives to a directory, but it is off until you set `PLAYARR_BACKUP_DIR` and `PLAYARR_BACKUP_RECIPIENTS` (through `config:`), and the chart does not set them. Put the directory on the data volume (`/data/backups`) or another volume. A backup on the same volume as the database does not survive losing that volume, so download archives from Playarr Admin or configure the optional S3-compatible replica. See [Upgrade and backup](/docs/upgrade-and-backup). Do not copy the live database file out from under a running server.

## Updating

Build and push a new image tag, then `helm upgrade` with the new `image.tag`. Migrations run automatically on the next start. Because the node has one replica and one volume, expect a short outage while the pod restarts.

## Uninstalling

```bash
helm uninstall playarr --namespace playarr
```

The persistent volume claim that the StatefulSet created (`data-playarr-0` for a release called `playarr`) is not removed by Helm or by deleting the StatefulSet. Delete it yourself if you want the data gone.
