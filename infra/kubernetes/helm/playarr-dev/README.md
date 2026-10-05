# Playarr Helm chart (`playarr-dev`)

A generic chart for two kinds of Playarr workloads in one release namespace:

- **Regional instances** (`regionalInstances`): self-contained Playarr servers,
  each pinned to one node with its own retained local state volume, runtime
  Secret, optional public host port, cert-manager certificate, public relay
  certificate, encrypted backups and an Emissary route.
- **Development workloads** (`workloads`): web surfaces (Vite dev servers,
  Admin and marketing previews) with a Service and Emissary Mappings.

The chart is a template only. Its defaults are empty and render nothing; every
deployment-specific value (instance names, hostnames, public addresses, node
names, hostPaths, Secret names, image references and pins) comes from the
operator's values, normally kept in a private GitOps repository and applied by
an Argo CD multi-source Application:

```yaml
sources:
  - repoURL: https://github.com/ThomasMcFarlane/playarr.git
    targetRevision: <full main commit SHA>
    path: infra/kubernetes/helm/playarr-dev
    helm:
      releaseName: playarr
      valueFiles:
        - $values/<path to your values file>
  - repoURL: <your GitOps repository>
    targetRevision: main
    ref: values
```

[`tests/example-values.yaml`](tests/example-values.yaml) is a complete worked
example with placeholder data (example.com names, RFC 5737 addresses, `/srv`
paths); `tests/render.sh` and `tests/backup.sh` render against it.

```sh
helm template playarr ./infra/kubernetes/helm/playarr-dev \
  --namespace playarr -f my-values.yaml
```

The chart contains no Secrets. Public and LAN DNS are external prerequisites;
this chart manages only the matching Emissary routes.

## Values reference

### Top level

| Key | Default | Meaning |
| --- | --- | --- |
| `workloadNodeSelector` | `{}` | Node selector for every development workload. |
| `workloads` | `{}` | Development workloads, keyed by name. |
| `regionalInstances` | `{}` | Regional servers, keyed by instance name (also the Deployment, Service and Mapping name). |

### Regional instance (`regionalInstances.<name>`)

Required:

| Key | Meaning |
| --- | --- |
| `image` | Full image reference, for example `<registry>/playarr-regional:<sha8>`. |
| `imagePullPolicy` | `IfNotPresent` for immutable SHA tags. |
| `replicas` | `1` (each instance owns a SQLite database on a local volume). |
| `nodeName` | Node the instance and its local PV are pinned to. |
| `secretName` | Pre-created runtime Secret (see below). |
| `podSecurityContext` | Pod security context (UID/GID matching the state and media ownership). |
| `thumbnailConcurrency`, `transcodeMaxConcurrentJobs`, `ffmpegThreads` | Resource guards for ffmpeg work. |
| `resources` | Container requests and limits. |
| `persistence` | `{create, claimName, volumeName, storageClassName, size}`; the PV is a static local volume with `Retain`. |
| `mediaPath` | Host directory holding the media libraries (mounted read-only). |
| `routeHost` | Hostname of the Emissary Mapping. |

Optional: `mediaMountPath` (container path for the media mount; defaults to
`mediaPath` so the paths reported by the media managers resolve unchanged),
`peerInternalRoutes`, `sourceInstanceUrls`, `dubarrApiKeySecret`,
`requestIntegrations`, `ombiApiKeySecret`, `seerrApiKeySecret`, `backup`,
`hostExposure`, `tls` and `acme`, each described below. `values.schema.json`
is the authoritative contract.

### Development workload (`workloads.<name>`)

Required: `image`, `imagePullPolicy`, `replicas`, `containerPort`, `routes`
(a list of `{name, host, hostRewrite?}` Mappings, may be empty). Optional:
`command`, `env`, `workingDir`, `podSecurityContext`, `hostPathVolumes`
(`{name, path, type, mounts: [{mountPath, readOnly?}]}`) and `probeHost` (Host
header for the HTTP probes when the server enforces a host allowlist). Each
serves its readiness, liveness and startup checks from its HTTP root.

### Runtime Secret

Create each instance's runtime Secret (`secretName`) in the release namespace
before enabling it, with at least `DATABASE_URL` and `PLAYARR_JWT_SECRET`
(plus `PLAYARR_AUTH_MODE` if not the default). Never put their values in Git or
Helm values, and never share one Secret between instances.

## Direct host exposure (`hostExposure`)

Each regional instance may set `hostExposure: {hostIP, hostPort}`. When
present, the `http` container port (8484) also gets that `hostIP`/`hostPort`,
which k3s publishes through the CNI portmap plugin on that address. Omit the
key to keep the instance cluster-only.

Only the `http` container port is published; metrics (9090) stays pod-local.
Deployments use the `Recreate` strategy, so the old Pod releases the host port
before the new one starts. The node firewall must allow the port.

## HTTPS (`tls`)

Each instance can set `tls: {hostnames: [...], issuer: letsencrypt-prod}`:

- The chart renders a cert-manager `Certificate` (`<instance>-tls`, ECDSA P-256,
  PKCS#8) in the release namespace. The `letsencrypt-prod` ClusterIssuer solves
  DNS-01 through Cloudflare for any name, so any name in a zone the issuer can answer for works.
- The Secret is mounted read-only at `/tls` and the Pod gets
  `PLAYARR_TLS_CERT_PATH=/tls/tls.crt` and `PLAYARR_TLS_KEY_PATH=/tls/tls.key`.
  The server then serves HTTPS on `PLAYARR_HTTP_BIND_ADDR` (the relay ACME
  certificate described under "Public relay" can be added alongside it). Probes use `scheme: HTTPS`; the Service exposes 443 and the
  Emissary Mapping uses `https://<instance>.<namespace>:443`, so the `routeHost`
  route keeps working. Emissary
  does not verify the upstream certificate, so `routeHost` needs no SAN.
- Only the node-facing names in `tls.hostnames` are SANs; a `routeHost` that
  resolves to the cluster ingress does not need to be one.
- Renewal: cert-manager renews about 30 days before expiry and updates the Secret
  in place. The server checks the two files every 60 seconds and hot-reloads a
  changed, valid pair (an invalid or half-written pair keeps the old certificate).
  This needs a server build containing that reload; older builds load the file
  once and need a Pod restart after each renewal.
- Ordering: the `Certificate` carries `argocd.argoproj.io/sync-wave: "-1"`, so Argo
  waits for it to be healthy before the Deployment. The Secret volume is not
  optional either, so a Pod created early waits in `ContainerCreating` until the
  Secret exists instead of crash-looping.
- Plain HTTP on 8484 is no longer served; there is no plaintext redirect on the
  static-certificate listener (except the relay challenge path when the relay is
  enabled). Clients must use `https://`.

Verify after rollout:

```sh
kubectl get certificate -n <namespace>      # READY=True for <instance>-tls
curl -sv https://<tls-hostname>:8484/healthz
echo | openssl s_client -connect <tls-hostname>:8484 \
  -servername <tls-hostname> 2>/dev/null | openssl x509 -noout -issuer -dates -subject
```

Repeat for each instance. Rollback: unset `tls` for the instance (plain HTTP
wiring returns) and sync.

## Regional server image

The regional servers run a self-contained image,
`<registry>/playarr-regional:<main-sha>`, built from
[`infra/docker/backend.Dockerfile`](../../../docker/backend.Dockerfile): the
`playarr-server` binary, the Admin web assets (`/app/web`) and `ffmpeg` /
`ffprobe` (the server shells out to both for transcoding, HLS, thumbnails,
chapters and track probing). Nothing is mounted from the node any more: the
earlier `streamarr-runtime` image with a `runtimePath` hostPath and a manual
`ctr images import` is gone. What stays on the node is the state PVC, the media
hostPath (`mediaPath`, read-only) and the TLS Secret.

The registry is the operator's choice; the image reference (including the tag)
is a deployment value. `imagePullPolicy: IfNotPresent` suits immutable
commit-SHA tags.

The chart sets `PLAYARR_WEB_ASSETS_DIR=/app/web`, overriding the legacy
`/opt/streamarr/web` value the runtime Secrets still carry.

### Publishing an image

The workflow `.github/workflows/regional-image.yml` builds and pushes
`playarr-regional:<first 8 characters of the commit SHA>` on every push to
`main` that touches the backend, the Admin UI or the Dockerfile, and fails if
`ffprobe` or `playarr-server --version` does not run inside the image. It
pushes to the registry named by the repository variable `REGIONAL_IMAGE_REGISTRY`
(the job is skipped when it is unset). To build
by hand from a checkout of the commit:

```sh
SHA=$(git rev-parse --short=8 HEAD)
docker build -f infra/docker/backend.Dockerfile \
  -t $REGISTRY/playarr-regional:$SHA .
docker run --rm --entrypoint ffprobe $REGISTRY/playarr-regional:$SHA -version | head -n 1
docker push $REGISTRY/playarr-regional:$SHA
```

### Rollout

Image pins are deployment values, so a rollout is a change in the GitOps
repository, never in this chart:

1. Wait for the `regional-image` workflow to publish the image of the `main`
   commit you want (or build and push it by hand as above).
2. Set `regionalInstances.<name>.image` to that tag in the deployment values
   and merge; roll one instance at a time. Never move a pin to an older image.
3. Bump the chart `targetRevision` only when the chart itself changed.
4. Verify per instance:

   ```sh
   kubectl -n <namespace> rollout status deploy/<instance>
   kubectl -n <namespace> exec deploy/<instance> -c playarr -- ffprobe -version | head -n 1
   ```

   Then open Admin, System, Server capabilities and confirm no required item is
   missing.

### Rollback

Revert the image pin in the deployment values and let Argo sync. The state PVC
is untouched by either image.

## Public relay (HTTPS on 8484, DNS-01 through the Worker)

The relay needs only one public port per server: 8484.

Cloudflare only holds DNS. There is no DNS server in the cluster and no port
80. Each server tells the `playarr.app` Worker its public IPv4 address; the
Worker calls it back on `http://<ip>:8484/.well-known/playarr-relay/<token>`
to prove control of the address and then publishes the DNS-only record
`v4-A-B-C-D.relay.playarr.app`. The same handshake lets the server obtain its
Let's Encrypt certificate with ACME DNS-01 through the Worker. Streaming and
API requests never pass through Cloudflare. See the repository's
`docs/deployment/playarr-relay.md` for the trust model and cut-over order.

The public port is the existing `hostExposure` (see "Direct host exposure"
above): `hostIP` and `hostPort` 8484 publish the container's 8484 through the
CNI `portmap` plugin on the node's public address only. Static TLS (`tls`, see
"HTTPS" above) stays the active transport for the `tls.hostnames` names. The
optional per-instance `acme` block adds the relay certificate on the same port:
the server holds both certificates and presents the one matching the TLS SNI
name (`v4-*.relay.playarr.app` gets the relay certificate, everything else the
static one). `acme.enabled` requires `hostExposure`; the chart fails to render
otherwise. `acme.domain` is `v4-A-B-C-D.relay.playarr.app` for
`hostExposure.hostIP` A.B.C.D (for example `203.0.113.10` gives
`v4-203-0-113-10.relay.playarr.app`).

The pods stay non-root with every capability dropped and bind no low port at
all. With ACME enabled the chart additionally sets `PLAYARR_ACME_DOMAIN`,
`PLAYARR_ACME_ENVIRONMENT=production`, `PLAYARR_ACME_ACCEPT_TERMS=true`,
`PLAYARR_ACME_CACHE_DIR=/data/acme` (on the state PVC, so certificates survive
restarts), `PLAYARR_ACME_CHALLENGE=relay-dns-01`, `PLAYARR_RELAY_REGISTER=true`
and `PLAYARR_PUBLIC_IPV4` (the instance's `hostExposure.hostIP`). The static
`PLAYARR_TLS_*` paths remain when `tls` is set: the server accepts both.

On 8484 the listener already speaks HTTPS with the static certificate, so probes
and the Mapping are unchanged. The Worker's callback is plain HTTP to
`/.well-known/playarr-relay/<token>` on the same port; the server answers that
one path in cleartext and redirects everything else. The relay certificate is
issued in the background and added to the SNI resolver without a restart. If an
instance enables `acme` without `tls`, the listener is plain HTTP until the
first relay certificate exists, so a five-minute startup probe is rendered.

Setting `acme.enabled: false` renders the previous wiring (static TLS only).

The server image must include the relay registration, DNS-01 and multi-certificate
support, and the Worker side must be live first: do not enable `acme` before the
relay cut-over steps in `docs/deployment/playarr-relay.md` have been approved and
carried out.

### Relay rollout

Enable the relay only after the server image supports it. Merge only after the
runtime image work this chart revision builds on is merged.

1. Preflight on each node (read-only): TCP 8484 must be free on the public
   address, the old systemd units must stay stopped and disabled, and any
   provider or host firewall must allow inbound TCP 8484 (the Worker and
   browsers connect to it).

   ```sh
   sudo ss -lntp | grep -E ':8484\b'
   systemctl is-active playarr   # any previous host service must be stopped
   ```

2. Complete the Worker cut-over (secrets, cron, removal of the `relay`
   delegation) as written in `docs/deployment/playarr-relay.md`.

3. Set `acme.enabled: true` in the deployment values (GitOps repository) and
   let Argo sync. Roll one instance at a time:

   ```sh
   kubectl -n <namespace> rollout status deploy/<instance>
   kubectl -n <namespace> logs deploy/<instance> | grep -i -E 'acme|relay|certificate'
   ```

   Expect "registered relay hostname" and then "automatic HTTPS enabled with
   Let's Encrypt ACME DNS-01" (or "using cached relay certificate").

4. Verification (all read-only):

   ```sh
   # The Worker published the DNS-only record.
   dig +short A v4-203-0-113-10.relay.playarr.app

   # Public HTTPS with a browser-trusted Let's Encrypt certificate.
   curl -sv https://v4-203-0-113-10.relay.playarr.app:8484/healthz
   openssl s_client -connect 203.0.113.10:8484 \
     -servername v4-203-0-113-10.relay.playarr.app </dev/null 2>/dev/null \
     | openssl x509 -noout -issuer -subject -dates

   # Pods and routes.
   kubectl -n <namespace> get pods -l app.kubernetes.io/name=playarr-standalone
   kubectl -n <namespace> get mapping <instance>
   ```

   Then request each regional route host through the normal public edge and
   confirm `/healthz` and a signed-in page load still work and a WebSocket
   still upgrades; those requests now cross Emissary's TLS origination.

### Relay rollback

Set `acme.enabled: false` for the instances and sync. The Deployment is
recreated without the relay variables and keeps serving HTTPS with the static
certificate on the `hostExposure` port, so the route hosts are unaffected. The
ACME account and certificate on the state volume are kept and reused on the
next attempt. The previous systemd units should remain stopped: starting them
would conflict with the same host port.

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

## Dubarr (AI dubbing companion)

Each regional instance can register Dubarr declaratively. `sourceInstanceUrls.dubarr`
is the in-cluster URL (`http://dubarr.dubarr.svc.cluster.local:8686`) and
`dubarrApiKeySecret` names a Secret in the release namespace whose key holds the
Dubarr API key. At boot the server ensures a `Dubarr` source instance exists with
that URL and key (a rotated key is applied on the next restart; the Secret is
`optional`, so the pod starts without it and Dubarr is simply not registered).
The key never appears in Git. Create or rotate the Secret from the Dubarr one, never
echoing it:

```sh
kubectl -n dubarr get secret dubarr-secrets -o jsonpath='{.data.DUBARR_API_KEY}' | base64 -d |
  kubectl -n <namespace> create secret generic playarr-dubarr --from-file=DUBARR_API_KEY=/dev/stdin \
    --dry-run=client -o yaml | kubectl apply -f -
kubectl -n <namespace> rollout restart deploy/<instance>
```

## Ombi and Seerr request integrations

`requestIntegrations.ombiUrl` (and `seerrUrl`) plus `ombiApiKeySecret` (and
`seerrApiKeySecret`) make each regional server register an Ombi (or Seerr)
request integration at boot, enabled, with user mapping by email and the key read
from the environment (never stored in Git or the database). The integration is
only created when none of that kind exists, so admin edits are kept. Choose where
requests go (direct, Ombi, Seerr or direct+mirror) in the admin UI under
"Request integrations". Create the Secret from Ombi's own settings without echoing
the key.

## Server backups

Each regional instance has an optional `backup` block that turns on encrypted
server backups (design: `docs/architecture/server-backups.md`):

```yaml
backup:
  enabled: true
  dir: /data/backups        # on the state volume; bounded by retention
  recipients: [age1...]     # age PUBLIC keys only
  mode: full                # or database (labelled partial)
  intervalHours: 24         # 0 = manual only
  keepLast: 3
  keepDays: 7
  maxAssetMiB: 1024
```

Only public keys go in the values. The matching recovery identity is created
offline with `playarr-server backup keygen --out <file>` and held by the
administrator; the server cannot decrypt its own backups. The state volume is
the same disk as the database, so it protects against corruption and mistakes,
not against losing the node: download backups from Admin, Backups (or copy
`/data/backups`) to another location. A run refuses to start when free space is
below twice the database size, and retention never removes the last complete
backup.

### Off-node copies (S3-compatible)

`backup.s3` replicates each completed backup to an S3-compatible bucket of your
choosing (MinIO, a NAS, any hosted provider; optional and off by default) while keeping the local copy. The archive is uploaded as a multipart
upload with per-part SHA-256 checksums, read back with `HEAD` to compare the
server-held composite checksum and size (a full read-back hash is the fallback
when a server reports no checksum), and only then committed by writing the
sidecar. Retention (`keepLast`/`keepDays`, defaulting to the local values) is
applied to the bucket too, and a missed upload is retried by the next run.

```yaml
s3:
  enabled: true
  endpoint: https://s3.example.com # your S3-compatible endpoint
  bucket: playarr-backups
  region: us-east-1 # whatever the endpoint expects
  prefix: playarr-a/        # one prefix per server sharing a bucket
  credentialsSecret:
    name: playarr-backup-s3 # keys: access-key-id, secret-access-key
```

Create the Secret out of band (never in Git) with an access key limited to
that bucket, for example
`kubectl -n <namespace> create secret generic playarr-backup-s3 --from-literal=access-key-id=... --from-literal=secret-access-key=...`.
Only the encrypted archive and the plaintext sidecar (names and counts) leave
the node.

Restore only ever targets a replacement or scratch instance, with the server
stopped: `playarr-server backup restore --archive <file> --identity-file <key>`.
Never restore over a live server's data for testing.
