# Playarr development Helm chart

This chart captures the six development web surfaces previously maintained as
ad-hoc resources in the `dev` namespace and the standalone servers previously
split between `playarr-region-a` and `playarr-region-b`. It creates eight Deployments, eight
ClusterIP Services, sixteen Emissary `Mapping` resources, two ServiceAccounts
and two pre-bound PVCs in the Helm release namespace.

```sh
helm upgrade --install playarr-dev ./infra/kubernetes/helm/playarr-dev \
  --namespace playarr --create-namespace
```

The chart contains no Secrets. Public and LAN DNS are external prerequisites;
this chart manages only the matching Emissary routes.

The six dev-host development workloads are pinned to `dev-node`. Their
`localhost:5000` images and local hostPaths are not portable to region-a or region-b.
Each serves its readiness, liveness and startup checks from its HTTP root;
the marketing Astro probe sends the hostname required by its explicit Vite
host allowlist.

Before enabling either regional Deployment, create its external runtime Secret
in the release namespace:

| Secret | Required keys copied from the source namespace |
| --- | --- |
| `playarr-region-a-runtime` | `DATABASE_URL`, `PLAYARR_JWT_SECRET`, `PLAYARR_WEB_ASSETS_DIR`, `STREAMARR_WEB_ASSETS_DIR` |
| `playarr-region-b-runtime` | `DATABASE_URL`, `PLAYARR_AUTH_MODE`, `PLAYARR_JWT_SECRET`, `PLAYARR_WEB_ASSETS_DIR`, `STREAMARR_AUTH_MODE`, `STREAMARR_JWT_SECRET`, `STREAMARR_WEB_ASSETS_DIR` |

Do not put their values in Git or Helm values.

The source Secrets are not interchangeable. Their common `DATABASE_URL` and
web-assets values currently match, but their `PLAYARR_JWT_SECRET` values are
different and region-b has additional auth and legacy JWT keys. Keep the two target
Secret names distinct.

Two defaults deliberately preserve the current dev-host development behaviour:

- `playarr` requires the canonical
  `/path/to/playarr`
  checkout to exist on the scheduled node.
- `playarr-marketing` requires that checkout's `site/src` and `site/public`
  directories.

If those paths do not exist, Kubernetes leaves the Pods in
`ContainerCreating` with `FailedMount`, as it does in the source deployment.
Changing them is a separate operational decision. None of the six dev-host Pods requests
`hostNetwork` or `hostPort`; port 8080 is a pod-local container port.

## Direct host exposure (regional instances)

Each entry in `regionalInstances` may set an optional
`hostExposure: {hostIP, hostPort}`. When present, the `http` container port
(8484) also gets that `hostIP`/`hostPort`, which k3s publishes through the CNI
portmap plugin on that address. Omit the key to keep the instance cluster-only.

| Instance | Node | Address |
| --- | --- | --- |
| `playarr-region-a` | region-a | `http://203.0.113.10:8484` |
| `playarr-region-b` | region-b | `http://203.0.113.20:8484` |

This is plain HTTP on a public address, deliberately and with owner approval
(no tunnel or VPN). Only the `http` port is published; metrics (9090) stays
pod-local. The `playarr-a.example.com` and `playarr.example.com` routes are
unchanged. Deployments use the `Recreate` strategy, so the old Pod releases the
host port before the new one starts. The node firewall must allow TCP 8484.
Verify with `curl http://203.0.113.20:8484/healthz`.

## Regional PV cutover

The regional PVs are cluster-scoped static local volumes with `Retain` policy.
Each new PVC explicitly names its existing PV; it remains Pending while the PV
is still bound to the old namespace.

For one region at a time: take and verify a filesystem-level backup; disable
auto-sync for its old Argo application; scale the old Deployment to zero and
confirm no process holds the database; delete only the old PVC; verify the PV
is `Released` and still points at the correct node/path; remove only its stale
`spec.claimRef`; wait for the new PVC in this release namespace to become
`Bound`; then start and health-check the new Deployment before changing or
removing the old route. Never delete or recreate the PV object, and never have
old and new Deployments writing the same volume concurrently.

