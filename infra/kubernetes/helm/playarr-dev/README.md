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

## Regional runtime image (ffmpeg and ffprobe)

The regional servers run `streamarr-runtime:<tag>` with
`imagePullPolicy: Never`: the image is imported by hand into each node's
containerd and carries only userland. The release binary and web assets come
from the node's `runtimePath` hostPath mounted at `/opt/streamarr`. The
`<image>` image is an Arch Linux base with no ffmpeg, so every endpoint that
shells out to `ffprobe` or `ffmpeg` (transcode, HLS, thumbnails, chapters,
audio and subtitle track probing) returns 500 with
`could not start ffprobe: No such file or directory`.

The image had no build recipe in this repository; the Dockerfile
[`infra/docker/regional-runtime.Dockerfile`](../../../docker/regional-runtime.Dockerfile)
now defines it: the same Arch base (so it stays ABI-compatible with the
Arch-built release binary), plus `ffmpeg` (which ships `ffprobe`) and the same
`/opt/streamarr/streamarr` entrypoint. The build fails if either binary is
missing. `infra/docker/backend.Dockerfile` already bundles ffmpeg but is
Debian-based and embeds its own binary and web assets, so adopting it would
mean dropping the hostPath runtime layout and changing the runtime Secrets'
`PLAYARR_WEB_ASSETS_DIR`; that is a larger, separate decision.

`values.yaml` deliberately still points both regional servers at
`streamarr-runtime:26853ca`. With `imagePullPolicy: Never`, referencing a tag
that is not yet imported on the node leaves the Pod in
`ErrImageNeverPull` and, because the strategy is `Recreate`, takes the server
down. The tag bump is therefore a runbook step, taken only after the image is
present on both nodes.

After the new image is live, open Admin, System, Server capabilities on each
server to confirm ffmpeg, ffprobe and the required encoders report `present`.

### Rollout (needs owner approval; changes the cluster)

Use `NEW=26853ca-ffmpeg1` (increment the suffix for any rebuild; never reuse a
tag on a node).

1. Build once, on any machine with Docker:

   ```sh
   docker build -t streamarr-runtime:$NEW - < infra/docker/regional-runtime.Dockerfile
   docker run --rm --entrypoint ffprobe streamarr-runtime:$NEW -version | head -n 1
   docker save streamarr-runtime:$NEW | gzip > streamarr-runtime-$NEW.tar.gz
   ```

2. Copy the archive to each regional node (region-a and region-b) and import it into the
   k3s containerd image store. The old `<image>` image stays in place for
   rollback:

   ```sh
   gunzip -c streamarr-runtime-$NEW.tar.gz | sudo k3s ctr images import -
   sudo k3s ctr images ls | grep streamarr-runtime
   ```

   Both `<image>` and `$NEW` must be listed on both nodes before continuing.

3. Bump the tag. Change `regionalInstances.playarr-region-a.image` first, merge,
   and let Argo sync the `playarr` application; the Deployment recreates the
   Pod, so expect a short outage for that server. Verify (below), then repeat
   for `playarr-region-b`, which serves the public hostname.

4. Verify per server:

   ```sh
   kubectl -n playarr rollout status deploy/playarr-region-a
   kubectl -n playarr exec deploy/playarr-region-a -- ffprobe -version | head -n 1
   kubectl -n playarr exec deploy/playarr-region-a -- ffmpeg -version | head -n 1
   ```

   Then confirm the Server capabilities page shows no required item missing and
   that a previously failing transcode, chapters or track-probing request now
   succeeds.

### Rollback

The previous image is never removed from the nodes, so rollback is a values
change: set the affected `image` back to `streamarr-runtime:26853ca` (revert
the bump commit), merge and sync. Rolling back restores the pre-ffmpeg
behaviour (media endpoints return 500) but nothing else changes, as the state
volume and hostPath runtime are untouched by either image. If Argo is not
available, `kubectl -n playarr rollout undo deploy/playarr-region-a` returns to the
previous ReplicaSet, but Argo will then show drift until the values are
reverted.

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

