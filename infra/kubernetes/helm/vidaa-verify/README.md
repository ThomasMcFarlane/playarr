# Playarr VIDAA verification chart

This chart deploys the Playarr backend and PostgreSQL workloads used for VIDAA
verification. Both Services are cluster-internal `ClusterIP` Services. The
chart does not use or require Headscale or Tailscale.

Runtime credentials are deliberately excluded from Git. Before the first
deployment, create the Secret named by `existingSecret` in the target namespace
with these keys:

- `DATABASE_URL`
- `STREAMARR_JWT_SECRET`
- `STREAMARR_BOOTSTRAP_ADMIN_USERNAME`
- `STREAMARR_BOOTSTRAP_ADMIN_PASSWORD`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

Use a secret manager or pipe a generated Secret manifest to `kubectl apply -f
-`; do not put credential values in shell arguments, Helm values, or this
repository.

Validate the chart with:

```sh
helm lint ./infra/kubernetes/helm/vidaa-verify
bash ./infra/kubernetes/helm/vidaa-verify/tests/render.sh
```
